import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolveLeaderboardPlayerInteraction } from '../lib/players/leaderboard-interaction.ts'

test('inline star resolves canonical golfer follow state and preserves result context', () => {
  const interaction = resolveLeaderboardPlayerInteraction({
    memberCardId: 'member-1',
    golferIdsByMemberCard: { 'member-1': 'golfer-1' },
    followState: { signedIn: true, followedGolferIds: ['golfer-1'], selfGolferIds: [] },
    week: '21',
    scoring: 'net',
    returnTo: '/igc/mens-league?view=weekly&week=21&scoring=net',
  })
  assert.deepEqual(interaction, {
    golferId: 'golfer-1',
    playerHref: '/players/golfer-1?week=21&scoring=net&from=%2Figc%2Fmens-league%3Fview%3Dweekly%26week%3D21%26scoring%3Dnet',
    signedIn: true,
    initialFollowing: true,
    isSelf: false,
  })
})

test('unresolved leaderboard identity exposes neither player navigation nor follow interaction', () => {
  assert.equal(resolveLeaderboardPlayerInteraction({
    memberCardId: 'unresolved-member',
    golferIdsByMemberCard: {},
    followState: { signedIn: true, followedGolferIds: [], selfGolferIds: [] },
  }), null)
})

test('player link, star, and scorecard remain distinct tap targets', () => {
  const source = readFileSync(new URL('../components/competition/scorecard.tsx', import.meta.url), 'utf8')
  assert.match(source, /<Link[\s\S]*playerInteraction\.playerHref[\s\S]*entry\.name[\s\S]*<\/Link>/)
  assert.match(source, /<FollowControl[\s\S]*golferId=\{playerInteraction\.golferId\}/)
  assert.match(source, /<button type="button" onClick=\{onToggle\}[\s\S]*scorecard/)
  const playerLink = source.indexOf('href={playerInteraction.playerHref}')
  const playerLinkClose = source.indexOf('</Link>', playerLink)
  const followControl = source.indexOf('<FollowControl', playerLink)
  assert.ok(playerLink >= 0 && playerLinkClose > playerLink && followControl > playerLinkClose)
})

test('star affordance is filled only for followed state and uses canonical follow action', () => {
  const source = readFileSync(new URL('../components/players/follow-control.tsx', import.meta.url), 'utf8')
  assert.match(source, /setGolferFollow\(golferId, next\)/)
  assert.match(source, /following && 'fill-current'/)
  assert.match(source, /aria-label=\{following \? 'Unfollow player' : 'Follow player'\}/)
})
