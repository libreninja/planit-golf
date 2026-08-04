import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sortAllViewEntries, compareFlightAscending } from '../components/competition/leaderboard-sort.ts'
import type { ResultEntry } from '../lib/competition/types.ts'

function entry(name: string, positionOrder: number, flight: string | null, positionLabel: string | null = null): ResultEntry {
  return { key: name, name, positionLabel, positionOrder, points: null, purse: null, flight }
}

test('compareFlightAscending: numeric labels sort low-to-high ("Flight 1" before "Flight 3")', () => {
  assert.equal(compareFlightAscending('Flight 1', 'Flight 3') < 0, true, 'Flight 1 first')
  assert.equal(compareFlightAscending('Flight 3', 'Flight 1') > 0, true)
  assert.equal(compareFlightAscending('Flight 2', 'Flight 2'), 0)
})

test('compareFlightAscending: "Flight 2" sorts above "Flight 10" (numeric, not lexicographic)', () => {
  assert.equal(compareFlightAscending('Flight 2', 'Flight 10') < 0, true, 'Flight 2 first')
  assert.equal(compareFlightAscending('Flight 10', 'Flight 2') > 0, true)
})

test('compareFlightAscending: non-numeric labels fall back to string-ascending (A before B before C)', () => {
  assert.equal(compareFlightAscending('A', 'C') < 0, true, 'A first')
  assert.equal(compareFlightAscending('C', 'A') > 0, true)
  assert.equal(compareFlightAscending('B', 'B'), 0)
})

test('compareFlightAscending: null/empty flight always sorts last', () => {
  assert.equal(compareFlightAscending(null, 'Flight 1') > 0, true, 'Flight 1 first, null last')
  assert.equal(compareFlightAscending('Flight 1', null) < 0, true)
  assert.equal(compareFlightAscending(null, null), 0)
  assert.equal(compareFlightAscending('', 'Flight 1') > 0, true)
})

test('All view: pos:flight ordering — 1:1, 1:2, 1:3, 2:1, 2:2 across multiple flights', () => {
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

test('All view: duplicate position values use flight-ascending tie-break', () => {
  // Three players tied at position 1 across flights 1 and 2 → flight 1 first.
  const rows = [
    entry('HighFlight', 1, 'Flight 2'),
    entry('LowFlight', 1, 'Flight 1'),
    entry('MidFlight', 1, 'Flight 1'),
  ]
  const sorted = sortAllViewEntries(rows)
  // flight 1 rows first (stable among themselves), then flight 2.
  assert.equal(sorted[0].flight, 'Flight 1')
  assert.equal(sorted[1].flight, 'Flight 1')
  assert.equal(sorted[2].name, 'HighFlight', 'flight 2 last among the tied position 1')
})

test('All view: unflighted (null) rows sort to the bottom within their position', () => {
  const rows = [
    entry('NoFlight', 1, null),
    entry('F2', 1, 'Flight 2'),
    entry('F1', 1, 'Flight 1'),
  ]
  const sorted = sortAllViewEntries(rows)
  assert.deepEqual(sorted.map((r) => r.name), ['F1', 'F2', 'NoFlight'],
    'flight 1, then flight 2, then null flight last — all at position 1')
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
