// Integration test: reconcile idempotency + delayed-finalization guard.
// Requires a running local Supabase (`pnpm supabase`) with migrations applied.
// Not a unit test; not picked up by `pnpm test:unit` (top-level glob is
// tests/*.test.ts, non-recursive). Run manually:
//     node --test tests/integration/reconcile-idempotent.mjs
//
// What this exercises (spec tests #10 + #11):
//   - The REAL import → rebuild → snapshot pipeline against local Supabase with
//     a MOCKED GG client (so no network/GG credentials needed). discoverAndPersist
//     is faked to return a ResolvedOccurrence; importOccurrence + rebuildSeasonPoints
//     are the REAL functions wired to the REAL service-client DB layer.
//   - Idempotency (#11): running reconcileCompetition twice produces a byte-identical
//     season-points snapshot (the second run skips the already-durable week).
//   - Completed-round guard (#10): a played-but-not-completed week does NOT advance
//     the snapshot; flipping the mock to completed + re-running DOES advance it.
//
// SKIP GUARD: this test needs NEXT_PUBLIC_SUPABASE_URL (local Supabase). Without it,
// the test skips cleanly so `node --test` here is a no-op, not a failure. The full
// live run is deferred to final verification (run with `pnpm supabase` first).

import { test } from 'node:test'
import assert from 'node:assert/strict'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SKIP_REASON = !SUPABASE_URL
  ? 'skip: NEXT_PUBLIC_SUPABASE_URL unset (local Supabase not running; run `pnpm supabase`)'
  : undefined

// Test weeks use high numbers so they never collide with real league data.
const LEAGUE_KEY = 'mens'
const COMPETITION_KEY = 'mens-league'
const WEEK_A = 901
const WEEK_B = 902
const MEMBER_1 = 'card-test-9001'
const MEMBER_2 = 'card-test-9002'
const NOW_ISO = '2026-07-28T22:00:00Z'

// Build a minimal 18-hole gross scorecard (non-null so events_played counts the week).
function gross18() {
  return [4, 5, 4, 5, 4, 5, 4, 5, 4, 4, 5, 4, 5, 4, 5, 4, 5, 4]
}

// GG tournament-results fixture for one week, two players. `seasonPoints` is the
// authoritative per-round event.season_points array (men's: gross tournament carries
// it; net returns none — import sums across tournaments, so we put it on gross only
// to avoid double-counting). The `position` field drives flight_position parsing.
function tournamentFixture({ players, seasonPoints, completed }) {
  return {
    event: {
      status: completed ? 'completed' : 'in_progress',
      completed_at: completed ? '2026-07-28T22:00:00Z' : null,
      version: completed ? 'v-test-1' : null,
      scopes: [
        {
          name: 'Flight 1',
          aggregates: players.map((p) => ({
            name: p.name,
            position: p.position,
            points: p.points,
            purse: null,
            member_cards: [{ member_card_id_str: p.memberCardId }],
            gross_scores: gross18(),
            net_scores: gross18(),
            to_par_net: gross18().map(() => 0),
            to_par_gross: gross18().map(() => 0),
            totals: {
              gross_scores: { out: 80, total: 80 },
              net_scores: { out: 80, total: 80 },
              to_par_net: { out: 0, total: 0 },
              to_par_gross: { out: 0, total: 0 },
            },
            scorecard_statuses: [{ status: 'Verified' }],
          })),
        },
      ],
      season_points: seasonPoints,
    },
  }
}

// Per-week fixtures keyed by tournament id. The fake GG client dispatches by
// extracting the tournament id from the endpoint path.
function makeWeekFixtures({ week, completed, seasonPoints }) {
  const players = [
    { name: 'Test Player A', memberCardId: MEMBER_1, position: 1, points: 500 },
    { name: 'Test Player B', memberCardId: MEMBER_2, position: 2, points: 300 },
  ]
  const grossId = `g-test-w${week}`
  const netId = `n-test-w${week}`
  const gross = tournamentFixture({ players, seasonPoints, completed })
  const net = tournamentFixture({ players, seasonPoints: undefined, completed })
  return {
    ggEventId: `evt-test-w${week}`,
    ggRoundId: `r-test-w${week}`,
    grossTournamentId: grossId,
    netTournamentId: netId,
    grossFixture: gross,
    netFixture: net,
  }
}

test('reconcile idempotency + delayed-finalization guard', { skip: SKIP_REASON }, async () => {
  const { createServiceClient } = await import('../../lib/supabase/service.ts')
  const { reconcileCompetition } = await import('../../lib/competition/reconcile/reconcile.ts')
  const { importOccurrence } = await import('../../lib/competition/reconcile/import.ts')
  const { rebuildSeasonPoints } = await import('../../lib/competition/reconcile/season-points.ts')
  const { getCompetitionConfig } = await import('../../lib/competition/registry.ts')

  const supabase = createServiceClient()
  const config = getCompetitionConfig(COMPETITION_KEY)
  assert.ok(config, 'mens-league config must exist')

  // --- Test-controlled GG mock. weekStatus[week] = 'completed' | 'in_progress'.
  // Each week has its own resolved ids + fixtures. discoverAndPersist returns the
  // resolved shape importOccurrence expects; importOccurrence fetches results via
  // ggClient keyed on the resolved tournament ids.
  const weekStatus = { [WEEK_A]: 'completed', [WEEK_B]: 'in_progress' }
  const weekFixtures = {
    [WEEK_A]: makeWeekFixtures({ week: WEEK_A, completed: true, seasonPoints: [
      { member_card_id: MEMBER_1, total_points: 500 },
      { member_card_id: MEMBER_2, total_points: 300 },
    ] }),
    [WEEK_B]: makeWeekFixtures({ week: WEEK_B, completed: false, seasonPoints: [
      { member_card_id: MEMBER_1, total_points: 100 },
      { member_card_id: MEMBER_2, total_points: 400 },
    ] }),
  }

  // Fake GG client: dispatch by tournament id (the only endpoint importOccurrence
  // calls is `/events/{evt}/rounds/{round}/tournaments/{tId}.json`).
  function makeGgClient() {
    return async (endpoint) => {
      const m = endpoint.match(/tournaments\/([^/]+)\.json$/)
      const tId = m ? m[1] : null
      for (const f of Object.values(weekFixtures)) {
        if (tId === f.grossTournamentId) return f.grossFixture
        if (tId === f.netTournamentId) return f.netFixture
      }
      throw new Error(`fake GG: no fixture for ${endpoint}`)
    }
  }

  // REAL importDb wired to the service client (mirrors reconcile.ts importDb).
  function importDb() {
    return {
      async upsertEvent(row) {
        await supabase.from('igc_league_events').update({
          gg_event_id: row.gg_event_id, gg_round_id: row.gg_round_id,
          gg_gross_tournament_id: row.gg_gross_tournament_id, gg_net_tournament_id: row.gg_net_tournament_id,
          event_format: row.event_format, discovery_state: row.discovery_state,
          source_finalized_at: row.source_finalized_at, source_version: row.source_version,
          status: row.status,
        }).eq('league_key', row.league_key).eq('week_number', row.week_number)
        return { ok: true }
      },
      async upsertPerformances(rows) { await supabase.from('igc_league_performances').upsert(rows); return { ok: true } },
      async upsertResults(rows) { await supabase.from('igc_league_results').upsert(rows); return { ok: true } },
      async upsertSeasonPointEntries(rows) {
        if (!rows.length) return { ok: true }
        await supabase.from('igc_league_season_point_entries').upsert(
          rows.map((r) => ({
            league_key: r.league_key, week_number: r.week_number,
            member_card_id: r.member_card_id, total_points: r.total_points,
            player_name: r.player_name, synced_at: new Date().toISOString(),
          })),
          { onConflict: 'league_key,week_number,member_card_id' }
        )
        return { ok: true }
      },
      async setDurableImported(week, atIso, sourceVersion) {
        await supabase.from('igc_league_events').update({
          durable_imported_at: atIso, durable_source_version: sourceVersion,
        }).eq('league_key', LEAGUE_KEY).eq('week_number', week)
        return { ok: true }
      },
    }
  }

  // REAL seasonDeps wired to the service client (mirrors reconcile.ts seasonDeps).
  function seasonDeps() {
    return {
      async listCompletedRoundsWithPoints() {
        const { data } = await supabase.from('igc_league_season_point_entries')
          .select('week_number, member_card_id, total_points, player_name')
          .eq('league_key', LEAGUE_KEY).order('week_number', { ascending: true })
        const byRound = new Map()
        for (const r of data ?? []) {
          if (!byRound.has(r.week_number)) byRound.set(r.week_number, [])
          byRound.get(r.week_number).push({
            member_card_id: r.member_card_id,
            total_points: Number(r.total_points ?? 0),
            player_name: r.player_name ?? null,
          })
        }
        return [...byRound.values()]
      },
      async readEventsPlayed() {
        const { data } = await supabase.from('igc_league_performances')
          .select('member_card_id, gross_scores').eq('league_key', LEAGUE_KEY)
        const m = new Map()
        for (const r of data ?? []) {
          if (Array.isArray(r.gross_scores) && r.gross_scores.some((g) => g != null)) {
            m.set(r.member_card_id, (m.get(r.member_card_id) ?? 0) + 1)
          }
        }
        return m
      },
      async readWins() {
        const { data } = await supabase.from('igc_league_results')
          .select('member_card_id, flight_position').eq('league_key', LEAGUE_KEY).eq('flight_position', 1)
        const m = new Map()
        for (const r of data ?? []) m.set(r.member_card_id, (m.get(r.member_card_id) ?? 0) + 1)
        return m
      },
      async readNames() {
        const { data } = await supabase.from('igc_league_members')
          .select('member_card_id, name').eq('league_key', LEAGUE_KEY)
        return new Map((data ?? []).map((r) => [r.member_card_id, r.name ?? null]))
      },
      async replaceSnapshot(rows) {
        await supabase.from('igc_league_season_points').delete().eq('league_key', LEAGUE_KEY)
        if (rows.length) {
          await supabase.from('igc_league_season_points').insert(rows.map((r) => ({
            league_key: LEAGUE_KEY, member_card_id: r.member_card_id, player_name: r.player_name,
            position: r.position, previous_position: r.previous_position, total_points: r.total_points,
            events_played: r.events_played, wins: r.wins, points_behind: r.points_behind,
            synced_at: new Date().toISOString(),
          })))
        }
      },
      async deleteSnapshot() {
        await supabase.from('igc_league_season_points').delete().eq('league_key', LEAGUE_KEY)
        return null
      },
    }
  }

  // Injected ops: listEvents reads the REAL igc_league_events table; discoverAndPersist
  // returns a fake resolved (no real GG discovery); importOccurrence + rebuildSeasonPoints
  // are the REAL functions wired to the real DB layer.
  function makeOps() {
    const ggClient = makeGgClient()
    return {
      async listEvents(competitionKey) {
        const leagueKey = competitionKey === 'mens-league' ? 'mens' : 'womens'
        const { data } = await supabase.from('igc_league_events')
          .select('week_number, event_date, event_format, discovery_state, source_finalized_at, durable_imported_at')
          .eq('league_key', leagueKey).order('week_number', { ascending: false }).limit(200)
        return (data ?? []).map((e) => ({
          week_number: e.week_number, event_date: e.event_date,
          event_format: e.event_format, discovery_state: e.discovery_state,
          upstream_status: e.source_finalized_at ? 'completed' : null,
          durable_imported_at: e.durable_imported_at,
        }))
      },
      async discoverAndPersist(_competitionKey, week, _nowIso) {
        const f = weekFixtures[week]
        const completed = weekStatus[week] === 'completed'
        return {
          resolved: {
            weekNumber: week,
            ggEventId: f.ggEventId,
            ggRoundId: f.ggRoundId,
            grossTournamentId: f.grossTournamentId,
            netTournamentId: f.netTournamentId,
            upstreamStatus: completed ? 'completed' : 'in_progress',
            roundDate: '2026-07-28',
            eventName: `Test Week ${week}`,
            sourceFinalizedAt: completed ? '2026-07-28T22:00:00Z' : null,
            sourceVersion: completed ? `v-test-${week}` : null,
          },
        }
      },
      async importOccurrence(competitionKey, week, nowIso, resolved) {
        await importOccurrence({
          competitionKey, resolved, adapterConfig: config.adapterConfig,
          ggClient, db: importDb(), nowIso,
        })
      },
      async rebuildSeasonPoints(_competitionKey) {
        await rebuildSeasonPoints({ competitionKey: COMPETITION_KEY, deps: seasonDeps() })
      },
    }
  }

  // Read the season-points snapshot, returning a stable sorted JSON string of the
  // MEANINGFUL columns (excludes `id` and `synced_at`, which are wholesale
  // delete+replaced each rebuild so they change every run; idempotency is about
  // the standings payload, not the row identity).
  async function readSnapshot() {
    const { data } = await supabase.from('igc_league_season_points')
      .select('member_card_id, player_name, position, previous_position, total_points, events_played, wins, points_behind')
      .eq('league_key', LEAGUE_KEY)
      .order('member_card_id', { ascending: true })
    return JSON.stringify(data ?? [])
  }

  // Clean slate: remove all test-week rows across the pipeline tables.
  async function cleanWeeks(weeks) {
    await supabase.from('igc_league_season_points').delete().eq('league_key', LEAGUE_KEY)
    await supabase.from('igc_league_season_point_entries').delete().in('week_number', weeks).eq('league_key', LEAGUE_KEY)
    await supabase.from('igc_league_results').delete().in('week_number', weeks).eq('league_key', LEAGUE_KEY)
    await supabase.from('igc_league_performances').delete().in('week_number', weeks).eq('league_key', LEAGUE_KEY)
    await supabase.from('igc_league_events').delete().in('week_number', weeks).eq('league_key', LEAGUE_KEY)
  }

  // Seed igc_league_events for a test week with event_format='unknown' (so the
  // candidate selector classifies it as unknown-unresolved → discover). gg_event_id
  // + event_name + event_date are NOT NULL in the baseline schema; use sentinels.
  async function seedWeek(week) {
    await supabase.from('igc_league_events').insert({
      league_key: LEAGUE_KEY, week_number: week,
      gg_event_id: `seed-evt-w${week}`, event_name: `Test Week ${week}`,
      event_date: '2026-07-28', status: 'upcoming',
      event_format: 'unknown', discovery_state: 'pending',
    })
  }

  // Seed the member roster so readNames() resolves display names.
  async function seedMembers() {
    await supabase.from('igc_league_members').upsert([
      { league_key: LEAGUE_KEY, member_card_id: MEMBER_1, name: 'Test Player A' },
      { league_key: LEAGUE_KEY, member_card_id: MEMBER_2, name: 'Test Player B' },
    ], { onConflict: 'league_key,member_card_id' })
  }

  // ---------- Sub-test 1: idempotency (spec test #11) ----------
  await cleanWeeks([WEEK_A, WEEK_B])
  await seedMembers()
  await seedWeek(WEEK_A)
  weekStatus[WEEK_A] = 'completed'

  const deadlineMs = Date.now() + 120_000

  await reconcileCompetition({
    competitionKey: COMPETITION_KEY, deadlineMs, nowIso: NOW_ISO, ops: makeOps(),
  })
  const snapshotAfterRun1 = await readSnapshot()
  assert.notEqual(snapshotAfterRun1, '[]', 'snapshot populated after first run')

  await reconcileCompetition({
    competitionKey: COMPETITION_KEY, deadlineMs, nowIso: NOW_ISO, ops: makeOps(),
  })
  const snapshotAfterRun2 = await readSnapshot()
  assert.equal(snapshotAfterRun2, snapshotAfterRun1,
    'idempotency: second run produced a byte-identical snapshot payload')

  // ---------- Sub-test 2: delayed-finalization guard (spec test #10) ----------
  // Seed a played-but-not-completed week; reconcile must NOT advance the snapshot.
  await seedWeek(WEEK_B)
  weekStatus[WEEK_B] = 'in_progress'

  const snapshotBeforeB = await readSnapshot()

  await reconcileCompetition({
    competitionKey: COMPETITION_KEY, deadlineMs, nowIso: NOW_ISO, ops: makeOps(),
  })
  const snapshotAfterIncompleteB = await readSnapshot()
  assert.equal(snapshotAfterIncompleteB, snapshotBeforeB,
    'completed-round guard: in_progress week did NOT advance the snapshot')

  // Flip the mock to completed + season_points; reconcile must now advance it.
  weekStatus[WEEK_B] = 'completed'
  // Flip the fixtures to carry completed status + season_points.
  weekFixtures[WEEK_B] = makeWeekFixtures({ week: WEEK_B, completed: true, seasonPoints: [
    { member_card_id: MEMBER_1, total_points: 100 },
    { member_card_id: MEMBER_2, total_points: 400 },
  ] })

  await reconcileCompetition({
    competitionKey: COMPETITION_KEY, deadlineMs, nowIso: NOW_ISO, ops: makeOps(),
  })
  const snapshotAfterCompletedB = await readSnapshot()
  assert.notEqual(snapshotAfterCompletedB, snapshotAfterIncompleteB,
    'after finalization, the snapshot advanced')

  // Sanity: the new snapshot reflects the cumulative totals (M1=600, M2=700).
  const parsed = JSON.parse(snapshotAfterCompletedB)
  const byMember = Object.fromEntries(parsed.map((r) => [r.member_card_id, Number(r.total_points)]))
  assert.equal(byMember[MEMBER_1], 600, 'M1 cumulative = 500 + 100')
  assert.equal(byMember[MEMBER_2], 700, 'M2 cumulative = 300 + 400')
})
