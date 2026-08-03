import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filterLeaderboardByGrouping } from '../components/competition/leaderboard-filter.ts'
import type { Leaderboard, ResultEntry } from '../lib/competition/types.ts'

function lb(entries: { key: string; flight: string | null }[]): Leaderboard {
  const e: ResultEntry[] = entries.map((x) => ({
    key: x.key, name: x.key, positionLabel: null, positionOrder: 0,
    points: null, purse: null, flight: x.flight,
  }))
  return {
    occurrenceId: '1', scoringMode: 'net', grouping: null,
    entries: e, scorecards: [], resultStatus: 'final', durableCurrent: true,
  }
}

test("'all' grouping → all entries (no filtering)", () => {
  const l = lb([{ key: 'a', flight: 'Flight A' }, { key: 'b', flight: 'Flight B' }])
  assert.equal(filterLeaderboardByGrouping(l, 'all')!.entries.length, 2)
})

test('null grouping → all entries (no filtering)', () => {
  const l = lb([{ key: 'a', flight: 'Flight A' }, { key: 'b', flight: 'Flight B' }])
  assert.equal(filterLeaderboardByGrouping(l, null)!.entries.length, 2)
})

test('specific flight → only that flight entries', () => {
  const l = lb([
    { key: 'a', flight: 'Flight A' },
    { key: 'b', flight: 'Flight B' },
    { key: 'c', flight: 'Flight A' },
  ])
  const f = filterLeaderboardByGrouping(l, 'Flight A')!
  assert.equal(f.entries.length, 2)
  assert.ok(f.entries.every((e) => e.flight === 'Flight A'))
})

test('flight with no matching entries → empty entries (not null)', () => {
  const l = lb([{ key: 'a', flight: 'Flight A' }])
  const f = filterLeaderboardByGrouping(l, 'Flight Z')!
  assert.equal(f.entries.length, 0)
})

test('unflighted (null flight) entries excluded when a specific flight is selected', () => {
  const l = lb([{ key: 'a', flight: 'Flight A' }, { key: 'b', flight: null }])
  assert.equal(filterLeaderboardByGrouping(l, 'Flight A')!.entries.length, 1)
  // 'all' keeps unflighted entries
  assert.equal(filterLeaderboardByGrouping(l, 'all')!.entries.length, 2)
})

test('null leaderboard → null', () => {
  assert.equal(filterLeaderboardByGrouping(null, 'Flight A'), null)
  assert.equal(filterLeaderboardByGrouping(null, 'all'), null)
})

test('filtering does not mutate the original leaderboard entries', () => {
  const l = lb([{ key: 'a', flight: 'Flight A' }, { key: 'b', flight: 'Flight B' }])
  const f = filterLeaderboardByGrouping(l, 'Flight A')!
  assert.equal(f.entries.length, 1)
  assert.equal(l.entries.length, 2, 'original entries unchanged')
})
