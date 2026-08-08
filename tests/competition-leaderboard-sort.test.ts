import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sortAllViewEntries, compareFlightAscending, compareFlightDescending } from '../components/competition/leaderboard-sort.ts'
import type { ResultEntry } from '../lib/competition/types.ts'

function entry(name: string, positionOrder: number, flight: string | null, positionLabel: string | null = null): ResultEntry {
  return { key: name, name, positionLabel, positionOrder, points: null, purse: null, flight }
}

test('compareFlightAscending: numeric labels sort low-to-high ("Flight 1" before "Flight 3")', () => {
  assert.equal(compareFlightAscending('Flight 1', 'Flight 3') < 0, true, 'Flight 1 first')
  assert.equal(compareFlightAscending('Flight 3', 'Flight 1') > 0, true)
  assert.equal(compareFlightAscending('Flight 2', 'Flight 2'), 0)
})

test('compareFlightDescending: numeric labels sort high-to-low ("Flight 3" before "Flight 1")', () => {
  assert.equal(compareFlightDescending('Flight 3', 'Flight 1') < 0, true, 'Flight 3 first')
  assert.equal(compareFlightDescending('Flight 1', 'Flight 3') > 0, true)
  assert.equal(compareFlightDescending('Flight 2', 'Flight 2'), 0)
})

test('compareFlightDescending: "Flight 10" sorts above "Flight 2" (numeric, not lexicographic)', () => {
  assert.equal(compareFlightDescending('Flight 10', 'Flight 2') < 0, true, 'Flight 10 first')
  assert.equal(compareFlightDescending('Flight 2', 'Flight 10') > 0, true)
})

test('compareFlightDescending: null/empty flight always sorts last', () => {
  assert.equal(compareFlightDescending(null, 'Flight 1') > 0, true, 'Flight 1 first, null last')
  assert.equal(compareFlightDescending('Flight 1', null) < 0, true)
  assert.equal(compareFlightDescending(null, null), 0)
  assert.equal(compareFlightDescending('', 'Flight 1') > 0, true)
})

test('All view: position ascending then flight ASCENDING — 1/F1, 1/F2, 1/F3, 2/F1, 2/F2, 3/F1', () => {
  const rows = [
    entry('p2f2', 2, 'Flight 2'),
    entry('p1f3', 1, 'Flight 3'),
    entry('p1f1', 1, 'Flight 1'),
    entry('p2f1', 2, 'Flight 1'),
    entry('p1f2', 1, 'Flight 2'),
    entry('p3f1', 3, 'Flight 1'),
  ]
  const sorted = sortAllViewEntries(rows)
  assert.deepEqual(sorted.map((r) => r.name), [
    'p1f1', 'p1f2', 'p1f3',  // position 1: flights 1,2,3 (ascending)
    'p2f1', 'p2f2',          // position 2: flights 1,2
    'p3f1',                  // position 3
  ])
})

// Product requirement, explicit so it cannot silently flip back to DESC:
// when positions are otherwise equal, Flight 1 MUST appear before Flight 2,
// and Flight 2 before Flight 3. This is the single assertion that guards the
// ASC rule; if it ever fails, the sort flipped.
test('All view: equal positions order Flight 1 -> Flight 2 -> Flight 3 (ASC, the requirement)', () => {
  const rows = [
    entry('F3', 1, 'Flight 3'),
    entry('F1', 1, 'Flight 1'),
    entry('F2', 1, 'Flight 2'),
  ]
  const sorted = sortAllViewEntries(rows)
  assert.deepEqual(sorted.map((r) => r.flight), ['Flight 1', 'Flight 2', 'Flight 3'],
    'Position 1 / Flight 1, then 1 / Flight 2, then 1 / Flight 3 — exactly in that order')
})

test('All view: duplicate position values use flight-ASCENDING tie-break', () => {
  // Three players tied at position 1 across flights 1 and 2 → flight 1 first.
  const rows = [
    entry('LowFlight', 1, 'Flight 1'),
    entry('HighFlight', 1, 'Flight 2'),
    entry('MidFlight', 1, 'Flight 1'),
  ]
  const sorted = sortAllViewEntries(rows)
  // flight 1 rows first (stable among themselves), then flight 2.
  assert.equal(sorted[0].flight, 'Flight 1', 'flight 1 first among the tied position 1')
  assert.equal(sorted[1].flight, 'Flight 1')
  assert.equal(sorted[2].name, 'HighFlight', 'flight 2 last')
  assert.equal(sorted[2].flight, 'Flight 2')
})

test('All view: unflighted (null) rows sort to the bottom within their position', () => {
  const rows = [
    entry('NoFlight', 1, null),
    entry('F2', 1, 'Flight 2'),
    entry('F1', 1, 'Flight 1'),
  ]
  const sorted = sortAllViewEntries(rows)
  assert.deepEqual(sorted.map((r) => r.name), ['F1', 'F2', 'NoFlight'],
    'flight 1, then flight 2, then null flight last — all at position 1 (ascending)')
})

test('All view: does not mutate the input array', () => {
  const rows = [entry('B', 2, 'Flight 1'), entry('A', 1, 'Flight 1')]
  const snapshot = rows.map((r) => r.name)
  sortAllViewEntries(rows)
  assert.deepEqual(rows.map((r) => r.name), snapshot, 'input order preserved')
})

test('unplaced (BOTTOM positionOrder) rows sink below placed rows regardless of flight', () => {
  const BOTTOM = Number.MAX_SAFE_INTEGER
  const rows = [
    entry('unplaced', BOTTOM, 'Flight 1'),
    entry('winner', 1, 'Flight 2'),
  ]
  const sorted = sortAllViewEntries(rows)
  assert.deepEqual(sorted.map((r) => r.name), ['winner', 'unplaced'])
})
