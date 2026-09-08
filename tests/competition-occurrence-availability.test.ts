import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  availableLeaderboardOccurrences,
  availableWeeklyOccurrences,
  latestResultsOccurrenceId,
} from '../components/competition/occurrence-availability.ts'
import { occurrenceNavNeighbors } from '../components/competition/occurrence-nav-neighbors.ts'
import type { Occurrence } from '../lib/competition/types.ts'

function occurrence(id: string, date: string): Occurrence {
  return {
    id,
    number: Number(id),
    label: `Week ${id}`,
    date,
    activeWindow: { start: `${date}T16:00:00-07:00`, end: `${date}T22:00:00-07:00` },
    format: 'individual',
    discoveryState: 'pending',
    resultStatus: 'unknown',
  }
}

const occurrences = [
  occurrence('20', '2026-08-25'),
  occurrence('21', '2026-09-01'),
  occurrence('22', '2026-09-08'),
  occurrence('23', '2026-09-15'),
]

test('regular future and unscored rounds remain available to the Weekly lifecycle', () => {
  const visible = availableWeeklyOccurrences(occurrences, {
    hasResults: new Set(['20', '21']),
    liveScoredOccurrenceIds: new Set(),
  })
  assert.deepEqual(visible.map((item) => item.id), ['20', '21', '22', '23'])
})

test('non-Men’s leaderboard navigation retains its scored/live-only contract', () => {
  const visible = availableLeaderboardOccurrences(occurrences, {
    hasResults: new Set(['20', '21']),
    liveScoredOccurrenceIds: new Set(),
  })
  assert.deepEqual(visible.map((item) => item.id), ['20', '21'])
})

test('current live occurrence remains in Weekly navigation', () => {
  const visible = availableWeeklyOccurrences(occurrences, {
    hasResults: new Set(['20']),
    liveScoredOccurrenceIds: new Set(['21']),
  })
  assert.deepEqual(visible.map((item) => item.id), ['20', '21', '22', '23'])
})

test('previous/next traverses scheduled Weekly occurrences', () => {
  const visible = availableWeeklyOccurrences(occurrences, {
    hasResults: new Set(['20', '22']),
    liveScoredOccurrenceIds: new Set(),
  })
  assert.equal(occurrenceNavNeighbors(visible, '20').next?.id, '21')
  assert.equal(occurrenceNavNeighbors(visible, '22').prev?.id, '21')
})

test('unscored special occurrences stay out of Weekly while scored specials remain compatible', () => {
  const special = { ...occurrence('101', '2026-08-17'), number: 101 }
  assert.deepEqual(availableWeeklyOccurrences([...occurrences, special], {
    hasResults: new Set(), liveScoredOccurrenceIds: new Set(),
  }).map((item) => item.id), ['20', '21', '22', '23'])
  assert.equal(availableWeeklyOccurrences([...occurrences, special], {
    hasResults: new Set(['101']), liveScoredOccurrenceIds: new Set(),
  }).at(-1)?.id, '101')
})

test('Latest Results targets a current scored round when available', () => {
  assert.equal(latestResultsOccurrenceId(occurrences, new Set(['20']), new Set(['21'])), '21')
})

test('Latest Results otherwise targets the most recently scored round', () => {
  assert.equal(latestResultsOccurrenceId(occurrences, new Set(['20', '21']), new Set()), '21')
})

test('Latest Results never targets a future unscored round', () => {
  assert.equal(latestResultsOccurrenceId(occurrences, new Set(['20', '21']), new Set()), '21')
})
