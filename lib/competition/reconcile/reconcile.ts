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
import { canonicalFlight } from '../projected-flights.ts'
import type { ResolvedOccurrence } from '../types.ts'

export interface ReconcileSummary {
  competition: string
  discovered: number
  imported: number
  skipped: number
  // Candidates skipped by the staleness gate (last GG discovery < STALENESS_MS
  // ago). Lets the frequent-reconcile cadence prove it is throttling re-reads
  // rather than hammering GG every tick.
  staleSkipped: number
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
  discoverAndPersist(competitionKey: string, week: number, nowIso: string): Promise<{
    resolved: ResolvedOccurrence
    officialFlightMembershipAvailable?: boolean
  }>
  importOccurrence(competitionKey: string, week: number, nowIso: string, resolved: ResolvedOccurrence): Promise<void>
  rebuildSeasonPoints(competitionKey: string): Promise<void>
  // Idempotently precreate configured special-occurrence rows (Club Championship
  // 101/102) so reconcile sees them as candidates. Best-effort: a failure is
  // logged but does not abort the run (next run retries). Optional so injected
  // test ops without it are unaffected.
  precreateSpecialOccurrences?(competitionKey: string): Promise<number>
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
      summaries.push({ competition: config.key, discovered: 0, imported: 0, skipped: 0, staleSkipped: 0, seasonPointsRebuilds: 0, errors: [String(err)], stoppedForBudget: false })
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
  const summary: ReconcileSummary = { competition: input.competitionKey, discovered: 0, imported: 0, skipped: 0, staleSkipped: 0, seasonPointsRebuilds: 0, errors: [], stoppedForBudget: false }
  const ops = input.ops ?? (await defaultOps())

  // Precreate configured special-occurrence rows (Club Championship 101/102)
  // BEFORE listing candidates so they appear in this run. Best-effort: a failure
  // is logged but does not abort — the rows retry on the next hourly run.
  if (ops.precreateSpecialOccurrences) {
    try {
      await ops.precreateSpecialOccurrences(input.competitionKey)
    } catch (err) {
      summary.errors.push(`precreate: ${String(err)}`)
    }
  }

  const events = await ops.listEvents(input.competitionKey)
  const candidates = selectReconciliationCandidates(events, input.nowIso)

  for (const c of candidates) {
    if (Date.now() + RESERVE_MS >= input.deadlineMs) { summary.stoppedForBudget = true; break }
    try {
      if (c.action === 'skip') {
        if (c.kind === 'stale') summary.staleSkipped++
        else summary.skipped++
        continue
      }
      // ALWAYS discover — discovery returns the ResolvedOccurrence (ids +
      // upstream status). Candidate pre-selection only decides skip-vs-process;
      // the import decision uses the DISCOVERED upstream status, so an
      // unresolved candidate that GG now marks completed is imported in the
      // same run (Correction 6). No placeholders: `resolved` flows discovery→import.
      const r = await ops.discoverAndPersist(input.competitionKey, c.week_number, input.nowIso)
      summary.discovered++
      const officialFlightsReady = c.kind !== 'awaiting-official-flights' || r.officialFlightMembershipAvailable === true
      if (r.resolved.upstreamStatus === 'completed' && officialFlightsReady) {
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

// On-demand, per-occurrence read-through invoked from a page view
// (StandingsWorkspaceServer). This is the PRIMARY freshness mechanism — no cron,
// no managed secret: when a viewer loads a round whose data is missing or stale,
// the render reads GG and writes the results to the DB so every later view reads
// from disk. Reuses the SAME classification + discover→import→rebuild sequence as
// the daily cron, gated for ONE occurrence:
//   - durable_imported_at set (already imported) → skip (steady state: a
//     finalized round is never re-read; covers the 5 days/week nothing's pending).
//   - discovered within STALENESS_MS → skip (staleness gate: a round is re-read
//     from GG at most once per minute; overlap-safe across simultaneous viewers).
//   - otherwise → discover; if GG now marks it completed → import + rebuild the
//     season-points snapshot so the Season view is current too.
// Best-effort: a page render MUST NOT break because a GG fetch failed, so every
// error is caught and returned as { action: 'error' }. The caller ignores the
// result for rendering (it re-resolves occurrences only when `imported`).
export interface OnDemandReconcileResult {
  action: 'skipped-durable' | 'skipped-stale' | 'skipped-absent' | 'discovered' | 'imported' | 'error'
  discovered?: boolean
  imported?: boolean
  upstreamStatus?: string | null
  error?: string
}

export async function reconcileOccurrenceOnDemand(
  competitionKey: string,
  weekNumber: number,
  nowIso: string,
  ops?: ReconcileOps,
): Promise<OnDemandReconcileResult> {
  try {
    const o = ops ?? (await defaultOps())
    // Ensure configured special-occurrence rows (Club Championship 101/102)
    // exist as candidates, mirroring reconcileCompetition. Best-effort.
    if (o.precreateSpecialOccurrences) {
      try { await o.precreateSpecialOccurrences(competitionKey) } catch { /* next run retries */ }
    }
    const events = await o.listEvents(competitionKey)
    const candidates = selectReconciliationCandidates(events, nowIso)
    const c = candidates.find((x) => x.week_number === weekNumber)
    if (!c) return { action: 'skipped-absent' }
    if (c.action === 'skip') {
      return { action: c.kind === 'stale' ? 'skipped-stale' : 'skipped-durable' }
    }
    const r = await o.discoverAndPersist(competitionKey, weekNumber, nowIso)
    if (r.resolved.upstreamStatus === 'completed') {
      await o.importOccurrence(competitionKey, weekNumber, nowIso, r.resolved)
      await o.rebuildSeasonPoints(competitionKey)
      return { action: 'imported', discovered: true, imported: true, upstreamStatus: 'completed' }
    }
    return { action: 'discovered', discovered: true, upstreamStatus: r.resolved.upstreamStatus }
  } catch (err) {
    return { action: 'error', error: String(err) }
  }
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
  const { precreateSpecialOccurrences } = await import('./precreate.ts')
  const supabase = createServiceClient()
  // 404-tolerant client: a missing tournament .json ("not found yet") resolves
  // to null instead of throwing, per discovery's ERROR CONTRACT. This is what
  // stops unfinalized rounds from surfacing as `wk{N}: ... 404` reconcile errors.
  const ggClient = (async (endpoint: string) => makeGolfGeniusRequestOptional({ endpoint })) as any
  return {
    async precreateSpecialOccurrences(competitionKey) {
      // Check-then-insert (ON CONFLICT DO NOTHING semantically): never clobber an
      // existing row's reconcile state. A race between check+insert surfaces as
      // a 23505 unique violation, treated as "already exists" (idempotent).
      const db = {
        async upsertIgnoreDuplicates(row: any) {
          const { data: existing } = await supabase.from('igc_league_events')
            .select('id').eq('league_key', row.league_key).eq('week_number', row.week_number).maybeSingle()
          if (existing) return { inserted: false }
          const { error } = await supabase.from('igc_league_events').insert(row)
          if (error) {
            if (error.code === '23505') return { inserted: false } // race: another run inserted first
            throw new Error(`igc_league_events precreate wk${row.week_number}: ${error.message}`)
          }
          return { inserted: true }
        },
      }
      return precreateSpecialOccurrences(competitionKey, db)
    },
    async listEvents(competitionKey) {
      const leagueKey = competitionKey === 'mens-league' ? 'mens' : 'womens'
      const { data } = await supabase.from('igc_league_events')
        .select('week_number, event_date, event_format, discovery_state, source_finalized_at, durable_imported_at, discovered_at')
        .eq('league_key', leagueKey).order('week_number', { ascending: false }).limit(200)
      // A position-1 result is a compact existence marker for stored named
      // flight membership: at most a few rows per finalized occurrence rather
      // than every player result. Canonicalization remains Planit-domain logic;
      // the legacy flights_finalized column is intentionally not consulted.
      const officialFlightWeeks = new Set<number>()
      let officialFlightEvidenceLoaded = competitionKey !== 'mens-league'
      if (competitionKey === 'mens-league') {
        const pageSize = 1000
        for (let from = 0; ; from += pageSize) {
          const { data: placed, error } = await supabase.from('igc_league_results')
            .select('week_number, flight_name')
            .eq('league_key', leagueKey)
            .eq('flight_position', 1)
            .range(from, from + pageSize - 1)
          if (error) break
          for (const row of placed ?? []) {
            if (canonicalFlight(row.flight_name) !== null) officialFlightWeeks.add(Number(row.week_number))
          }
          if ((placed ?? []).length < pageSize) {
            officialFlightEvidenceLoaded = true
            break
          }
        }
      }
      return (data ?? []).map((e: any) => ({
        week_number: e.week_number, event_date: e.event_date,
        event_format: e.event_format, discovery_state: e.discovery_state,
        upstream_status: e.source_finalized_at ? 'completed' : null,
        durable_imported_at: e.durable_imported_at,
        awaiting_official_flights: competitionKey === 'mens-league'
          && e.event_format === 'individual'
          && !!e.source_finalized_at
          && !!e.durable_imported_at
          && officialFlightEvidenceLoaded
          && !officialFlightWeeks.has(Number(e.week_number)),
        // Feeds the staleness gate in selectReconciliationCandidates so frequent
        // runs don't re-read GG for an occurrence discovered within STALENESS_MS.
        discovered_at: e.discovered_at ?? null,
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
      const discovered = await discoverAndPersistEventClassification({ competitionKey, weekNumber: week, adapterConfig: config.adapterConfig, ggClient, db: classifyDb(supabase, competitionKey), nowIso, persistedHints })
      const officialFlightMembershipAvailable = competitionKey === 'mens-league'
        && !!discovered.leaderboard?.entries.some((entry) => canonicalFlight(entry.flight) !== null)
      return { ...discovered, officialFlightMembershipAvailable }
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
  // FAILURE-PROPAGATION CONTRACT: supabase-js does NOT throw on upsert/update
  // errors — it resolves { data, error }. Previously every writer here ignored
  // `.error` and returned { ok: true }, so a failed performances upsert (e.g.
  // a NOT NULL / CHECK / unknown-column violation) was swallowed, the week was
  // stamped durable_imported_at anyway, and reconcile reported errors:[] while
  // igc_league_performances stayed empty (the weeks-17/18 contract violation).
  // Now every required write checks `.error` and throws with table + week +
  // context; importOccurrence awaits these in order with setDurableImported
  // LAST, so any required-write failure makes durable unreachable, and the
  // reconcile loop surfaces it in errors[] instead of incrementing imported.
  return {
    async upsertEvent(row: any) {
      // UPDATE (not UPSERT). The event row is created by the seeder/legacy and
      // ALWAYS pre-exists by import time — reconcile only imports candidates
      // returned by listEvents (existing rows), and discovery's
      // updateClassification also UPDATEs (never creates). igc_league_events has
      // event_name + event_date NOT NULL with NO default, so an UPSERT that omits
      // them fails: `INSERT ... ON CONFLICT (league_key,week_number) DO UPDATE`
      // still constructs the INSERT row, and the 23502 NOT NULL violation on
      // event_name is NOT the arbiter unique violation (23505) that ON CONFLICT
      // catches — so it propagates and the merge never happens (the exact
      // weeks-17/18 break: upsertEvent returned no row → eventId/eventName null
      // → perf rows got event_name null → perf upsert failed NOT NULL → 0 rows,
      // durable stamped anyway). UPDATE sets only the import columns and PRESERVES
      // event_name/event_date, which we RETURN so performance rows can populate
      // event_name (also NOT NULL on igc_league_performances).
      //
      // Do NOT set source_finalized_at / source_version here: discovery owns
      // those (discover.ts sets source_finalized_at = sourceFinalizedAt ?? nowIso
      // — the nowIso fallback is required because GG's tournament .json for
      // finalized rounds often has NO event.completed_at). Setting them from the
      // raw resolved.sourceFinalizedAt (null when completed_at is absent) would
      // CLOBBER discovery's correct nowIso value back to null, breaking the
      // finalized signal and candidate selection on the next run.
      const { data, error } = await supabase.from('igc_league_events')
        .update({
          gg_event_id: row.gg_event_id, gg_round_id: row.gg_round_id,
          gg_gross_tournament_id: row.gg_gross_tournament_id, gg_net_tournament_id: row.gg_net_tournament_id,
          event_format: row.event_format, discovery_state: row.discovery_state,
          status: row.status,
        })
        .eq('league_key', row.league_key).eq('week_number', row.week_number)
        .select('id,event_name,event_date').single()
      if (error) throw new Error(`igc_league_events update wk${row.week_number}: ${error.message}`)
      return { ok: true, id: (data as any)?.id ?? null, event_name: (data as any)?.event_name ?? null, event_date: (data as any)?.event_date ?? null }
    },
    async upsertPerformances(rows: any[]) {
      const { data, error } = await supabase.from('igc_league_performances')
        .upsert(rows, { onConflict: 'league_key,week_number,player_name' }).select('id')
      if (error) throw new Error(`igc_league_performances upsert wk${rows[0]?.week_number}: ${error.message}`)
      // A completed round must produce performances. PostgREST normally returns
      // an error for any constraint violation, but defend against a silent
      // partial/zero write (a swallowed constraint, a BEFORE-trigger dropping
      // rows): if fewer rows came back than we sent, treat it as failure so the
      // week cannot become durable with empty performances.
      if ((data?.length ?? 0) !== rows.length) {
        throw new Error(`igc_league_performances upsert wk${rows[0]?.week_number}: wrote ${data?.length ?? 0} of ${rows.length} rows`)
      }
      return { ok: true }
    },
    async prunePerformances(week: number, retainedPlayerNames: string[]) {
      const { data: existing, error: readError } = await supabase.from('igc_league_performances')
        .select('player_name').eq('league_key', leagueKey).eq('week_number', week).limit(1000)
      if (readError) throw new Error(`igc_league_performances prune read wk${week}: ${readError.message}`)
      const retained = new Set(retainedPlayerNames)
      const staleNames = (existing ?? [])
        .map((row: any) => String(row.player_name))
        .filter((name: string) => !retained.has(name))
      if (staleNames.length) {
        const { error } = await supabase.from('igc_league_performances').delete()
          .eq('league_key', leagueKey).eq('week_number', week).in('player_name', staleNames)
        if (error) throw new Error(`igc_league_performances prune wk${week}: ${error.message}`)
      }
      return { ok: true }
    },
    async upsertResults(rows: any[]) {
      const { error } = await supabase.from('igc_league_results')
        .upsert(rows, { onConflict: 'league_key,week_number,member_card_id,competition' })
      if (error) throw new Error(`igc_league_results upsert wk${rows[0]?.week_number}: ${error.message}`)
      return { ok: true }
    },
    async pruneResults(week: number, importedAtIso: string, competitions: Array<'gross' | 'net'>) {
      if (!competitions.length) return { ok: true }
      // Every row in the just-imported authoritative snapshot receives the
      // same synced_at. Anything older for those scoring modes is absent from
      // the new snapshot and must not survive as an Overall-only ghost row.
      const { error } = await supabase.from('igc_league_results').delete()
        .eq('league_key', leagueKey).eq('week_number', week)
        .in('competition', competitions).lt('synced_at', importedAtIso)
      if (error) throw new Error(`igc_league_results prune wk${week}: ${error.message}`)
      return { ok: true }
    },
    async upsertSeasonPointEntries(rows: any[]) {
      if (!rows.length) return { ok: true }
      const { error } = await supabase.from('igc_league_season_point_entries').upsert(
        rows.map((r) => ({
          league_key: leagueKey, week_number: r.week_number,
          member_card_id: r.member_card_id, total_points: r.total_points,
          player_name: r.player_name, synced_at: new Date().toISOString(),
        })),
        { onConflict: 'league_key,week_number,member_card_id' }
      )
      if (error) throw new Error(`igc_league_season_point_entries upsert wk${rows[0]?.week_number}: ${error.message}`)
      return { ok: true }
    },
    async pruneSeasonPointEntries(week: number, retainedMemberIds: string[]) {
      const { data: existing, error: readError } = await supabase.from('igc_league_season_point_entries')
        .select('member_card_id').eq('league_key', leagueKey).eq('week_number', week).limit(1000)
      if (readError) throw new Error(`igc_league_season_point_entries prune read wk${week}: ${readError.message}`)
      const retained = new Set(retainedMemberIds)
      const staleIds = (existing ?? [])
        .map((row: any) => String(row.member_card_id))
        .filter((id: string) => !retained.has(id))
      if (staleIds.length) {
        const { error } = await supabase.from('igc_league_season_point_entries').delete()
          .eq('league_key', leagueKey).eq('week_number', week).in('member_card_id', staleIds)
        if (error) throw new Error(`igc_league_season_point_entries prune wk${week}: ${error.message}`)
      }
      return { ok: true }
    },
    async setDurableImported(week: number, atIso: string, sourceVersion: string | null) {
      const { error } = await supabase.from('igc_league_events').update({ durable_imported_at: atIso, durable_source_version: sourceVersion })
        .eq('league_key', leagueKey).eq('week_number', week)
      if (error) throw new Error(`setDurableImported wk${week}: ${error.message}`)
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
  // Paginated select. supabase-js caps a single select at 1000 rows; the
  // entries table (2617+ rows for a full men's season) and the performances
  // table (2300+ rows) both exceed that. Without paging, listCompletedRounds
  // summed only weeks 1–7 and the season-points snapshot was built from a
  // truncated entry set. Pages until a short page is returned.
  async function selectAll(table: string, cols: string, eq: Record<string, unknown>): Promise<any[]> {
    const PAGE = 1000
    const rows: any[] = []
    let from = 0
    while (true) {
      const r = await supabase.from(table).select(cols).match(eq).range(from, from + PAGE - 1)
      if (r.error) return rows
      rows.push(...(r.data ?? []))
      if ((r.data ?? []).length < PAGE) return rows
      from += PAGE
    }
  }
  return {
    async listCompletedRoundsWithPoints() {
      // Authoritative source: GG's embedded event.season_points, captured at
      // import time into igc_league_season_point_entries (Migration 026). Each
      // completed round contributes one array of {member_card_id, total_points,
      // player_name} entries. Ordered by week_number ascending. (If the entries
      // table is not yet populated, fall back to reading the captured season_points
      // JSON from igc_league_events — but never derive from igc_league_results.points.)
      const data = await selectAll('igc_league_season_point_entries', 'week_number, member_card_id, total_points, player_name', { league_key: leagueKey })
      data.sort((a: any, b: any) => a.week_number - b.week_number)
      const byRound = new Map<number, { member_card_id: string; total_points: number; player_name?: string | null }[]>()
      for (const r of data) {
        if (!byRound.has(r.week_number)) byRound.set(r.week_number, [])
        byRound.get(r.week_number)!.push({ member_card_id: r.member_card_id, total_points: Number(r.total_points ?? 0), player_name: r.player_name ?? null })
      }
      return [...byRound.values()]
    },
    async readEventsPlayed() {
      // weeks with a non-null gross_scores performance per member
      const data = await selectAll('igc_league_performances', 'member_card_id, gross_scores', { league_key: leagueKey })
      const m = new Map<string, number>()
      for (const r of data) {
        if (Array.isArray(r.gross_scores) && r.gross_scores.some((g: number | null) => g != null)) {
          m.set(r.member_card_id, (m.get(r.member_card_id) ?? 0) + 1)
        }
      }
      return m
    },
    async readWins() {
      const data = await selectAll('igc_league_results', 'member_card_id, flight_position', { league_key: leagueKey, flight_position: 1 })
      const m = new Map<string, number>()
      for (const r of data) m.set(r.member_card_id, (m.get(r.member_card_id) ?? 0) + 1)
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
