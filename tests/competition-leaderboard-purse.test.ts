import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hasPurseAward, shouldShowPurse } from '../components/competition/leaderboard-purse.ts'
import type { ResultEntry } from '../lib/competition/types.ts'

function entry(purse: string | null): ResultEntry {
  return {
    key: 'k', name: 'n', positionLabel: null, positionOrder: 0,
    points: null, purse, flight: null,
  }
}

test('all-null purses → column hidden (no-money round, e.g. Club Championship Monday)', () => {
  assert.equal(shouldShowPurse([entry(null), entry(null), entry(null)]), false)
})

test('empty-string purses are treated as no purse (column hidden)', () => {
  assert.equal(shouldShowPurse([entry(''), entry(''), entry('')]), false)
})

test('mixed null + empty → still hidden (no real purse anywhere)', () => {
  assert.equal(shouldShowPurse([entry(null), entry(''), entry(null)]), false)
})

test('any entry with a purse → column shown (money round, e.g. Club Championship Tuesday)', () => {
  assert.equal(shouldShowPurse([entry(null), entry('$25.00'), entry(null)]), true)
})

test('all entries with purses → shown (finalized money round)', () => {
  assert.equal(shouldShowPurse([entry('$55.00'), entry('$40.00'), entry('$15.00')]), true)
})

test('empty leaderboard → hidden (no column to render)', () => {
  assert.equal(shouldShowPurse([]), false)
})

test('zero purse values are not awards and render no purse treatment', () => {
  assert.equal(hasPurseAward('$0'), false)
  assert.equal(hasPurseAward('$0.00'), false)
  assert.equal(hasPurseAward('0'), false)
  assert.equal(shouldShowPurse([entry('$0.00'), entry(null)]), false)
})

test('actual purse winners retain their authoritative treatment', () => {
  assert.equal(hasPurseAward('$25.00'), true)
  assert.equal(hasPurseAward('$1,250.50'), true)
})

// Club Championship invariant: Monday (points, no purse) and Tuesday (points +
// money) are TWO independent occurrences. The purse gate is occurrence-level
// and data-driven — Monday's field hides the column, Tuesday's shows it — never
// a hardcoded "club championship" check.
test('Club Championship: Monday hides purse, Tuesday shows it (per-occurrence, data-driven)', () => {
  const monday = [entry(null), entry(null), entry(null)] // points only, no money
  const tuesday = [entry(null), entry('$25.00'), entry(null)] // points + money
  assert.equal(shouldShowPurse(monday), false, 'Monday (no purse) → column hidden')
  assert.equal(shouldShowPurse(tuesday), true, 'Tuesday (money) → column shown')
})
