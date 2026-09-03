import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hasValidSelectedScore, sortEntriesBySelectedScore } from '../components/competition/leaderboard-sort.ts'
import type { ResultEntry, Scorecard } from '../lib/competition/types.ts'

function entry(
  key: string,
  options: Partial<Pick<ResultEntry, 'positionLabel' | 'positionOrder' | 'points' | 'purse' | 'flight'>> = {},
): ResultEntry {
  return {
    key,
    name: key,
    positionLabel: options.positionLabel ?? null,
    positionOrder: options.positionOrder ?? Number.MAX_SAFE_INTEGER,
    points: options.points ?? null,
    purse: options.purse ?? null,
    flight: options.flight ?? null,
  }
}

function card(key: string, gross: number | null, net: number | null, holesCompleted = 9): Scorecard {
  return {
    key,
    memberCardId: key,
    name: key,
    grossTotal: gross === null ? null : gross + 36,
    netTotal: net === null ? null : net + 36,
    toParGross: gross,
    toParNet: net,
    holesCompleted,
    scorecardStatus: null,
    isLive: holesCompleted > 0 && holesCompleted < 9,
    holes: [],
  }
}

test('Gross orders every valid scored player by gross score, independent of award placement', () => {
  const rows = [
    entry('awarded-third', { positionLabel: '3', positionOrder: 3, points: 20 }),
    entry('unawarded', { positionOrder: Number.MAX_SAFE_INTEGER }),
    entry('winner', { positionLabel: '1', positionOrder: 1, points: 50, purse: '$25.00' }),
  ]
  const sorted = sortEntriesBySelectedScore(rows, [
    card('awarded-third', 2, -2),
    card('unawarded', 1, 4),
    card('winner', -1, 0),
  ], 'gross')

  assert.deepEqual(sorted.map((row) => row.key), ['winner', 'unawarded', 'awarded-third'])
  assert.equal(sorted[1].positionLabel, null, 'score ordering must not fabricate a position')
  assert.equal(sorted[1].points, null)
  assert.equal(sorted[1].purse, null)
})

test('Net uses net score and can produce a different competitive order', () => {
  const rows = [entry('A'), entry('B'), entry('C')]
  const cards = [card('A', -3, 4), card('B', 2, -2), card('C', 0, 1)]
  assert.deepEqual(
    sortEntriesBySelectedScore(rows, cards, 'net').map((row) => row.key),
    ['B', 'C', 'A'],
  )
  assert.deepEqual(
    sortEntriesBySelectedScore(rows, cards, 'gross').map((row) => row.key),
    ['A', 'C', 'B'],
  )
})

test('Overall score ordering crosses flights instead of grouping by per-flight award position', () => {
  const rows = [
    entry('flight-1-winner', { flight: 'Flight 1', positionLabel: '1', positionOrder: 1 }),
    entry('flight-2-third', { flight: 'Flight 2', positionLabel: '3', positionOrder: 3 }),
    entry('flight-3-winner', { flight: 'Flight 3', positionLabel: '1', positionOrder: 1 }),
  ]
  const sorted = sortEntriesBySelectedScore(rows, [
    card('flight-1-winner', 1, 1),
    card('flight-2-third', -2, -2),
    card('flight-3-winner', 0, 0),
  ], 'gross')
  assert.deepEqual(sorted.map((row) => row.key), ['flight-2-third', 'flight-3-winner', 'flight-1-winner'])
})

test('flight-filtered rows use the same selected-score ordering', () => {
  const rows = [
    entry('Zed', { flight: 'Flight 2', positionLabel: '1', positionOrder: 1 }),
    entry('Amy', { flight: 'Flight 2' }),
  ]
  const sorted = sortEntriesBySelectedScore(rows, [card('Zed', 2, 2), card('Amy', 0, 0)], 'gross')
  assert.deepEqual(sorted.map((row) => row.key), ['Amy', 'Zed'])
  assert.equal(sorted[0].positionLabel, null)
})

test('live partial scores remain in score-relative order', () => {
  const rows = [entry('through-seven'), entry('through-three'), entry('unstarted')]
  const sorted = sortEntriesBySelectedScore(rows, [
    card('through-seven', 1, 1, 7),
    card('through-three', -1, -1, 3),
    card('unstarted', null, null, 0),
  ], 'gross')
  assert.deepEqual(sorted.map((row) => row.key), ['through-three', 'through-seven', 'unstarted'])
})

test('alphabetical fallback applies only to rows with no selected score', () => {
  const rows = [entry('No-score Z'), entry('Scored Z'), entry('No-score A'), entry('Scored A')]
  const sorted = sortEntriesBySelectedScore(rows, [
    card('Scored Z', 3, 0),
    card('Scored A', 1, 0),
  ], 'gross')
  assert.deepEqual(sorted.map((row) => row.key), ['Scored A', 'Scored Z', 'No-score A', 'No-score Z'])
})

test('sorting does not mutate row order or authoritative award metadata', () => {
  const rows = [entry('B', { positionLabel: '1', points: 50 }), entry('A')]
  const snapshot = structuredClone(rows)
  sortEntriesBySelectedScore(rows, [card('B', 2, 0), card('A', 1, 0)], 'gross')
  assert.deepEqual(rows, snapshot)
})

test('valid-score detection accepts to-par or total and rejects an empty card', () => {
  const totalOnly = card('total-only', null, null)
  totalOnly.grossTotal = 41
  assert.equal(hasValidSelectedScore(totalOnly, 'gross'), true)
  assert.equal(hasValidSelectedScore(card('empty', null, null), 'gross'), false)
})
