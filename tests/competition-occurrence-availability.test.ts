import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  availableLeaderboardOccurrences,
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

test('future and unscored rounds are absent from leaderboard navigation', () => {
  const visible = availableLeaderboardOccurrences(occurrences, {
    hasResults: new Set(['20', '21']),
    liveScoredOccurrenceIds: new Set(),
  })
  assert.deepEqual(visible.map((item) => item.id), ['20', '21'])
})

test('current live occurrence enters navigation only once scoring exists', () => {
  const visible = availableLeaderboardOccurrences(occurrences, {
    hasResults: new Set(['20']),
    liveScoredOccurrenceIds: new Set(['21']),
  })
  assert.deepEqual(visible.map((item) => item.id), ['20', '21'])
})

test('previous/next traverses scored/live occurrences and skips unscored schedule entries', () => {
  const visible = availableLeaderboardOccurrences(occurrences, {
    hasResults: new Set(['20', '22']),
    liveScoredOccurrenceIds: new Set(),
  })
  assert.equal(occurrenceNavNeighbors(visible, '20').next?.id, '22')
  assert.equal(occurrenceNavNeighbors(visible, '22').prev?.id, '20')
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
