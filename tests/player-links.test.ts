import { test } from 'node:test'
import assert from 'node:assert/strict'
import { playerDetailHrefForMemberCard, safeInternalReturnTo } from '../lib/players/links.ts'

test('leaderboard member card resolves to the correct canonical golfer and preserves source week', () => {
  const href = playerDetailHrefForMemberCard({
    memberCardId: 'card-steven',
    golferIdsByMemberCard: { 'card-steven': 'golfer-steven', 'card-other': 'golfer-other' },
    week: '19',
    returnTo: '/igc/mens-league?view=weekly&week=19&scoring=gross&grouping=2',
  })
  assert.equal(href, '/players/golfer-steven?week=19&from=%2Figc%2Fmens-league%3Fview%3Dweekly%26week%3D19%26scoring%3Dgross%26grouping%3D2')
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
