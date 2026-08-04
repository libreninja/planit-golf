import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideInitialRender } from '../components/competition/initial-render-decision.ts'

test('completed historical week (stored results) → render stored final, no live polling', () => {
  const d = decideInitialRender({ hasStoredResults: true, todayActive: false, selectedIsToday: false })
  assert.equal(d.useLivePath, false)
  assert.equal(d.initialIsHistoricalFinal, true)
  assert.equal(d.effectiveStatus, 'final')
})

test('today\'s in-window event with NO stored results yet → live path + polling', () => {
  const d = decideInitialRender({ hasStoredResults: false, todayActive: true, selectedIsToday: true })
  assert.equal(d.useLivePath, true)
  assert.equal(d.initialIsHistoricalFinal, false)
  assert.equal(d.effectiveStatus, 'live')
})

test('a genuinely empty occurrence (no results, not today) → honest empty state, no polling', () => {
  const d = decideInitialRender({ hasStoredResults: false, todayActive: false, selectedIsToday: false })
  assert.equal(d.useLivePath, false)
  assert.equal(d.initialIsHistoricalFinal, false)
  assert.equal(d.effectiveStatus, 'unknown')
})

test('today\'s event WITH stored final results → render stored (final wins over live)', () => {
  // A finalized today: results are present, so show them — don't fetch live.
  const d = decideInitialRender({ hasStoredResults: true, todayActive: true, selectedIsToday: true })
  assert.equal(d.useLivePath, false)
  assert.equal(d.effectiveStatus, 'final')
})

test('an in-window occurrence that is NOT today (e.g. a stale window) with no results → empty state, not live', () => {
  // selectedIsToday gates live; a non-today in-window occurrence never takes live.
  const d = decideInitialRender({ hasStoredResults: false, todayActive: true, selectedIsToday: false })
  assert.equal(d.useLivePath, false)
  assert.equal(d.effectiveStatus, 'unknown')
})

test('the decision is independent of scoring — gross/net never erases stored results', () => {
  // Scoring is a separate axis; the render decision only sees stored-results
  // evidence, so toggling Gross/Net cannot flip a historical week to empty/live.
  for (const hasStoredResults of [true, false]) {
    const d = decideInitialRender({ hasStoredResults, todayActive: false, selectedIsToday: false })
    assert.equal(d.useLivePath, false, `scoring must not enable live path when hasStoredResults=${hasStoredResults}`)
  }
})
