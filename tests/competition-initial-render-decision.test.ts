import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideInitialRender } from '../components/competition/initial-render-decision.ts'

test('completed historical week (stored results) → render stored final, no live polling', () => {
  const d = decideInitialRender({ hasStoredResults: true, todayActive: false, selectedIsToday: false, todayLiveHasGolf: false })
  assert.equal(d.useLivePath, false)
  assert.equal(d.initialIsHistoricalFinal, true)
  assert.equal(d.effectiveStatus, 'final')
})

test('today\'s in-window event with NO stored results yet and no live golf posted → live path + polling', () => {
  const d = decideInitialRender({ hasStoredResults: false, todayActive: true, selectedIsToday: true, todayLiveHasGolf: false })
  assert.equal(d.useLivePath, true)
  assert.equal(d.initialIsHistoricalFinal, false)
  assert.equal(d.effectiveStatus, 'live')
})

test('a genuinely empty occurrence (no results, not today) → honest empty state, no polling', () => {
  const d = decideInitialRender({ hasStoredResults: false, todayActive: false, selectedIsToday: false, todayLiveHasGolf: false })
  assert.equal(d.useLivePath, false)
  assert.equal(d.initialIsHistoricalFinal, false)
  assert.equal(d.effectiveStatus, 'unknown')
})

test('today\'s event WITH stored final results and NO live golf now → render stored (final wins)', () => {
  // A finalized today with no live scoring in progress: show stored results.
  const d = decideInitialRender({ hasStoredResults: true, todayActive: true, selectedIsToday: true, todayLiveHasGolf: false })
  assert.equal(d.useLivePath, false)
  assert.equal(d.effectiveStatus, 'final')
})

test('today\'s in-window event WITH meaningful live golf AND stored rows → LIVE wins over stored', () => {
  // Golf is happening right now (live scorecards with holes completed): show
  // live scoring even though stale/partial stored rows exist.
  const d = decideInitialRender({ hasStoredResults: true, todayActive: true, selectedIsToday: true, todayLiveHasGolf: true })
  assert.equal(d.useLivePath, true)
  assert.equal(d.initialIsHistoricalFinal, false)
  assert.equal(d.effectiveStatus, 'live')
})

test('an in-window occurrence that is NOT today (e.g. a stale window) with no results → empty state, not live', () => {
  // selectedIsToday gates live; a non-today in-window occurrence never takes live.
  const d = decideInitialRender({ hasStoredResults: false, todayActive: true, selectedIsToday: false, todayLiveHasGolf: false })
  assert.equal(d.useLivePath, false)
  assert.equal(d.effectiveStatus, 'unknown')
})

test('meaningful live golf on a NON-today occurrence does NOT trigger live (selectedIsToday gates it)', () => {
  const d = decideInitialRender({ hasStoredResults: false, todayActive: true, selectedIsToday: false, todayLiveHasGolf: true })
  assert.equal(d.useLivePath, false)
  assert.equal(d.effectiveStatus, 'unknown')
})

test('the decision is independent of scoring — gross/net never erases stored results', () => {
  // Scoring is a separate axis; the render decision only sees stored-results
  // evidence, so toggling Gross/Net cannot flip a historical week to empty/live.
  for (const hasStoredResults of [true, false]) {
    const d = decideInitialRender({ hasStoredResults, todayActive: false, selectedIsToday: false, todayLiveHasGolf: false })
    assert.equal(d.useLivePath, false, `scoring must not enable live path when hasStoredResults=${hasStoredResults}`)
  }
})