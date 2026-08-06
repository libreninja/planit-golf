// Idempotent, bounded reconciliation. ONE shared absolute deadline is created
// in reconcileAllCompetitions and passed to every competition; each iteration
// checks the deadline FIRST so a timeout never leaves a run half-applied.
// Unfinished work is eligible for the next hourly run (every step is an
// idempotent upsert). Candidate selection (Task 19E) decides discover vs
// import; import is authorized by upstream_status='completed' only. Failures
// are isolated per competition. Time is reserved before the deadline to
// serialize the summary + clean the cache. See design spec §5/§7.

import { allCompetitionConfigs } from '../registry.ts'
import { selectReconciliationCandidates, type CandidateEvent } from './candidates.ts'
import type { ResolvedOccurrence } from '../types.ts'

export interface ReconcileSummary {
  competition: string
  discovered: number
  imported: number
  skipped: number
  seasonPointsRebuilds: number
  errors: string[]
  stoppedForBudget: boolean
}

// Injected operations so this is unit-testable. discoverAndPersist returns
// the DiscoverResult (carrying `resolved: ResolvedOccurrence`); importOccurrence
// takes that `resolved` — the discovery→import handoff uses real resolved IDs,
// never placeholders (Corrections 4 & 6).
export interface ReconcileOps {
  listEvents(competitionKey: string): Promise<CandidateEvent[]>
  discoverAndPersist(competitionKey: string, week: number, nowIso: string): Promise<{ resolved: ResolvedOccurrence }>
  importOccurrence(competitionKey: string, week: number, nowIso: string, resolved: ResolvedOccurrence): Promise<void>
  rebuildSeasonPoints(competitionKey: string): Promise<void>
}

const RESERVE_MS = 5_000   // leave time to serialize/log + clean cache

export interface ReconcileAllInput {
  deadlineMs: number       // shared absolute deadline
  nowIso: string
  ops?: ReconcileOps
}

export async function reconcileAllCompetitions(input: ReconcileAllInput): Promise<ReconcileSummary[]> {
  const summaries: ReconcileSummary[] = []
  for (const config of allCompetitionConfigs()) {
    try {
      summaries.push(await reconcileCompetition({
        competitionKey: config.key, deadlineMs: input.deadlineMs, nowIso: input.nowIso, ops: input.ops,
      }))
    } catch (err) {
      summaries.push({ competition: config.key, discovered: 0, imported: 0, skipped: 0, seasonPointsRebuilds: 0, errors: [String(err)], stoppedForBudget: false })
    }
  }
  return summaries
}

export interface ReconcileCompetitionInput {
  competitionKey: string
  deadlineMs: number
  nowIso: string
  ops?: ReconcileOps
}

export async function reconcileCompetition(input: ReconcileCompetitionInput): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = { competition: input.competitionKey, discovered: 0, imported: 0, skipped: 0, seasonPointsRebuilds: 0, errors: [], stoppedForBudget: false }
  const ops = input.ops ?? (await defaultOps())

  const events = await ops.listEvents(input.competitionKey)
  const candidates = selectReconciliationCandidates(events, input.nowIso)

  for (const c of candidates) {
    if (Date.now() + RESERVE_MS >= input.deadlineMs) { summary.stoppedForBudget = true; break }
    try {
      if (c.action === 'skip') { summary.skipped++; continue }
      // ALWAYS discover — discovery returns the ResolvedOccurrence (ids +
      // upstream status). Candidate pre-selection only decides skip-vs-process;
      // the import decision uses the DISCOVERED upstream status, so an
      // unresolved candidate that GG now marks completed is imported in the
      // same run (Correction 6). No placeholders: `resolved` flows discovery→import.
      const r = await ops.discoverAndPersist(input.competitionKey, c.week_number, input.nowIso)
      summary.discovered++
      if (r.resolved.upstreamStatus === 'completed') {
        await ops.importOccurrence(input.competitionKey, c.week_number, input.nowIso, r.resolved)
        summary.imported++
        await ops.rebuildSeasonPoints(input.competitionKey)
        summary.seasonPointsRebuilds++
      }
    } catch (err) {
      summary.errors.push(`wk${c.week_number}: ${String(err)}`)
    }
  }
  return summary
}

// Production ops: wire gg-helpers-backed import + season-points + discover
// modules to the service client. Built lazily so the module imports cleanly
// in tests that inject ops. The discovery→import handoff passes the real
// ResolvedOccurrence (no placeholders — Corrections 4 & 6).
async function defaultOps(): Promise<ReconcileOps> {
  const { createServiceClient } = await import('../../supabase/service.ts')
  const { makeGolfGeniusRequestOptional } = await import('../../gg/client.ts')
  const { discoverAndPersistEventClassification } = await import('./discover.ts')
  const { importOccurrence } = await import('./import.ts')
  const { rebuildSeasonPoints } = await import('./season-points.ts')
  const supabase = createServiceClient()
  // 404-tolerant client: a missing tournament .json ("not found yet") resolves
  // to null instead of throwing, per discovery's ERROR CONTRACT. This is what
  // stops unfinalized rounds from surfacing as `wk{N}: ... 404` reconcile errors.
  const ggClient = (async (endpoint: string) => makeGolfGeniusRequestOptional({ endpoint })) as any
  return {
    async listEvents(competitionKey) {
      const leagueKey = competitionKey === 'mens-league' ? 'mens' : 'womens'
      const { data } = await supabase.from('igc_league_events')
        .select('week_number, event_date, event_format, discovery_state, source_finalized_at, durable_imported_at')
        .eq('league_key', leagueKey).order('week_number', { ascending: false }).limit(200)
      return (data ?? []).map((e: any) => ({
        week_number: e.week_number, event_date: e.event_date,
        event_format: e.event_format, discovery_state: e.discovery_state,
        upstream_status: e.source_finalized_at ? 'completed' : null,
        durable_imported_at: e.durable_imported_at,
      }))
    },
    async discoverAndPersist(competitionKey, week, nowIso) {
      const config = (await import('../registry.ts')).getCompetitionConfig(competitionKey)!
      const leagueKey = competitionKey === 'mens-league' ? 'mens' : 'womens'
      // Pass persisted GG ids from the event row as hints so discovery verifies
      // and uses them directly. This lets reconcile work in deployments where
      // IGC_*_SEASON_ID is not configured (config discovery would 404 on an
      // empty season); stale/empty hints still fall back to full config
      // discovery. Mirrors the live path's hint usage.
      const { data: ev } = await supabase.from('igc_league_events')
        .select('gg_event_id, gg_round_id, gg_gross_tournament_id, gg_net_tournament_id')
        .eq('league_key', leagueKey).eq('week_number', week).maybeSingle()
      const persistedHints = ev?.gg_event_id ? {
        ggEventId: ev.gg_event_id,
        ggRoundId: ev.gg_round_id ?? null,
        grossTournamentId: ev.gg_gross_tournament_id ?? null,
        netTournamentId: ev.gg_net_tournament_id ?? null,
      } : null
      // Returns the DiscoverResult (carrying `resolved`); orchestration reads
      // resolved.upstreamStatus and passes `resolved` into importOccurrence.
      return await discoverAndPersistEventClassification({ competitionKey, weekNumber: week, adapterConfig: config.adapterConfig, ggClient, db: classifyDb(supabase, competitionKey), nowIso, persistedHints })
    },
    async importOccurrence(competitionKey, week, nowIso, resolved) {
      const config = (await import('../registry.ts')).getCompetitionConfig(competitionKey)!
      // `resolved` carries the ids discovery already resolved — NO placeholders.
      await importOccurrence({ competitionKey, resolved, adapterConfig: config.adapterConfig, ggClient, db: importDb(supabase, competitionKey), nowIso })
    },
    async rebuildSeasonPoints(competitionKey) {
      await rebuildSeasonPoints({ competitionKey, deps: seasonDeps(supabase, competitionKey) })
    },
  }
}

function classifyDb(supabase: any, competitionKey: string) {
  const leagueKey = competitionKey === 'mens-league' ? 'mens' : 'womens'
  return {
    async updateClassification(w: any) {
      await supabase.from('igc_league_events').update({
        event_format: w.event_format, discovery_state: w.discovery_state,
        discovered_at: w.discovered_at, source_finalized_at: w.source_finalized_at,
        source_version: w.source_version,
      }).eq('league_key', leagueKey).eq('week_number', w.week_number)
      return { ok: true }
    },
  }
}
function importDb(supabase: any, competitionKey: string) {
  const leagueKey = competitionKey === 'mens-league' ? 'mens' : 'womens'
  return {
    async upsertEvent(row: any) {
      const { data } = await supabase.from('igc_league_events').upsert(row).select('id').single()
      return { ok: true, id: (data as any)?.id ?? null }
    },
    async upsertPerformances(rows: any[]) { await supabase.from('igc_league_performances').upsert(rows); return { ok: true } },
    async upsertResults(rows: any[]) { await supabase.from('igc_league_results').upsert(rows); return { ok: true } },
    async upsertSeasonPointEntries(rows: any[]) {
      if (!rows.length) return { ok: true }
      await supabase.from('igc_league_season_point_entries').upsert(
        rows.map((r) => ({
          league_key: leagueKey, week_number: r.week_number,
          member_card_id: r.member_card_id, total_points: r.total_points,
          player_name: r.player_name, synced_at: new Date().toISOString(),
        })),
        { onConflict: 'league_key,week_number,member_card_id' }
      )
      return { ok: true }
    },
    async setDurableImported(week: number, atIso: string, sourceVersion: string | null) {
      await supabase.from('igc_league_events').update({ durable_imported_at: atIso, durable_source_version: sourceVersion })
        .eq('league_key', leagueKey).eq('week_number', week)
      return { ok: true }
    },
  }
}

// Season-points production deps (Correction 5): read AUTHORITATIVE event.season_points
// per completed round — NOT igc_league_results.points (those are weekly per-
// competition points and are NOT the cumulative authoritative totals; they are
// only used if proven identical, which they are not). Scope every query by
// league_key. events_played = weeks with a non-null gross_scores performance;
// wins = count of flight_position=1 results; names from igc_league_members.
// The snapshot is DELETE+REPLACED wholesale (no stale rows); deleted outright
// when there are no points. The accumulation math (cumBeforeLast, rankByTotalPoints)
// lives in season-points.ts.
function seasonDeps(supabase: any, competitionKey: string) {
  const leagueKey = competitionKey === 'mens-league' ? 'mens' : 'womens'
  return {
    async listCompletedRoundsWithPoints() {
      // Authoritative source: GG's embedded event.season_points, captured at
      // import time into igc_league_season_point_entries (Migration 026). Each
      // completed round contributes one array of {member_card_id, total_points,
      // player_name} entries. Ordered by week_number ascending. (If the entries
      // table is not yet populated, fall back to reading the captured season_points
      // JSON from igc_league_events — but never derive from igc_league_results.points.)
      const { data } = await supabase.from('igc_league_season_point_entries')
        .select('week_number, member_card_id, total_points, player_name')
        .eq('league_key', leagueKey).order('week_number', { ascending: true })
      const byRound = new Map<number, { member_card_id: string; total_points: number; player_name?: string | null }[]>()
      for (const r of data ?? []) {
        if (!byRound.has(r.week_number)) byRound.set(r.week_number, [])
        byRound.get(r.week_number)!.push({ member_card_id: r.member_card_id, total_points: Number(r.total_points ?? 0), player_name: r.player_name ?? null })
      }
      return [...byRound.values()]
    },
    async readEventsPlayed() {
      // weeks with a non-null gross_scores performance per member
      const { data } = await supabase.from('igc_league_performances')
        .select('member_card_id, gross_scores').eq('league_key', leagueKey)
      const m = new Map<string, number>()
      for (const r of data ?? []) {
        if (Array.isArray(r.gross_scores) && r.gross_scores.some((g: number | null) => g != null)) {
          m.set(r.member_card_id, (m.get(r.member_card_id) ?? 0) + 1)
        }
      }
      return m
    },
    async readWins() {
      const { data } = await supabase.from('igc_league_results')
        .select('member_card_id, flight_position').eq('league_key', leagueKey).eq('flight_position', 1)
      const m = new Map<string, number>()
      for (const r of data ?? []) m.set(r.member_card_id, (m.get(r.member_card_id) ?? 0) + 1)
      return m
    },
    async readNames() {
      const { data } = await supabase.from('igc_league_members').select('member_card_id, name').eq('league_key', leagueKey)
      return new Map<string, string | null>((data ?? []).map((r: any) => [r.member_card_id, r.name ?? null] as [string, string | null]))
    },
    async replaceSnapshot(rows: any[]) {
      // Wholesale delete + replace (no stale rows).
      await supabase.from('igc_league_season_points').delete().eq('league_key', leagueKey)
      if (rows.length) {
        const payload = rows.map((r) => ({
          league_key: leagueKey, member_card_id: r.member_card_id, player_name: r.player_name,
          position: r.position, previous_position: r.previous_position, total_points: r.total_points,
          events_played: r.events_played, wins: r.wins, points_behind: r.points_behind,
          synced_at: new Date().toISOString(),
        }))
        await supabase.from('igc_league_season_points').insert(payload)
      }
    },
    async deleteSnapshot() {
      await supabase.from('igc_league_season_points').delete().eq('league_key', leagueKey)
      return null
    },
  }
}
