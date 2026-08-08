// Shared live read function used by BOTH /api/competition/live and the
// /api/igc/league/live compatibility handler. Resolves the occurrence directly
// from the configured GG season/category + selected occurrence context — it
// does NOT require a persisted event row. A persisted row (when present)
// supplies hints (gg_event_id, tournament ids) and the durable-current columns.
// Discovery, result-status derivation, durable-current derivation, and
// stale-while-error are all handled here. Auth is the route's responsibility.

import { discoverOccurrence, type GGClient } from './adapters/golfgenius/discovery.ts'
import { buildLeagueActiveWindow, leagueOccurrenceLabel, mapLeagueEventToOccurrence } from './adapters/golfgenius/mapping.ts'
import { deriveResultStatus, type UpstreamStatus } from './result-status.ts'
import { isDurableCurrent } from './durable-current.ts'
import { isOccurrenceActive } from './active-window.ts'
import { readCachedResult, readStaleResult, writeCachedResult, makeSingleFlight, type LiveCacheStore } from './cache.ts'
import { getCompetitionConfig, getSpecialOccurrence } from './registry.ts'
import type { GolfGeniusAdapterConfig, LiveResponse, Occurrence, ScoringMode, DurableCurrentSource } from './types.ts'

const sf = makeSingleFlight<LiveResponse>()

export interface EventRow {
  week_number: number
  event_name: string | null
  event_date: string | null
  event_format: 'individual' | 'team' | 'unknown' | null
  discovery_state: 'pending' | 'discovered' | 'inconclusive' | 'failed' | null
  gg_event_id: string | null
  gg_round_id: string | null
  gg_gross_tournament_id: string | null
  gg_net_tournament_id: string | null
  source_finalized_at: string | null
  source_version: string | null
  durable_source_version: string | null
  durable_imported_at: string | null
}

export interface LiveDeps {
  adapterConfig: GolfGeniusAdapterConfig
  ggClient: GGClient
  readEvent: (competitionKey: string, occurrenceId: string) => Promise<EventRow | null>
  cacheStore?: LiveCacheStore
}

export interface GetLiveResultsInput {
  competitionKey: string
  occurrenceId: string
  scoring: ScoringMode
  nowIso: string
  deps?: Partial<LiveDeps>   // production path omits deps → uses real GG + DB
}

export async function getLiveResults(input: GetLiveResultsInput): Promise<LiveResponse> {
  const config = getCompetitionConfig(input.competitionKey)
  if (!config) throw new Error(`unknown competition ${input.competitionKey}`)
  const tenantKey = config.adapterConfig.tenantKey
  const cacheArgs = { tenantKey, competitionKey: input.competitionKey, occurrenceId: input.occurrenceId, scoring: input.scoring }

  // Resolve deps (injected in tests, real in prod).
  const adapterConfig = input.deps?.adapterConfig ?? config.adapterConfig
  const ggClient = input.deps?.ggClient ?? ((async (endpoint: string) => {
    // 404-tolerant: a stale hinted id or a not-posted-yet tournament .json
    // resolves to null (discovery degrades to not_started / fresh discovery)
    // instead of throwing → blanking the live leaderboard. 401/403/5xx still
    // throw so stale-while-error can serve last-known data. See discovery.ts.
    const { makeGolfGeniusRequestOptional } = await import('../gg/client.ts')
    return makeGolfGeniusRequestOptional({ endpoint })
  }) as GGClient)
  const readEvent = input.deps?.readEvent ?? (async (competitionKey: string, occurrenceId: string) => {
    const { createClient } = await import('../supabase/server.ts')
    const supabase = await createClient()
    const leagueKey = competitionKey === 'mens-league' ? 'mens' : 'womens'
    const { data } = await supabase.from('igc_league_events')
      .select('week_number, event_name, event_date, event_format, discovery_state, gg_event_id, gg_round_id, gg_gross_tournament_id, gg_net_tournament_id, source_finalized_at, source_version, durable_source_version, durable_imported_at')
      .eq('league_key', leagueKey).eq('week_number', Number(occurrenceId)).maybeSingle()
    return (data as EventRow | null) ?? null
  })

  // 1. Fresh cache hit.
  const cacheStore = input.deps?.cacheStore
  const cached = cacheStore ? await readCachedResult(cacheArgs, cacheStore) : await readCachedResult(cacheArgs)
  if (cached) return { ...cached, showingLastKnown: false }

  // 2. Single-flight the fresh fetch+discover.
  const fresh = await sf.run(`${input.competitionKey}:${input.occurrenceId}:${input.scoring}`, () =>
    fetchFresh(input, config, adapterConfig, ggClient, readEvent, input.nowIso, cacheStore),
  )
  // 3. Write back (best-effort).
  if (fresh && !fresh.showingLastKnown) {
    try { await writeCachedResult(cacheArgs, fresh, cacheStore) } catch { /* best-effort */ }
  }
  return fresh
}

async function fetchFresh(
  input: GetLiveResultsInput,
  config: ReturnType<typeof getCompetitionConfig> extends infer C ? Exclude<C, null> : never,
  adapterConfig: GolfGeniusAdapterConfig,
  ggClient: GGClient,
  readEvent: (competitionKey: string, occurrenceId: string) => Promise<EventRow | null>,
  nowIso: string,
  cacheStore?: LiveCacheStore,
): Promise<LiveResponse> {
  const ev = await readEvent(input.competitionKey, input.occurrenceId)
  const occurrenceNumber = Number(input.occurrenceId)

  // When no persisted row exists, a configured special occurrence (e.g. a Club
  // Championship round) supplies its date + GG event/round ids from config so live
  // discovery resolves it WITHOUT a durable row — the Standings live-discovery
  // contract. A persisted row, when present, still wins (it carries the
  // durable-current columns + freshly reconciled ids).
  const spec = ev ? null : getSpecialOccurrence(input.competitionKey, occurrenceNumber)
  const occurrenceDate = ev?.event_date ?? spec?.date ?? null

  const teamOverride = (adapterConfig.teamFormatOverrides ?? []).includes(occurrenceNumber)
  const persistedHints = ev ? {
    ggEventId: ev.gg_event_id, ggRoundId: ev.gg_round_id,
    grossTournamentId: ev.gg_gross_tournament_id, netTournamentId: ev.gg_net_tournament_id,
  } : (spec ? {
    ggEventId: spec.ggEventId ?? null, ggRoundId: spec.ggRoundId ?? null,
    grossTournamentId: null, netTournamentId: null,
  } : null)

  // Durable-current contract from the persisted row (may be null when no row).
  const dcs: DurableCurrentSource = {
    sourceFinalizedAt: ev?.source_finalized_at ?? null,
    sourceVersion: ev?.source_version ?? null,
    durableSourceVersion: ev?.durable_source_version ?? null,
    durableImportedAt: ev?.durable_imported_at ?? null,
  }
  const durableCurrent = isDurableCurrent(dcs)

  try {
    const r = await discoverOccurrence({
      competitionKey: input.competitionKey,
      tenantKey: adapterConfig.tenantKey,
      adapterConfig,
      occurrenceContext: { number: Number.isFinite(occurrenceNumber) ? occurrenceNumber : null, date: occurrenceDate },
      persistedHints,
      teamOverride,
      ggClient,
      scoringMode: input.scoring,
    })

    // Correction 3: when the persisted row has no event_date, use the round
    // date GG discovery returned so the active window still covers play. The
    // discovered date is the authoritative temporal signal when no row exists.
    const effectiveDate = occurrenceDate ?? r.resolved.roundDate ?? null

    // Build the active window from config (no hardcoded start). Built AFTER
    // discovery so it can use the discovered round date.
    const window = buildLeagueActiveWindow({
      date: effectiveDate, tz: config.schedule?.timezone ?? 'America/Los_Angeles',
      playStartLocal: config.schedule?.playStartLocal, windowHours: config.schedule?.windowHours,
    }) ?? { start: effectiveDate ?? '', end: null }

    const active = isOccurrenceActive(window, nowIso, r.resolved.upstreamStatus === 'in_progress')
    const resultStatus = deriveResultStatus({
      upstreamStatus: r.resolved.upstreamStatus,
      active,
      hasResults: !!r.leaderboard && r.leaderboard.entries.length > 0,
      anyPartial: r.leaderboard?.scorecards.some((c) => c.isLive) ?? false,
      durableFinalized: durableCurrent,
    })

    const label = spec?.label ?? leagueOccurrenceLabel(config.navigation.labelRule, Number.isFinite(occurrenceNumber) ? occurrenceNumber : null, ev?.event_name ?? r.resolved.eventName ?? null)
    const occurrence: Occurrence = mapLeagueEventToOccurrence(
      { week_number: occurrenceNumber, event_name: ev?.event_name ?? r.resolved.eventName ?? null, event_date: effectiveDate, event_format: r.eventFormat, discovery_state: r.discoveryState },
      label, window, resultStatus,
    )
    const leaderboard = r.leaderboard ? { ...r.leaderboard, occurrenceId: input.occurrenceId, resultStatus, durableCurrent } : null

    return {
      occurrence, leaderboard, resultStatus, eventFormat: r.eventFormat, discoveryState: r.discoveryState,
      durableCurrent, showingLastKnown: false,
    }
  } catch (err) {
    // Stale-while-error (Correction 7): a THROWN GG error reaches here — it is
    // NOT swallowed into pending/inconclusive upstream. Return the most recent
    // cached row (even if expired) with showingLastKnown=true, preserving the
    // leaderboard. Log and fall through.
    console.error(`[getLiveResults] ${input.competitionKey}/${input.occurrenceId}:`, err)
    const stale = cacheStore ? await readStaleResult({ tenantKey: adapterConfig.tenantKey, competitionKey: input.competitionKey, occurrenceId: input.occurrenceId, scoring: input.scoring }, cacheStore)
      : await readStaleResult({ tenantKey: adapterConfig.tenantKey, competitionKey: input.competitionKey, occurrenceId: input.occurrenceId, scoring: input.scoring })
    if (stale) return { ...stale, showingLastKnown: true }
    // No stale row: honest unknown state (NOT a team verdict).
    const fallbackWindow = buildLeagueActiveWindow({
      date: occurrenceDate, tz: config.schedule?.timezone ?? 'America/Los_Angeles',
      playStartLocal: config.schedule?.playStartLocal, windowHours: config.schedule?.windowHours,
    }) ?? { start: occurrenceDate ?? '', end: null }
    const label = spec?.label ?? leagueOccurrenceLabel(config.navigation.labelRule, Number.isFinite(occurrenceNumber) ? occurrenceNumber : null, ev?.event_name ?? null)
    return {
      occurrence: mapLeagueEventToOccurrence(
        { week_number: occurrenceNumber, event_name: ev?.event_name ?? null, event_date: occurrenceDate, event_format: 'unknown', discovery_state: 'pending' },
        label, fallbackWindow, 'unknown',
      ),
      leaderboard: null, resultStatus: 'unknown', eventFormat: 'unknown', discoveryState: 'pending',
      durableCurrent, showingLastKnown: false,
    }
  }
}
