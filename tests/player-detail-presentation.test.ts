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
  assert.match(landing, /At Interbay/)
  assert.match(landing, /Best vs field/)
  assert.match(landing, /Gives back most/)
  assert.match(landing, /See all nine holes/)
  assert.doesNotMatch(landing, /Gap to leader/)
  assert.doesNotMatch(landing, /Gross hole results/)
  assert.doesNotMatch(landing, /scoringDistribution/)
})

test('Performance focuses on occurrence-matched Interbay hole comparisons', () => {
  assert.match(performance, /Performance vs league/)
  assert.match(performance, /Best vs field/)
  assert.match(performance, /Gives back most/)
  assert.match(performance, /All 9 holes/)
  assert.match(performance, /cumulative vs field/)
  assert.match(performance, /other completed cards in that same audited 2026 Points Season occurrence/)
  assert.doesNotMatch(performance, /Gross hole results/)
  assert.doesNotMatch(performance, /Birdie or better/)
  assert.doesNotMatch(performance, /Strokes Gained/)
})

test('implemented hole-relative analysis records a fail-closed comparable-course contract', () => {
  assert.match(identityBoundary, /must be checked against the same source evidence and explicitly added/)
  assert.match(identityBoundary, /matching hole ordinals alone is never sufficient/)
  assert.match(identityBoundary, /player's gross\s+score/)
  assert.match(identityBoundary, /must not be called Strokes Gained/)
})
