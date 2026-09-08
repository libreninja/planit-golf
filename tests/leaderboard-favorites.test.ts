import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('Weekly has one authoritative leaderboard and no duplicate For You summary', () => {
  const leaderboard = readFileSync(new URL('../components/competition/leaderboard.tsx', import.meta.url), 'utf8')
  const workspace = readFileSync(new URL('../components/competition/standings-workspace.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(leaderboard, /LeaderboardForYou|For you leaderboard summary|buildLeaderboardForYou/)
  assert.doesNotMatch(workspace, /showForYou|forYouLeaderboard/)
  assert.match(workspace, /Favorites/)
  assert.equal((workspace.match(/<Leaderboard\b/g) ?? []).length, 1)
})
