import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  leaderboardControlReducer,
  hasActiveLeaderboardFilters,
  resolveGroupingSelection,
  type LeaderboardControlState,
} from '../components/competition/leaderboard-control-state.ts'
import type { FlightMembershipState } from '../lib/competition/types.ts'

const base: LeaderboardControlState = { view: 'weekly', scoring: 'gross', grouping: 'Flight 2', placedOnly: false }
const projected: FlightMembershipState = {
  status: 'projected',
  groupings: [1, 2, 3].map((n) => ({ key: `Flight ${n}`, label: `Projected Flight ${n}` })),
}
const official: FlightMembershipState = {
  status: 'official',
  groupings: [1, 2, 3].map((n) => ({ key: `Flight ${n}`, label: `Flight ${n}` })),
}

test('Gross → Net preserves selected Flight N', () => {
  assert.deepEqual(
    leaderboardControlReducer(base, { type: 'select-scoring', scoring: 'net' }),
    { view: 'weekly', scoring: 'net', grouping: 'Flight 2', placedOnly: false },
  )
})

test('Net → Gross preserves selected Flight N', () => {
  const state = { ...base, scoring: 'net' }
  assert.equal(leaderboardControlReducer(state, { type: 'select-scoring', scoring: 'gross' }).grouping, 'Flight 2')
})

test('Season Points ↔ Weekly preserves scoring and grouping dimensions', () => {
  const season = leaderboardControlReducer(base, { type: 'select-view', view: 'season' })
  assert.deepEqual(season, { view: 'season', scoring: 'gross', grouping: 'Flight 2', placedOnly: false })
  assert.equal(leaderboardControlReducer(season, { type: 'select-view', view: 'weekly' }).grouping, 'Flight 2')
})

test('Hide unranked composes with scoring and grouping', () => {
  const placed = leaderboardControlReducer(base, { type: 'select-placed-only', placedOnly: true })
  assert.deepEqual(placed, { ...base, placedOnly: true })
  assert.equal(leaderboardControlReducer(placed, { type: 'select-scoring', scoring: 'net' }).grouping, 'Flight 2')
})

test('Clear restores filter defaults without changing the view dimension', () => {
  const selectedOccurrenceId = '20'
  const filtered = { ...base, scoring: 'net' as const, placedOnly: true }
  const cleared = leaderboardControlReducer(filtered, { type: 'clear-filters', defaultScoring: 'gross' })
  assert.deepEqual(cleared, { view: 'weekly', scoring: 'gross', grouping: 'all', placedOnly: false })
  assert.equal(hasActiveLeaderboardFilters(cleared, 'gross'), false)
  assert.equal(hasActiveLeaderboardFilters(filtered, 'gross'), true)
  assert.equal(selectedOccurrenceId, '20', 'occurrence is not part of filter state')
})

test('Projected Flight N → official Flight N preserves canonical selection', () => {
  assert.equal(resolveGroupingSelection('Flight 2', projected), 'Flight 2')
  assert.equal(resolveGroupingSelection('Flight 2', official), 'Flight 2')
})

test('week changes preserve a valid grouping and fall back safely when absent', () => {
  assert.equal(resolveGroupingSelection('Flight 3', official), 'Flight 3')
  assert.equal(resolveGroupingSelection('Flight 4', official), 'all')
  assert.equal(resolveGroupingSelection('Flight 2', { status: 'unavailable', groupings: [] }), 'all')
})
