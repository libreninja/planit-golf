// Server-side GG discovery. Resolves an occurrence's competitions and results
// DIRECTLY from Golf Genius using the adapter config + selected occurrence
// context, independent of any persisted row. Persisted ids are HINTS, verified
// against GG before use: a hinted event/round/tournament that returns empty
// (not-found-yet / stale) falls back to full config discovery; a hinted id
// whose fetch THROWS (network/auth/5xx) propagates the error so the caller's
// stale-while-error handler can serve last-known data. Persisted tournament
// ids are NEVER synthesized as 'individual' — classification comes from fetched
// metadata or a fresh tournament list. Team requires positive evidence
// (metadata or config override); side games never make the round team. The GG
// client is injected so this is unit-testable with fixtures.
//
// ERROR CONTRACT (Corrections 3 & 7): the GG client throws on genuine upstream
// failure (network, auth 401/403, 5xx). A 404 or "no data yet" is returned as
// null/[] — that is "not found yet", NOT a failure. This module does NOT wrap
// fetches in a swallowing try/catch; thrown errors propagate out of
// discoverOccurrence. Only "empty but resolved" results map to pending/
// inconclusive. This is what lets the caller's stale-while-error distinguish
// "GG is down" (serve last-known, showingLastKnown=true) from "round not posted
// yet" (show not_started).
//
// OCCURRENCE METADATA (Correction 3): discoverOccurrence returns a
// ResolvedOccurrence carrying every identifier + finalization datum the
// reconciler needs to import WITHOUT placeholders — ggEventId, ggRoundId, the
// gross/net tournament ids, the discovered round date, event name, upstream
// status, and the source finalization timestamp + version token. The caller
// passes `resolved` straight into importOccurrence (Task 19B).

import { classifyEventFormat, nameKind, type DiscoveredTournament } from '../../classify.ts'
import { normalizeTournament } from './normalize.ts'
import { trimScorecardsToRoundHoles } from '../../../igc/weekly-results-helpers.ts'
import type { GolfGeniusAdapterConfig, Leaderboard, ScoringMode, EventFormat, DiscoveryState, ResultStatus, ResolvedOccurrence } from '../../types.ts'
import type { UpstreamStatus } from '../../result-status.ts'

export type GGClient = (endpoint: string) => Promise<any>

export interface OccurrenceContext {
  number: number | null      // occurrence number (league week)
  date: string | null        // ISO date for byDateWindow resolution
}

export interface PersistedHints {
  ggEventId: string | null
  ggRoundId: string | null
  grossTournamentId: string | null
  netTournamentId: string | null
}

export interface DiscoverInput {
  competitionKey: string
  tenantKey: string
  adapterConfig: GolfGeniusAdapterConfig
  occurrenceContext: OccurrenceContext
  persistedHints: PersistedHints | null
  teamOverride: boolean
  ggClient: GGClient
  scoringMode: ScoringMode
}

export interface DiscoverResult {
  eventFormat: EventFormat
  discoveryState: DiscoveryState
  resultStatus: ResultStatus
  leaderboard: Leaderboard | null
  resolved: ResolvedOccurrence
}

function emptyResolved(weekNumber: number | null): ResolvedOccurrence {
  return {
    weekNumber: weekNumber ?? 0,
    ggEventId: null, ggRoundId: null, grossTournamentId: null, netTournamentId: null,
    upstreamStatus: 'unknown', roundDate: null, eventName: null,
    sourceFinalizedAt: null, sourceVersion: null,
  }
}

// Coerce a GG rounds response to an array (list or {rounds:[...]}). Each
// element arrives wrapped as {round: {id, date, ...}} from GG's
// /events/{ev}/rounds endpoint; unwrap that so callers can read `.id`/`.date`
// at the top level. Elements that are already flat (no `round` key) pass
// through unchanged, so this is safe for both shapes.
function asRounds(list: any): any[] {
  const arr = Array.isArray(list) ? list : (list?.rounds ?? [])
  return arr.map((x: any) => (x && typeof x === 'object' && 'round' in x ? x.round : x))
}
// Coerce a GG list response to an array (list or {<key>:[...]}).
function asArr(list: any, key: string): any[] {
  return Array.isArray(list) ? list : (list?.[key] ?? [])
}

// Resolve the parent GG event from config (season + category). Returns the
// event {id, name} matching the adapter's eventFilter. Does NOT swallow errors.
//
// The GG REST API lists a season's events at /events?season={id} (NOT
// /seasons/{id}/events, which 404s), and each element arrives wrapped as
// {event: {id, name, category: {id, id_str}}}. Unwrap both shapes so this
// works whether the client returns the bare array or {events: [...]}. Match on
// category id (id_str holds full precision — the numeric `id` is lossy) OR on
// the eventFilter substring of the name. This is the config-only fallback
// exercised when no persisted gg_event_id hint is available (e.g. a brand-new
// occurrence not yet in igc_league_events); with a hint the caller's verify
// branch short-circuits before reaching here.
async function resolveEventFromConfig(input: DiscoverInput): Promise<{ id: string; name: string | null } | null> {
  const list = await input.ggClient(`/events?season=${input.adapterConfig.seasonId}`)
  const events = asArr(list, 'events')
  const match = events.find((e: any) => {
    const ev = e?.event ?? e
    const catId = ev?.category?.id_str ?? ev?.category?.id ?? ev?.category_id
    return ev?.id && (catId === input.adapterConfig.categoryId || String(ev.name ?? '').toLowerCase().includes(input.adapterConfig.eventFilter))
  })
  const ev = match?.event ?? match
  return ev?.id ? { id: ev.id, name: ev.name ?? null } : null
}

// Select a round from a rounds array by pointsRoundIndex or byDateWindow.
function selectRound(input: DiscoverInput, rounds: any[]): { id: string; date: string | null } | null {
  const pts = rounds.filter((r: any) => r?.is_points_round !== false)
  if (input.adapterConfig.roundResolution === 'byDateWindow' && input.occurrenceContext.date) {
    const d = input.occurrenceContext.date.slice(0, 10)
    const m = pts.find((r: any) => r?.date?.slice?.(0, 10) === d)
    if (m) return { id: m.id, date: m.date ?? null }
  }
  const idx = (input.occurrenceContext.number ?? 1) - 1
  const r = pts[idx] ?? pts[pts.length - 1]
  return r?.id ? { id: r.id, date: r.date ?? null } : null
}

// List tournaments and map to DiscoveredTournament (canonical flat {id,name}).
async function listTournaments(input: DiscoverInput, ggEventId: string, ggRoundId: string): Promise<DiscoveredTournament[]> {
  const list = await input.ggClient(`/events/${ggEventId}/rounds/${ggRoundId}/tournaments`)
  const arr = asArr(list, 'tournaments')
  return arr
    .map((t: any) => ({ id: t?.event?.id ?? t?.id, name: t?.event?.name ?? t?.name }))
    .filter((t: { id?: string; name?: string }) => t.id && t.name)
    .map((t: { id: string; name: string }) => ({
      id: t.id, name: t.name,
      metadataFormat: null as DiscoveredTournament['metadataFormat'],  // GG exposes no explicit format field here
      nameKind: nameKind(t.name),
    }))
}

function pickGrossNet(tournaments: DiscoveredTournament[]): { gross: string | null; net: string | null } {
  const individual = tournaments.filter((t) => t.nameKind === 'individual')
  const gross = individual.find((t) => /gross/i.test(t.name))?.id ?? null
  const net = individual.find((t) => /net/i.test(t.name))?.id ?? (individual.length === 1 ? individual[0].id : null)
  return { gross, net }
}

export async function discoverOccurrence(input: DiscoverInput): Promise<DiscoverResult> {
  const { teamOverride, scoringMode } = input
  const weekNumber = input.occurrenceContext.number ?? 0

  // 1. Resolve event + round. Verify hinted event/round ids against GG first;
  //    stale (empty) hints fall back to full config discovery. Thrown errors
  //    propagate (genuine upstream failure → caller's stale-while-error).
  let ggEventId: string | null = null
  let eventName: string | null = null
  let ggRoundId: string | null = null
  let roundDate: string | null = null
  let rounds: any[] = []

  const evHint = input.persistedHints?.ggEventId ?? null
  if (evHint) {
    // Verify the hinted event by fetching its rounds. Empty → stale, fall back.
    // A throw propagates (genuine upstream failure).
    const r = await input.ggClient(`/events/${evHint}/rounds`)
    rounds = asRounds(r)
    if (rounds.length) {
      ggEventId = evHint
      // eventName is unknown from a hint without an extra fetch; leave null —
      // the caller's persisted row carries the name (Task 15 mapper).
    }
  }
  if (!ggEventId) {
    const ev = await resolveEventFromConfig(input)
    if (!ev) {
      return { eventFormat: 'unknown', discoveryState: 'pending', resultStatus: 'unknown',
        leaderboard: null, resolved: emptyResolved(weekNumber) }
    }
    ggEventId = ev.id
    eventName = ev.name
    const r = await input.ggClient(`/events/${ggEventId}/rounds`)
    rounds = asRounds(r)
  }

  // 2. Resolve round. Prefer a verified hint present in the rounds list; else
  //    select by position/date. A hinted round not in the fetched list is stale.
  const rdHint = input.persistedHints?.ggRoundId ?? null
  if (rdHint && rounds.some((r: any) => r?.id === rdHint)) {
    const rd = rounds.find((r: any) => r?.id === rdHint)
    ggRoundId = rdHint
    roundDate = rd?.date ?? null
  } else {
    const sel = selectRound(input, rounds)
    if (!sel) {
      return { eventFormat: 'unknown', discoveryState: 'inconclusive', resultStatus: 'unknown',
        leaderboard: null,
        resolved: { ...emptyResolved(weekNumber), ggEventId, eventName } }
    }
    ggRoundId = sel.id
    roundDate = sel.date
  }

  // 3. Resolve tournaments. Try persisted tournament-id hints (fetch+verify);
  //    stale → full discovery. Never synthesize individual from a hint id.
  let grossId = input.persistedHints?.grossTournamentId ?? null
  let netId = input.persistedHints?.netTournamentId ?? null
  let discoveredTournaments: DiscoveredTournament[] = []
  let payloadForScoring: any = null

  if (grossId || netId) {
    const tryId = scoringMode === 'gross' ? grossId : netId
    const fetched = tryId ? await input.ggClient(`/events/${ggEventId}/rounds/${ggRoundId}/tournaments/${tryId}.json`) : null
    if (fetched && fetched?.event?.scopes?.length) {
      payloadForScoring = fetched
      discoveredTournaments = await listTournaments(input, ggEventId, ggRoundId)
      if (!discoveredTournaments.length) {
        // We have real results in hand for the hinted id — that IS positive
        // evidence an individual competition exists. Mark individual so
        // classification reflects the verified results, not the empty list.
        discoveredTournaments = [grossId, netId].filter(Boolean).map((id) => ({
          id: id as string, name: '', metadataFormat: 'individual' as const, nameKind: 'individual' as const,
        }))
      }
    } else {
      // Stale hints: fall back to full discovery. Do NOT classify from hint ids.
      grossId = null; netId = null
      discoveredTournaments = await listTournaments(input, ggEventId, ggRoundId)
      const gn = pickGrossNet(discoveredTournaments)
      grossId = gn.gross; netId = gn.net
    }
  } else {
    discoveredTournaments = await listTournaments(input, ggEventId, ggRoundId)
    const gn = pickGrossNet(discoveredTournaments)
    grossId = gn.gross; netId = gn.net
  }

  // 4. Classify (positive evidence only; side games ignored).
  const cls = classifyEventFormat({ tournaments: discoveredTournaments, teamOverride })
  if (cls.eventFormat !== 'individual') {
    return {
      eventFormat: cls.eventFormat, discoveryState: cls.discoveryState, resultStatus: 'not_started',
      leaderboard: null,
      resolved: { weekNumber, ggEventId, ggRoundId, grossTournamentId: grossId, netTournamentId: netId,
        upstreamStatus: 'unknown', roundDate, eventName, sourceFinalizedAt: null, sourceVersion: null },
    }
  }

  // 5. Fetch the scoring-mode competition's results (if not already fetched).
  const tournamentId = scoringMode === 'gross' ? grossId : netId
  if (!tournamentId) {
    return {
      eventFormat: 'individual', discoveryState: 'discovered', resultStatus: 'not_started',
      leaderboard: null,
      resolved: { weekNumber, ggEventId, ggRoundId, grossTournamentId: grossId, netTournamentId: netId,
        upstreamStatus: 'unknown', roundDate, eventName, sourceFinalizedAt: null, sourceVersion: null },
    }
  }
  let payload = payloadForScoring
  if (!payload) {
    payload = await input.ggClient(`/events/${ggEventId}/rounds/${ggRoundId}/tournaments/${tournamentId}.json`)
  }
  if (!payload || !payload?.event?.scopes?.length) {
    // No results posted yet (not-found-yet) → not_started, NOT a failure.
    return {
      eventFormat: 'individual', discoveryState: 'discovered', resultStatus: 'not_started',
      leaderboard: null,
      resolved: { weekNumber, ggEventId, ggRoundId, grossTournamentId: grossId, netTournamentId: netId,
        upstreamStatus: 'unknown', roundDate, eventName, sourceFinalizedAt: null, sourceVersion: null },
    }
  }

  const norm = normalizeTournament(payload, scoringMode)
  const upstreamStatus: UpstreamStatus = norm.upstreamStatus
  const sourceFinalizedAt = payload?.event?.completed_at ?? null
  const sourceVersion = payload?.event?.version ?? payload?.event?.updated_at ?? null
  const anyPlayers = [...norm.entriesByFlight.values()].some((es) => es.length > 0)
  if (!anyPlayers) {
    return {
      eventFormat: 'individual', discoveryState: 'discovered', resultStatus: 'not_started',
      leaderboard: null,
      resolved: { weekNumber, ggEventId, ggRoundId, grossTournamentId: grossId, netTournamentId: netId,
        upstreamStatus, roundDate, eventName, sourceFinalizedAt, sourceVersion },
    }
  }

  // Result status is finalized by the caller via deriveResultStatus (combining
  // upstreamStatus + active window + durable). Here we return the raw upstream
  // signal; default to 'live' as a safe interim until the caller decides.
  const resultStatus: ResultStatus = upstreamStatus === 'completed' ? 'final' : 'live'
  const entries = [...norm.entriesByFlight.values()].flat()
  // Trim each card to the round's real hole count (a 9-hole Interbay league
  // round arrives as 18 slots with trailing nulls). recomputeLive=true so a
  // finished 9-hole card reads "F" against the real course length, not "thru 9"
  // against the padded 18. This fixes the scorecard SHAPE; totals come from GG
  // and are unaffected.
  trimScorecardsToRoundHoles([...norm.scorecards.values()], true)
  const leaderboard: Leaderboard = {
    occurrenceId: '',                             // filled by caller
    scoringMode,
    grouping: null,
    entries,
    scorecards: [...norm.scorecards.values()],
    resultStatus,
    durableCurrent: false,
  }
  return {
    eventFormat: 'individual', discoveryState: 'discovered', resultStatus,
    leaderboard,
    resolved: { weekNumber, ggEventId, ggRoundId, grossTournamentId: grossId, netTournamentId: netId,
      upstreamStatus, roundDate, eventName, sourceFinalizedAt, sourceVersion },
  }
}
