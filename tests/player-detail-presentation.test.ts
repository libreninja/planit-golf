import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const landing = readFileSync(new URL('../app/players/[golferId]/page.tsx', import.meta.url), 'utf8')
const performance = readFileSync(new URL('../app/players/[golferId]/performance/page.tsx', import.meta.url), 'utf8')
const identityBoundary = readFileSync(new URL('../docs/player-detail-v1-identity.md', import.meta.url), 'utf8')

test('landing page remains neutral and links to intentional performance analysis', () => {
  assert.match(landing, /grossVsSeasonAverage/)
  assert.match(landing, /recentVsSeasonAverage/)
  assert.match(landing, /Season best/)
  assert.match(landing, /Performance at Interbay/)
  assert.match(landing, /comparable.*round/)
  assert.match(landing, /Explore all nine holes/)
  assert.doesNotMatch(landing, /Best vs field/)
  assert.doesNotMatch(landing, /Gives back most/)
  assert.doesNotMatch(landing, /differentialPerPlay/)
  assert.doesNotMatch(landing, /Gap to leader/)
  assert.doesNotMatch(landing, /Gross hole results/)
  assert.doesNotMatch(landing, /scoringDistribution/)
})

test('Performance exposes explicit neutral Flight and Field comparison lenses', () => {
  assert.match(performance, /Performance vs league/)
  assert.match(performance, /Vs Flight/)
  assert.match(performance, /Vs Field/)
  assert.match(performance, /Relative strengths/)
  assert.match(performance, /Largest gaps/)
  assert.match(performance, /All 9 holes/)
  assert.match(performance, /cumulative vs/)
  assert.match(performance, /official flight is selected independently/)
  assert.match(performance, /gross and net result rows/)
  assert.match(performance, /completed individual gross/)
  assert.match(performance, /Official flight comparison is unavailable.*Showing Vs Field/)
  assert.doesNotMatch(performance, /Gives back most/)
  assert.doesNotMatch(performance, /worse/i)
  assert.doesNotMatch(performance, /Gross hole results/)
  assert.doesNotMatch(performance, /Birdie or better/)
  assert.doesNotMatch(performance, /Strokes Gained/)
})

test('implemented hole-relative analysis records a fail-closed comparable-course contract', () => {
  assert.match(identityBoundary, /must be checked against the same source evidence and explicitly added/)
  assert.match(identityBoundary, /matching hole ordinals alone is never sufficient/)
  assert.match(identityBoundary, /completed individual gross hole scores/)
  assert.match(identityBoundary, /does not give it a generalized professional-tour metric name/)
})
