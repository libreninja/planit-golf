import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  LEADERBOARD_CONTROL_STICKY_CLASSES,
  nextLeaderboardPanelState,
} from '../components/competition/leaderboard-control-layout.ts'

test('scroll never changes expanded or collapsed state', () => {
  assert.equal(nextLeaderboardPanelState(true, 'scroll'), true)
  assert.equal(nextLeaderboardPanelState(false, 'scroll'), false)
})

test('manual toggle controls collapse and expand', () => {
  assert.equal(nextLeaderboardPanelState(true, 'toggle'), false)
  assert.equal(nextLeaderboardPanelState(false, 'toggle'), true)
})

test('the same sticky positioning applies to either manual state', () => {
  assert.match(LEADERBOARD_CONTROL_STICKY_CLASSES, /sticky/)
  assert.doesNotMatch(LEADERBOARD_CONTROL_STICKY_CLASSES, /static/)
})
