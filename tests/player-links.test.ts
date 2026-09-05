import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  playerDetailHrefForMemberCard,
  playerPerformanceHref,
  safeInternalReturnTo,
  scoringFromPlayerSource,
} from '../lib/players/links.ts'

test('leaderboard member card resolves to the correct canonical golfer and preserves source week', () => {
  const href = playerDetailHrefForMemberCard({
    memberCardId: 'card-steven',
    golferIdsByMemberCard: { 'card-steven': 'golfer-steven', 'card-other': 'golfer-other' },
    week: '19',
    scoring: 'gross',
    returnTo: '/igc/mens-league?view=weekly&week=19&scoring=gross&grouping=2',
  })
  assert.equal(href, '/players/golfer-steven?week=19&scoring=gross&from=%2Figc%2Fmens-league%3Fview%3Dweekly%26week%3D19%26scoring%3Dgross%26grouping%3D2')
})

test('result scoring uses explicit context and falls back to the preserved leaderboard return URL', () => {
  assert.equal(scoringFromPlayerSource('net', '/igc/mens-league?scoring=gross'), 'net')
  assert.equal(scoringFromPlayerSource(undefined, '/igc/mens-league?view=weekly&scoring=gross'), 'gross')
  assert.equal(scoringFromPlayerSource(undefined, 'https://example.com?scoring=net'), null)
})

test('unresolved member card has no player navigation target', () => {
  assert.equal(playerDetailHrefForMemberCard({ memberCardId: 'ambiguous', golferIdsByMemberCard: {} }), null)
})

test('return path rejects external and protocol-relative destinations', () => {
  assert.equal(safeInternalReturnTo('https://example.com'), null)
  assert.equal(safeInternalReturnTo('//example.com'), null)
  assert.equal(safeInternalReturnTo('/\\example.com'), null)
  assert.equal(safeInternalReturnTo('/igc/mens-league?week=19'), '/igc/mens-league?week=19')
})

test('performance route preserves its exact player-detail return context', () => {
  assert.equal(
    playerPerformanceHref({ golferId: 'golfer-steven', compare: 'flight', returnTo: '/players/golfer-steven?week=19&from=%2Figc%2Fmens-league' }),
    '/players/golfer-steven/performance?compare=flight&from=%2Fplayers%2Fgolfer-steven%3Fweek%3D19%26from%3D%252Figc%252Fmens-league',
  )
})

test('performance comparator URL state round-trips without losing return context', () => {
  const returnTo = '/players/golfer-steven?week=20&from=%2Figc%2Fmens-league%3Fview%3Dweekly%26week%3D20'
  const href = playerPerformanceHref({ golferId: 'golfer-steven', compare: 'field', returnTo })
  const parsed = new URL(href, 'https://planit.test')
  assert.equal(parsed.searchParams.get('compare'), 'field')
  assert.equal(parsed.searchParams.get('from'), returnTo)
})
