// Server-side I/O readers for the league competition shell. These port the
// existing lib/igc/league.ts + weekly-results.ts DB queries through the generic
// competition domain types so the shared shell never sees igc_league_* column
// names. They are I/O (not unit-tested here); the pure mapping they call
// (mapLeagueEventToOccurrence, leagueOccurrenceLabel, buildHoles, positionOrder,
// positionLabelOf, playerKey, deriveResultStatus, isDurableCurrent) is already
// covered by the competition test suite.
//
// Client split (project rule — least privilege):
//   - All four readers use the RLS-respecting server client (createClient).
//     The league tables they read — igc_league_events / igc_league_performances
//     / igc_league_results / igc_league_season_points — all have public SELECT
//     RLS policies, so the RLS-respecting client returns the same rows the
//     service client would, without bypassing RLS. The service client is
//     reserved for service-role-only tables (e.g. igc_league_season_point_entries,
//     the per-round source the reconcile pipeline writes); none of these
//     readers touch those.

import { createClient } from '@/lib/supabase/server'
import { getCompetitionConfig } from '@/lib/competition/registry'
import { deriveResultStatus } from '@/lib/competition/result-status'
import { isDurableCurrent } from '@/lib/competition/durable-current'
import { isOccurrenceActive } from '@/lib/competition/active-window'
import {
  buildLeagueActiveWindow,
  leagueOccurrenceLabel,
  mapLeagueEventToOccurrence,
} from '@/lib/competition/adapters/golfgenius/mapping'
import {
  buildHoles,
  playerKey,
  positionLabelOf,
  positionOrder,
} from '@/lib/igc/weekly-results-helpers'
import type {
  GroupingAvailability,
  LiveResponse,
  Occurrence,
  ScoringMode,
} from '@/lib/competition/types'
import type { SeasonPointsRow } from '@/lib/competition/reconcile/season-points'

const leagueKeyFor = (competitionKey: string): 'mens' | 'womens' =>
  competitionKey === 'mens-league' ? 'mens' : 'womens'

// ---------------------------------------------------------------------------
// 1. Occurrences — list the league's weeks as generic Occurrence[].
// ---------------------------------------------------------------------------

interface EventRow {
  week_number: number
  event_name: string | null
  event_date: string | null
  event_format: 'individual' | 'team' | 'unknown' | null
  discovery_state: 'pending' | 'discovered' | 'inconclusive' | 'failed' | null
  source_finalized_at: string | null
  source_version: string | null
  durable_source_version: string | null
  durable_imported_at: string | null
}

export async function resolveOccurrences(competitionKey: string): Promise<Occurrence[]> {
  const config = getCompetitionConfig(competitionKey)
  if (!config) return []
  const leagueKey = leagueKeyFor(competitionKey)
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('igc_league_events')
    .select('week_number, event_name, event_date, event_format, discovery_state, source_finalized_at, source_version, durable_source_version, durable_imported_at')
    .eq('league_key', leagueKey)
    .order('event_date', { ascending: true })
    .limit(200)

  if (error || !data) return []

  const nowIso = new Date().toISOString()
  const tz = config.schedule?.timezone ?? 'America/Los_Angeles'
  const playStartLocal = config.schedule?.playStartLocal
  const windowHours = config.schedule?.windowHours

  const occurrences: Occurrence[] = []
  for (const e of data as EventRow[]) {
    const durableFinalized = isDurableCurrent({
      sourceFinalizedAt: e.source_finalized_at ?? null,
      sourceVersion: e.source_version ?? null,
      durableSourceVersion: e.durable_source_version ?? null,
      durableImportedAt: e.durable_imported_at ?? null,
    })
    // Persisted finalized rounds carry source_finalized_at → upstream 'completed'.
    // Rounds without it are unknown here; the live path re-derives authoritatively.
    const upstreamStatus = e.source_finalized_at ? 'completed' : 'unknown'
    const window = buildLeagueActiveWindow({ date: e.event_date, tz, playStartLocal, windowHours })
      ?? { start: e.event_date ?? '', end: null }
    const active = isOccurrenceActive(window, nowIso, false)
    const resultStatus = deriveResultStatus({
      upstreamStatus,
      active,
      // For the occurrence listing we don't query per-week performance evidence;
      // durableFinalized is the authoritative final signal and is checked first.
      hasResults: durableFinalized,
      anyPartial: false,
      durableFinalized,
    })
    const label = leagueOccurrenceLabel(
      config.navigation.labelRule,
      e.week_number,
      e.event_name ?? null,
      e.event_date ?? null,
    )
    occurrences.push(
      mapLeagueEventToOccurrence(
        {
          week_number: e.week_number,
          event_name: e.event_name ?? null,
          event_date: e.event_date ?? null,
          event_format: e.event_format ?? null,
          discovery_state: e.discovery_state ?? null,
        },
        label,
        window,
        resultStatus,
      ),
    )
  }
  return occurrences
}

// ---------------------------------------------------------------------------
// 1b. Direct result evidence for default selection (§3 / §4). DIRECT evidence
//     of stored result rows and posted scorecards — never inferred from
//     source_finalized_at / resultStatus, which are absent for legacy imports.
//     `hasResults` is the set of occurrence ids with at least one stored
//     igc_league_results row; `todayHasPostedGolf` is true when today's week
//     has any performance with completed holes. Both use cheap head-counts so
//     PostgREST's 1000-row cap never truncates the answer.
// ---------------------------------------------------------------------------

export async function resolveWeeksWithResults(
  competitionKey: string,
  weekNumbers: number[],
): Promise<Set<string>> {
  if (weekNumbers.length === 0) return new Set()
  const leagueKey = leagueKeyFor(competitionKey)
  const supabase = await createClient()
  const counts = await Promise.all(
    weekNumbers.map((w) =>
      supabase
        .from('igc_league_results')
        .select('id', { count: 'exact', head: true })
        .eq('league_key', leagueKey)
        .eq('week_number', w),
    ),
  )
  const set = new Set<string>()
  weekNumbers.forEach((w, i) => {
    if ((counts[i].count ?? 0) > 0) set.add(String(w))
  })
  return set
}

export async function resolveHasPostedGolf(
  competitionKey: string,
  weekNumber: number,
): Promise<boolean> {
  if (!Number.isFinite(weekNumber)) return false
  const leagueKey = leagueKeyFor(competitionKey)
  const supabase = await createClient()
  // holes_completed > 0 is direct scorecard evidence. (gross_scores is an
  // array; holes_completed is the rolled-up count and is directly queryable.)
  const { count } = await supabase
    .from('igc_league_performances')
    .select('id', { count: 'exact', head: true })
    .eq('league_key', leagueKey)
    .eq('week_number', weekNumber)
    .gt('holes_completed', 0)
  return (count ?? 0) > 0
}

// ---------------------------------------------------------------------------
// 2. Historical final — build a generic LiveResponse from the DB (no GG fetch).
// ---------------------------------------------------------------------------

interface PerformanceRow {
  player_name: string
  member_card_id: string | null
  gross_scores: (number | null)[] | null
  net_scores: (number | null)[] | null
  to_par_net: (number | null)[] | null
  to_par_gross: (number | null)[] | null
  net_total: number | null
  gross_total: number | null
  to_par_net_total: number | null
  to_par_gross_total: number | null
  holes_completed: number | null
  scorecard_status: string | null
}

interface ResultRow {
  member_card_id: string | null
  player_name: string
  flight_name: string | null
  position_label: string | null
  points: string | number | null
  purse: string | null
}

export async function buildHistoricalLiveResponse(
  competitionKey: string,
  selected: Occurrence,
  scoring: ScoringMode,
): Promise<LiveResponse | null> {
  const leagueKey = leagueKeyFor(competitionKey)
  const weekNumber = Number(selected.id)
  if (!Number.isFinite(weekNumber)) return null
  const supabase = await createClient()

  const [perfsRes, resultsRes] = await Promise.all([
    supabase
      .from('igc_league_performances')
      .select('player_name, member_card_id, gross_scores, net_scores, to_par_net, to_par_gross, net_total, gross_total, to_par_net_total, to_par_gross_total, holes_completed, scorecard_status')
      .eq('league_key', leagueKey)
      .eq('week_number', weekNumber)
      .limit(1000),
    supabase
      .from('igc_league_results')
      .select('member_card_id, player_name, flight_name, position_label, points, purse')
      .eq('league_key', leagueKey)
      .eq('week_number', weekNumber)
      .eq('competition', scoring)
      .order('flight_position', { ascending: true, nullsFirst: false })
      .order('player_name', { ascending: true })
      .limit(2000),
  ])

  if (perfsRes.error || resultsRes.error) return null
  const perfs = (perfsRes.data ?? []) as PerformanceRow[]
  const results = (resultsRes.data ?? []) as ResultRow[]
  if (perfs.length === 0 && results.length === 0) {
    // No persisted results yet — honest unknown state, not a fake final.
    return {
      occurrence: selected,
      leaderboard: null,
      resultStatus: selected.resultStatus === 'final' ? 'final' : 'unknown',
      eventFormat: selected.format,
      discoveryState: selected.discoveryState,
      durableCurrent: selected.resultStatus === 'final',
      showingLastKnown: false,
    }
  }

  // Scorecards: one per player-round, deduped by playerKey.
  const scorecardByKey = new Map<string, NonNullable<LiveResponse['leaderboard']>['scorecards'][number]>()
  for (const p of perfs) {
    const name = p.player_name
    const key = playerKey(p.member_card_id, name)
    const holes = buildHoles(p.gross_scores ?? null, p.net_scores ?? null, p.to_par_net ?? null, p.to_par_gross ?? null)
    const holesCompleted = p.holes_completed ?? holes.filter((h) => h.gross !== null || h.net !== null).length
    if (scorecardByKey.has(key)) continue
    scorecardByKey.set(key, {
      key,
      memberCardId: p.member_card_id ?? null,
      name,
      netTotal: p.net_total ?? null,
      grossTotal: p.gross_total ?? null,
      toParNet: p.to_par_net_total ?? null,
      toParGross: p.to_par_gross_total ?? null,
      holesCompleted,
      scorecardStatus: p.scorecard_status ?? null,
      isLive: false, // historical final — finished cards show "F"
      holes,
    })
  }

  // Entries: per-competition placements, sorted by finishing position.
  const entries: NonNullable<LiveResponse['leaderboard']>['entries'] = results
    .map((r) => {
      const name = r.player_name
      const key = playerKey(r.member_card_id, name)
      const points = r.points !== null && r.points !== '' ? Number(r.points) : null
      return {
        key,
        name,
        positionLabel: positionLabelOf(r.position_label),
        positionOrder: positionOrder(r.position_label),
        points: Number.isFinite(points as number) ? (points as number) : null,
        purse: r.purse ?? null,
        flight: r.flight_name ?? null,
      }
    })
    .sort((a, b) => a.positionOrder - b.positionOrder || a.name.localeCompare(b.name))

  const leaderboard: NonNullable<LiveResponse['leaderboard']> = {
    occurrenceId: selected.id,
    scoringMode: scoring,
    // Unflighted leaderboard — the live-grouping policy + grouping filter is
    // applied downstream by deriveOccurrenceCapabilities / the workspace.
    grouping: null,
    entries,
    scorecards: [...scorecardByKey.values()],
    resultStatus: 'final',
    durableCurrent: true,
  }

  return {
    occurrence: selected,
    leaderboard,
    resultStatus: 'final',
    eventFormat: selected.format,
    discoveryState: selected.discoveryState,
    durableCurrent: true,
    showingLastKnown: false,
  }
}

// ---------------------------------------------------------------------------
// 3. Available groupings — the RAW truth; the hide-until-final mask is applied
//    downstream by deriveOccurrenceCapabilities inside buildStandingsViewModel.
// ---------------------------------------------------------------------------

export async function resolveAvailableGroupings(
  competitionKey: string,
  selectedId: string | null,
): Promise<GroupingAvailability> {
  // Women's league is a single Overall field — always one grouping.
  if (competitionKey === 'womens-league') {
    return { kind: 'single', grouping: { key: 'overall', label: 'Overall' } }
  }
  if (!selectedId) return { kind: 'none' }
  const weekNumber = Number(selectedId)
  if (!Number.isFinite(weekNumber)) return { kind: 'none' }

  const supabase = await createClient()
  // Distinct flight_name for the selected week. Live weeks have no flights
  // assigned yet (flight_name null) → 'none'; finalized weeks with ≥1 flight
  // → 'multi'. The PostgREST row cap doesn't bite here: we only need the
  // distinct flight labels, and a league round has at most a handful of flights.
  const { data, error } = await supabase
    .from('igc_league_performances')
    .select('flight_name')
    .eq('league_key', 'mens')
    .eq('week_number', weekNumber)
    .not('flight_name', 'is', null)

  if (error || !data) return { kind: 'none' }
  const flights = Array.from(new Set(data.map((r: { flight_name: string | null }) => r.flight_name).filter((v): v is string => !!v)))
  if (flights.length === 0) return { kind: 'none' }
  flights.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  return {
    kind: 'multi',
    groupings: flights.map((f) => ({ key: f, label: f })),
    defaultAll: true,
  }
}

// ---------------------------------------------------------------------------
// 4. Season points — read the cumulative snapshot. RLS-respecting client.
// ---------------------------------------------------------------------------

// The cumulative season-points snapshot lives in igc_league_season_points (the
// reconcile pipeline maintains it via rebuildSeasonPoints → replaceSnapshot).
// That table carries the exact SeasonPointsRow columns (position,
// previous_position, total_points, events_played, wins, points_behind) and has
// a public SELECT RLS policy, so the RLS-respecting server client is the
// least-privilege choice. The brief's comment text named
// igc_league_season_point_entries, but that table is the per-round authoritative
// source (one row per league/week/member, service-role-only, no public SELECT)
// that rebuildSeasonPoints consumes — it lacks the display columns
// SeasonPointsRow requires, so it is not the right table to read here.
export async function resolveSeasonPoints(competitionKey: string): Promise<SeasonPointsRow[]> {
  const leagueKey = leagueKeyFor(competitionKey)
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('igc_league_season_points')
    .select('member_card_id, player_name, total_points, position, previous_position, events_played, wins, points_behind')
    .eq('league_key', leagueKey)
    .order('position', { ascending: true, nullsFirst: false })
    .order('total_points', { ascending: false })

  if (error || !data) return []
  return (data as Array<{
    member_card_id: string
    player_name: string | null
    total_points: string | number | null
    position: number | null
    previous_position: number | null
    events_played: number | null
    wins: number | null
    points_behind: string | number | null
  }>).map((r) => ({
    member_card_id: r.member_card_id,
    player_name: r.player_name ?? null,
    total_points: r.total_points !== null ? Number(r.total_points) : 0,
    position: r.position ?? 0,
    previous_position: r.previous_position ?? null,
    events_played: r.events_played ?? 0,
    wins: r.wins ?? 0,
    points_behind: r.points_behind !== null ? Number(r.points_behind) : 0,
  }))
}
