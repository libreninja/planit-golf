import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rebuildSeasonPoints, rankByTotalPoints } from '../lib/competition/reconcile/season-points.ts'

// One completed round's authoritative event.season_points entries (gross + net
// share one season_point_category, so both competitions' entries are summed).
type SP = { member_card_id: string; total_points: number; player_name?: string | null }

function fakeDeps(opts: {
  rounds: SP[][]
  eventsPlayed?: Map<string, number>
  wins?: Map<string, number>
  names?: Map<string, string | null>
}) {
  const state: { replaced: any[] | null; deleted: boolean } = { replaced: null, deleted: false }
  return {
    state,
    async listCompletedRoundsWithPoints() { return opts.rounds },
    async readEventsPlayed() { return opts.eventsPlayed ?? new Map<string, number>() },
    async readWins() { return opts.wins ?? new Map<string, number>() },
    async readNames() { return opts.names ?? new Map<string, string | null>() },
    async replaceSnapshot(rows: any[]) { state.replaced = rows; return rows },
    async deleteSnapshot() { state.deleted = true; return null },
  }
}

test('rankByTotalPoints: tied totals share the lower rank, next jumps (1224)', () => {
  // totals: a=50, b=40, c=40, d=30 → ranks 1,2,2,4
  const r = rankByTotalPoints(new Map([['a', 50], ['b', 40], ['c', 40], ['d', 30]]))
  assert.equal(r.get('a'), 1)
  assert.equal(r.get('b'), 2)
  assert.equal(r.get('c'), 2, 'tied with b shares lower rank 2')
  assert.equal(r.get('d'), 4, 'next jumps to 4')
})

test('guard: only completed rounds with authoritative season_points are summed', async () => {
  // The deps supply ONLY completed rounds' season_points (a not-yet-completed
  // round is excluded upstream — the guard is in listCompletedRoundsWithPoints).
  const deps = fakeDeps({
    rounds: [[ { member_card_id: 'mc-1', total_points: 40 } ]],
    eventsPlayed: new Map([['mc-1', 1]]), wins: new Map([['mc-1', 0]]), names: new Map([['mc-1', 'Hans']]),
  })
  const rows = await rebuildSeasonPoints({ competitionKey: 'mens-league', deps: deps as any })
  assert.equal(rows[0].total_points, 40)
  assert.equal(rows[0].events_played, 1)
})

test('cumulative = sum across completed rounds AND both competitions', async () => {
  const deps = fakeDeps({
    rounds: [
      [ { member_card_id: 'mc-1', total_points: 40 }, { member_card_id: 'mc-1', total_points: 10 } ], // wk17 gross+net
      [ { member_card_id: 'mc-1', total_points: 50 } ],                                              // wk18
    ],
    eventsPlayed: new Map([['mc-1', 2]]), wins: new Map([['mc-1', 1]]), names: new Map([['mc-1', 'Hans Olson']]),
  })
  const rows = await rebuildSeasonPoints({ competitionKey: 'mens-league', deps: deps as any })
  assert.equal(rows[0].total_points, 100, '40+10+50')
  assert.equal(rows[0].position, 1)
  assert.equal(rows[0].events_played, 2)
  assert.equal(rows[0].wins, 1)
})

test('golden parity: two completed rounds reproduce the exact snapshot (byte-equivalent)', async () => {
  // Round 17: Hans 40 (gross) + 10 (net) = 50; Sue 30.
  // Round 18: Hans 20; Sue 60.
  // seasonCum (all):           Hans 70, Sue 90  → positions Sue=1, Hans=2
  // cumBeforeLast (thru wk17): Hans 50, Sue 30  → prev positions Hans=1, Sue=2
  // leaderTotal = 90.
  const deps = fakeDeps({
    rounds: [
      [ { member_card_id: 'mc-1', total_points: 40, player_name: 'Hans Olson' },
        { member_card_id: 'mc-1', total_points: 10 },
        { member_card_id: 'mc-2', total_points: 30, player_name: 'Sue Park' } ],
      [ { member_card_id: 'mc-1', total_points: 20 },
        { member_card_id: 'mc-2', total_points: 60 } ],
    ],
    eventsPlayed: new Map([['mc-1', 2], ['mc-2', 2]]),
    wins: new Map([['mc-1', 1], ['mc-2', 1]]),
    names: new Map([['mc-1', 'Hans Olson'], ['mc-2', 'Sue Park']]),
  })
  const rows = await rebuildSeasonPoints({ competitionKey: 'mens-league', deps: deps as any })
  const expected = [
    { member_card_id: 'mc-2', player_name: 'Sue Park',  total_points: 90, position: 1, previous_position: 2, events_played: 2, wins: 1, points_behind: 0 },
    { member_card_id: 'mc-1', player_name: 'Hans Olson', total_points: 70, position: 2, previous_position: 1, events_played: 2, wins: 1, points_behind: 20 },
  ]
  assert.deepEqual(rows, expected, 'byte-equivalent golden snapshot (positions, previous_position, points_behind, events_played, wins)')
  assert.equal(deps.state.deleted, false, 'snapshot replaced, not deleted')
  assert.equal(deps.state.replaced?.length, 2)
})

test('single completed round: previous_position is null for everyone (cumBeforeLast empty)', async () => {
  const deps = fakeDeps({
    rounds: [[ { member_card_id: 'mc-1', total_points: 50, player_name: 'Hans' } ]],
    eventsPlayed: new Map([['mc-1', 1]]), wins: new Map([['mc-1', 0]]), names: new Map([['mc-1', 'Hans']]),
  })
  const rows = await rebuildSeasonPoints({ competitionKey: 'mens-league', deps: deps as any })
  assert.equal(rows[0].position, 1)
  assert.equal(rows[0].previous_position, null, 'no prior completed round → no previous position')
})

test('no completed rounds with points → delete stale snapshot, return []', async () => {
  const deps = fakeDeps({ rounds: [] })
  const rows = await rebuildSeasonPoints({ competitionKey: 'mens-league', deps: deps as any })
  assert.deepEqual(rows, [])
  assert.equal(deps.state.deleted, true, 'stale snapshot deleted when no points')
})

test('delayed finalization: re-run after a round flips to completed advances the snapshot', async () => {
  let rounds: any[][] = []
  const deps = {
    async listCompletedRoundsWithPoints() { return rounds },
    async readEventsPlayed() { return new Map([['mc-1', 1]]) },
    async readWins() { return new Map([['mc-1', 0]]) },
    async readNames() { return new Map([['mc-1', 'Hans']]) },
    async replaceSnapshot(r: any[]) { return r },
    async deleteSnapshot() { return null },
  }
  const before = await rebuildSeasonPoints({ competitionKey: 'mens-league', deps: deps as any })
  assert.equal(before.length, 0, 'no points while round not completed')
  rounds = [[ { member_card_id: 'mc-1', total_points: 50 } ]]
  const after = await rebuildSeasonPoints({ competitionKey: 'mens-league', deps: deps as any })
  assert.equal(after[0].total_points, 50, 'snapshot advanced after finalization')
})
