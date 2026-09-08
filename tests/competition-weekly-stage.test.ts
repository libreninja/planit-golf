import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  resolveWeeklyStage,
  weeklyStageUsesLeaderboardControls,
} from '../components/competition/weekly-stage.ts'

test('authoritative final and live scoring outrank a published tee sheet', () => {
  assert.equal(resolveWeeklyStage({
    resultStatus: 'live', historicalFinal: false, teeSheetStatus: 'published',
  }), 'live')
  assert.equal(resolveWeeklyStage({
    resultStatus: 'unknown', historicalFinal: true, teeSheetStatus: 'published',
  }), 'final')
  assert.equal(resolveWeeklyStage({
    resultStatus: 'final', historicalFinal: false, teeSheetStatus: 'published',
  }), 'final')
})

test('REGRESSION: live response outranks a previously stored final-like render memo', () => {
  assert.equal(resolveWeeklyStage({
    resultStatus: 'live', historicalFinal: true, teeSheetStatus: 'published',
  }), 'live')
})

test('published pairings and confirmed absence produce distinct upcoming states', () => {
  assert.equal(resolveWeeklyStage({
    resultStatus: 'not_started', historicalFinal: false, teeSheetStatus: 'published',
  }), 'pairings')
  assert.equal(resolveWeeklyStage({
    resultStatus: 'not_started', historicalFinal: false, teeSheetStatus: 'not_published',
  }), 'upcoming')
  assert.equal(resolveWeeklyStage({
    resultStatus: 'unknown', historicalFinal: false, teeSheetStatus: 'unavailable',
  }), 'unavailable')
})

test('only live and final stages own leaderboard filters', () => {
  assert.equal(weeklyStageUsesLeaderboardControls('upcoming'), false)
  assert.equal(weeklyStageUsesLeaderboardControls('pairings'), false)
  assert.equal(weeklyStageUsesLeaderboardControls('unavailable'), false)
  assert.equal(weeklyStageUsesLeaderboardControls('live'), true)
  assert.equal(weeklyStageUsesLeaderboardControls('final'), true)
})

test('Weekly renders occurrence navigation in every stage and leaderboard filters only for live/final', () => {
  const workspace = readFileSync(new URL('../components/competition/standings-workspace.tsx', import.meta.url), 'utf8')
  assert.match(workspace, /<OccurrenceNav/)
  assert.match(workspace, /const leaderboardStage = scoringPending \|\| !mensWeeklyLifecycle \|\| weeklyStageUsesLeaderboardControls/)
  assert.match(workspace, /\{leaderboardStage \? \([\s\S]*<LeaderboardClearFilters/)
  assert.match(workspace, /\{leaderboardStage \? \([\s\S]*<ScoringToggle[\s\S]*<GroupingFilter[\s\S]*Hide unranked/)
  assert.match(workspace, /weeklyStage === 'pairings' \|\| weeklyStage === 'upcoming'[\s\S]*<WeeklyUpcoming/)
})

test('selected occurrence tee-sheet lookup is week-scoped rather than latest/today-only', () => {
  const server = readFileSync(new URL('../components/competition/standings-workspace-server.tsx', import.meta.url), 'utf8')
  const data = readFileSync(new URL('../lib/competition/weekly-tee-sheet-data.ts', import.meta.url), 'utf8')
  assert.match(server, /getMensWeeklyTeeSheet\(selected\.id\)/)
  assert.match(data, /\.eq\('week_number', weekNumber\)/)
})
