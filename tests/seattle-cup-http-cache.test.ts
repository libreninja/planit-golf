import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  parseSeattleCupRound,
  seattleCupHttpCacheState,
  seattleCupNoStoreHeaders,
  seattleCupPublicCacheHeaders,
} from '../lib/seattle-cup/http-cache.ts'
import type {
  RoundNumber,
  SeattleCupRoundSnapshot,
  SeattleCupTournamentResolution,
} from '../lib/seattle-cup/types.ts'

function snapshot(
  round: RoundNumber,
  roundStatus: SeattleCupRoundSnapshot['roundStatus'],
  overrides: Partial<SeattleCupRoundSnapshot> = {},
): SeattleCupRoundSnapshot {
  const resultStatus: SeattleCupRoundSnapshot['resultStatus'] =
    roundStatus === 'final' ? 'final' : roundStatus === 'live' ? 'live' : 'not-started'
  return {
    round,
    format: round === 1 ? 'fourball' : round === 2 ? 'scramble' : round === 3 ? 'chapman' : 'singles',
    course: 'Test Course',
    eventName: `Round ${round}`,
    pairingsPublished: roundStatus !== 'scheduled',
    competitionMatchesAvailable: roundStatus !== 'scheduled',
    scheduledMatchesAvailable: roundStatus !== 'scheduled',
    competitionScopesAvailable: roundStatus === 'live' || roundStatus === 'final',
    pairingGroups: [],
    roundStatus,
    matches: [],
    roundStandings: [],
    overallStandings: [],
    resultStatus,
    fetchedAt: 0,
    showingLastKnown: false,
    validationIssues: [],
    ...overrides,
  }
}

function resolution(
  status: SeattleCupTournamentResolution['status'],
): SeattleCupTournamentResolution {
  return {
    status,
    winnerTeamKey: null,
    tiedTeamKeys: [],
    method: null,
    playoff: null,
  }
}

test('live authoritative state uses the shortest shared-cache policy', () => {
  const rounds = [
    snapshot(1, 'final'),
    snapshot(2, 'final'),
    snapshot(3, 'live'),
    snapshot(4, 'pairings-available'),
  ]

  assert.equal(seattleCupHttpCacheState(rounds, resolution('active')), 'live')
  assert.deepEqual(seattleCupPublicCacheHeaders(rounds, resolution('active')), {
    'Cache-Control': 'public, max-age=0, must-revalidate',
    'Vercel-CDN-Cache-Control': 'public, s-maxage=10, stale-while-revalidate=15',
  })
})

test('scheduled and pairings-available authoritative states use the upcoming policy', () => {
  for (const state of ['scheduled', 'pairings-available'] as const) {
    const rounds = [
      snapshot(1, 'final'),
      snapshot(2, 'final'),
      snapshot(3, state),
      snapshot(4, state),
    ]
    assert.equal(seattleCupHttpCacheState(rounds, resolution('active')), 'upcoming')
    assert.equal(
      seattleCupPublicCacheHeaders(rounds, resolution('active'))['Vercel-CDN-Cache-Control'],
      'public, s-maxage=30, stale-while-revalidate=30',
    )
  }
})

test('only four final rounds with a settled tournament resolution use the final policy', () => {
  const rounds = [1, 2, 3, 4].map((round) => snapshot(round as RoundNumber, 'final'))
  const settled = resolution('points-winner')

  assert.equal(seattleCupHttpCacheState(rounds, settled), 'final')
  assert.equal(
    seattleCupPublicCacheHeaders(rounds, settled)['Vercel-CDN-Cache-Control'],
    'public, s-maxage=3600, stale-while-revalidate=86400',
  )

  assert.equal(
    seattleCupHttpCacheState(rounds, resolution('playoff-required')),
    'upcoming',
    'a pending playoff can still change the tournament-wide response',
  )
})

test('cache state never uses calendar dates or fetchedAt inference', () => {
  const before = [
    snapshot(1, 'final'),
    snapshot(2, 'final'),
    snapshot(3, 'pairings-available', { fetchedAt: Date.UTC(2000, 0, 1) }),
    snapshot(4, 'scheduled', { fetchedAt: Date.UTC(2100, 0, 1) }),
  ]
  const after = before.map((round) => ({ ...round, fetchedAt: round.fetchedAt + 50_000_000_000 }))

  assert.equal(seattleCupHttpCacheState(before, resolution('active')), 'upcoming')
  assert.equal(seattleCupHttpCacheState(after, resolution('active')), 'upcoming')
})

test('round query values remain distinct and invalid values are rejected', () => {
  assert.deepEqual(
    [1, 2, 3, 4].map((round) => parseSeattleCupRound(`https://www.planit.golf/api/seattle-cup/live?round=${round}`)),
    [1, 2, 3, 4],
  )
  assert.equal(parseSeattleCupRound('https://www.planit.golf/api/seattle-cup/live?round=2&other=1'), 2)
  for (const url of [
    'https://www.planit.golf/api/seattle-cup/live',
    'https://www.planit.golf/api/seattle-cup/live?round=0',
    'https://www.planit.golf/api/seattle-cup/live?round=5',
    'https://www.planit.golf/api/seattle-cup/live?round=2.5',
    'https://www.planit.golf/api/seattle-cup/live?round=nope',
  ]) {
    assert.equal(parseSeattleCupRound(url), null)
  }
})

test('stale fallback, error, and authorization-failure responses are not public-cacheable', () => {
  const rounds = [
    snapshot(1, 'final'),
    snapshot(2, 'final'),
    snapshot(3, 'live', { showingLastKnown: true }),
    snapshot(4, 'scheduled'),
  ]

  assert.deepEqual(seattleCupPublicCacheHeaders(rounds, resolution('active')), {
    'Cache-Control': 'no-store',
  })
  assert.deepEqual(
    seattleCupNoStoreHeaders(),
    { 'Cache-Control': 'no-store' },
    'the route uses this policy for invalid, denied/private, and 502 responses',
  )
})
