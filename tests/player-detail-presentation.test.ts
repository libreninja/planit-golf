import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const landing = readFileSync(new URL('../app/players/[golferId]/page.tsx', import.meta.url), 'utf8')
const performance = readFileSync(new URL('../app/players/[golferId]/performance/page.tsx', import.meta.url), 'utf8')
const identityBoundary = readFileSync(new URL('../docs/player-detail-v1-identity.md', import.meta.url), 'utf8')

test('landing page focuses on result and form comparisons, not interpretive analytics', () => {
  assert.match(landing, /grossVsSeasonAverage/)
  assert.match(landing, /recentVsSeasonAverage/)
  assert.match(landing, /Season best/)
  assert.match(landing, /See performance/)
  assert.doesNotMatch(landing, /Gap to leader/)
  assert.doesNotMatch(landing, /Gross hole results/)
  assert.doesNotMatch(landing, /scoringDistribution/)
})

test('interpretive distribution lives on the deeper Performance route', () => {
  assert.match(performance, /Scoring outcomes/)
  assert.match(performance, /Gross hole results/)
  assert.doesNotMatch(performance, /Strokes Gained/)
})

test('future hole-relative analysis records a comparable-course contract and transparent terminology', () => {
  assert.match(identityBoundary, /stable course, tee, and hole identity/)
  assert.match(identityBoundary, /player-average minus league-average/)
  assert.match(identityBoundary, /must not be called Strokes Gained/)
})
