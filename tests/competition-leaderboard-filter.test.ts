import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filterLeaderboardByGrouping, filterLeaderboardByPlacement } from '../components/competition/leaderboard-filter.ts'
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

test('projected flight filter scopes membership without fabricating placements', () => {
  const l = lb([
    { key: 'first', flight: 'Flight 2' },
    { key: 'outside', flight: 'Flight 1' },
    { key: 'tie-a', flight: 'Flight 2' },
    { key: 'tie-b', flight: 'Flight 2' },
  ])
  l.entries[0].positionOrder = 1
  l.entries[0].positionLabel = '1'
  l.entries[1].positionOrder = 2
  l.entries[1].positionLabel = '2'
  l.entries[2].positionOrder = 3
  l.entries[2].positionLabel = 'T3'
  l.entries[3].positionOrder = 3
  l.entries[3].positionLabel = 'T3'
  const projected = filterLeaderboardByGrouping(l, 'Flight 2', 'projected')!
  assert.deepEqual(projected.entries.map((entry) => entry.positionLabel), ['1', 'T3', 'T3'])
})

test('Hide unranked hides non-awarded scored entries in Gross without fabricating positions', () => {
  const l = lb([{ key: 'placed', flight: 'Flight 1' }, { key: 'phantom', flight: 'Flight 1' }])
  l.scoringMode = 'gross'
  l.entries[0].positionLabel = '2'
  const filtered = filterLeaderboardByPlacement(l, true)!
  assert.deepEqual(filtered.entries.map((entry) => entry.key), ['placed'])
  assert.equal(l.entries[1].positionLabel, null)
})

test('Hide unranked hides non-awarded scored entries in Net', () => {
  const l = lb([{ key: 'placed', flight: 'Flight 2' }, { key: 'phantom', flight: 'Flight 2' }])
  l.entries[0].positionLabel = 'T3'
  assert.deepEqual(filterLeaderboardByPlacement(l, true)!.entries.map((entry) => entry.key), ['placed'])
})

test('Hide unranked composes with official and projected Flight N scopes', () => {
  const l = lb([
    { key: 'flight-placed', flight: 'Flight 2' },
    { key: 'flight-unplaced', flight: 'Flight 2' },
    { key: 'other-placed', flight: 'Flight 1' },
  ])
  l.entries[0].positionLabel = '1'
  l.entries[2].positionLabel = '2'
  for (const status of ['official', 'projected'] as const) {
    const grouped = filterLeaderboardByGrouping(l, 'Flight 2', status)
    assert.deepEqual(filterLeaderboardByPlacement(grouped, true)!.entries.map((entry) => entry.key), ['flight-placed'])
  }
})

test('full-score view retains every entry when Hide unranked is off', () => {
  const l = lb([{ key: 'placed', flight: null }, { key: 'phantom', flight: null }])
  l.entries[0].positionLabel = '1'
  assert.equal(filterLeaderboardByPlacement(l, false)!.entries.length, 2)
})
