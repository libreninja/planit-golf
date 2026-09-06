import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildLeaderboardForYou } from '../lib/players/leaderboard-for-you.ts'
import type { Leaderboard, Scorecard } from '../lib/competition/types.ts'

function card(key: string, memberCardId: string | null, gross: number | null, net: number | null, holesCompleted = 9): Scorecard {
  return {
    key, memberCardId, name: key,
    grossTotal: gross === null ? null : gross + 36,
    netTotal: net === null ? null : net + 36,
    toParGross: gross, toParNet: net, holesCompleted,
    scorecardStatus: holesCompleted === 9 ? 'completed' : 'in_progress',
    isLive: holesCompleted > 0 && holesCompleted < 9,
    holes: [],
  }
}

function board(scoringMode: 'gross' | 'net' = 'net'): Leaderboard {
  const keys = ['leader', 'self', 'followed', 'unfollowed', 'unresolved']
  return {
    occurrenceId: '21', scoringMode, grouping: null, resultStatus: 'live', durableCurrent: false,
    entries: keys.map((key, index) => ({
      key, name: `${key}, Player`, positionLabel: index < 3 ? String(index + 1) : null,
      positionOrder: index + 1, points: null, purse: null, flight: null,
    })),
    scorecards: [
      card('leader', 'card-leader', -3, -1),
      card('self', 'card-self', 2, 0, 7),
      card('followed', 'card-followed', -1, 4, 6),
      card('unfollowed', 'card-unfollowed', 0, 1),
      card('unresolved', 'card-unresolved', 1, 2),
    ],
  }
}

test('summary includes trustworthy You first and followed golfers in board order', () => {
  const leaderboard = board()
  const originalOrder = leaderboard.entries.map((entry) => entry.key)
  const summary = buildLeaderboardForYou({
    leaderboard,
    golferIdsByMemberCard: {
      'card-leader': 'golfer-leader', 'card-self': 'golfer-self',
      'card-followed': 'golfer-followed', 'card-unfollowed': 'golfer-unfollowed',
    },
    followState: {
      signedIn: true,
      followedGolferIds: ['golfer-leader', 'golfer-followed'],
      selfGolferIds: ['golfer-self'],
    },
  })

  assert.deepEqual(summary.map((item) => item.key), ['self', 'leader', 'followed'])
  assert.equal(summary[0].isSelf, true)
  assert.deepEqual(leaderboard.entries.map((entry) => entry.key), originalOrder)
  assert.ok(!summary.some((item) => item.key === 'unfollowed'))
  assert.ok(!summary.some((item) => item.key === 'unresolved'))
})

test('You is omitted without an explicit self link and Gross/Net context is selected correctly', () => {
  const input = {
    golferIdsByMemberCard: { 'card-self': 'golfer-self', 'card-followed': 'golfer-followed' },
    followState: { signedIn: true, followedGolferIds: ['golfer-followed'], selfGolferIds: [] },
  }
  const net = buildLeaderboardForYou({ leaderboard: board('net'), ...input })
  const gross = buildLeaderboardForYou({ leaderboard: board('gross'), ...input })

  assert.deepEqual(net.map((item) => item.key), ['followed'])
  assert.equal(net[0].score, '+4')
  assert.equal(gross[0].score, '-1')
})

test('empty follow and self state produces no personalized duplicate', () => {
  const leaderboard = board()
  const summary = buildLeaderboardForYou({
    leaderboard,
    golferIdsByMemberCard: { 'card-leader': 'golfer-leader' },
    followState: { signedIn: false, followedGolferIds: [], selfGolferIds: [] },
  })

  assert.deepEqual(summary, [])
  assert.equal(leaderboard.entries.length, 5)
})

test('final leaderboard progress is labeled final without changing authoritative placement', () => {
  const leaderboard = { ...board(), resultStatus: 'final' as const }
  const summary = buildLeaderboardForYou({
    leaderboard,
    golferIdsByMemberCard: { 'card-followed': 'golfer-followed' },
    followState: { signedIn: true, followedGolferIds: ['golfer-followed'], selfGolferIds: [] },
  })

  assert.equal(summary[0]?.progress, 'F')
  assert.equal(summary[0]?.position, '3')
  assert.equal(leaderboard.entries[2]?.positionLabel, '3')
})
