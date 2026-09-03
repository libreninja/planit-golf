import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyProjectedFlights,
  officialFlightMembership,
  projectFlightAssignments,
} from '../lib/competition/projected-flights.ts'
import type { Leaderboard, ResultEntry } from '../lib/competition/types.ts'

function entry(key: string, positionOrder: number, flight: string | null = null): ResultEntry {
  return {
    key, name: key, positionLabel: String(positionOrder), positionOrder,
    points: null, purse: null, flight,
  }
}

function leaderboard(entries: ResultEntry[]): Leaderboard {
  return {
    occurrenceId: '21', scoringMode: 'net', grouping: null, entries,
    scorecards: [], resultStatus: 'live', durableCurrent: false,
  }
}

test('approximate thirds distribute the remainder to lower-numbered flights', () => {
  for (const [count, expected] of [[9, [3, 3, 3]], [10, [4, 3, 3]], [11, [4, 4, 3]]] as const) {
    const assignments = projectFlightAssignments(
      Array.from({ length: count }, (_, index) => ({ key: `p${String(index).padStart(2, '0')}`, handicapIndex: index })),
    )
    const sizes = ['Flight 1', 'Flight 2', 'Flight 3'].map(
      (flight) => [...assignments.values()].filter((value) => value === flight).length,
    )
    assert.deepEqual(sizes, expected)
  }
})

test('ordering is handicap ascending with stable key tie-breaker; missing indexes are unassigned', () => {
  const assignments = projectFlightAssignments([
    { key: 'z', handicapIndex: 1 },
    { key: 'a', handicapIndex: 1 },
    { key: 'm', handicapIndex: 2 },
    { key: 'missing', handicapIndex: null },
  ])
  assert.equal(assignments.get('a'), 'Flight 1')
  assert.equal(assignments.get('z'), 'Flight 2')
  assert.equal(assignments.get('m'), 'Flight 3')
  assert.equal(assignments.has('missing'), false)
})

test('projected membership scopes existing rows without fabricating tee-sheet-only rows', () => {
  const source = leaderboard([entry('p1', 1), entry('missing', 2)])
  source.entries[0].points = 42
  source.entries[0].purse = '$10.00'
  const projected = applyProjectedFlights(source, new Map([
    ['p1', 'Flight 1'],
    ['tee-sheet-only', 'Flight 2'],
  ]))
  assert.equal(projected.state.status, 'projected')
  assert.deepEqual(projected.state.groupings.map((grouping) => grouping.label), [
    'Projected Flight 1', 'Projected Flight 2', 'Projected Flight 3',
  ])
  assert.deepEqual(projected.leaderboard!.entries.map((row) => [row.key, row.flight]), [
    ['p1', 'Flight 1'], ['missing', null],
  ])
  assert.equal(projected.leaderboard!.entries[0].points, 42, 'projection never awards or changes points')
  assert.equal(projected.leaderboard!.entries[0].purse, '$10.00', 'projection never changes result facts')
})

test('one named official flight replaces projection independently from scoring status', () => {
  const result = officialFlightMembership(leaderboard([
    entry('p1', 1, 'flight 2'),
    entry('unassigned', 2, 'Overall'),
  ]))
  assert.equal(result.state.status, 'official')
  assert.deepEqual(result.state.groupings.map((grouping) => grouping.label), ['Flight 1', 'Flight 2', 'Flight 3'])
  assert.equal(result.leaderboard!.resultStatus, 'live')
  assert.deepEqual(result.leaderboard!.entries.map((row) => row.flight), ['Flight 2', null])
})

test('official flight canonicalization accepts historical casing but rejects Overall', () => {
  const result = officialFlightMembership(leaderboard([
    entry('upper', 1, 'FLIGHT 1'),
    entry('overall', 2, 'Overall'),
  ]))
  assert.equal(result.state.status, 'official')
  assert.deepEqual(result.leaderboard!.entries.map((row) => row.flight), ['Flight 1', null])
})
