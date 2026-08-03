import { test } from 'node:test'
import assert from 'node:assert/strict'
import { occurrenceNavNeighbors } from '../components/competition/occurrence-nav-neighbors.ts'

// Occurrences are CHRONOLOGICAL (oldest→newest), per the contract the user
// specified for P3. Left (prev) = older, right (next) = newer.
const occ = (id: string) => ({ id, label: id })
const weeks = [occ('w1'), occ('w2'), occ('w3')]

test('left (prev) selects the immediately older occurrence', () => {
  assert.equal(occurrenceNavNeighbors(weeks, 'w2').prev?.id, 'w1')
})

test('right (next) selects the immediately newer occurrence', () => {
  assert.equal(occurrenceNavNeighbors(weeks, 'w2').next?.id, 'w3')
})

test('left is disabled (prev null) at the oldest dataset', () => {
  const { prev, next } = occurrenceNavNeighbors(weeks, 'w1')
  assert.equal(prev, null)
  assert.equal(next?.id, 'w2')
})

test('right is disabled (next null) at the newest dataset', () => {
  const { prev, next } = occurrenceNavNeighbors(weeks, 'w3')
  assert.equal(next, null)
  assert.equal(prev?.id, 'w2')
})

test('middle occurrence has both neighbors', () => {
  const { prev, next, index } = occurrenceNavNeighbors(weeks, 'w2')
  assert.equal(prev?.id, 'w1')
  assert.equal(next?.id, 'w3')
  assert.equal(index, 1)
})

test('empty occurrences or null selection → no neighbors', () => {
  assert.deepEqual(occurrenceNavNeighbors([], 'w1'), { prev: null, next: null, index: -1 })
  assert.deepEqual(occurrenceNavNeighbors(weeks, null), { prev: null, next: null, index: -1 })
})

test('unknown selected id → no neighbors', () => {
  assert.deepEqual(occurrenceNavNeighbors(weeks, 'zzz'), { prev: null, next: null, index: -1 })
})

test('single occurrence: both chevrons disabled', () => {
  const { prev, next } = occurrenceNavNeighbors([occ('only')], 'only')
  assert.equal(prev, null)
  assert.equal(next, null)
})
