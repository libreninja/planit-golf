import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const landing = readFileSync(new URL('../app/players/[golferId]/page.tsx', import.meta.url), 'utf8')
const performance = readFileSync(new URL('../app/players/[golferId]/performance/page.tsx', import.meta.url), 'utf8')
const identityBoundary = readFileSync(new URL('../docs/player-detail-v1-identity.md', import.meta.url), 'utf8')

test('landing page remains neutral and links to intentional performance analysis', () => {
  assert.match(landing, /grossVsSeasonAverage/)
  assert.match(landing, /Season best/)
  assert.match(landing, /Performance at Interbay/)
  assert.match(landing, /performance\.comparableRounds/)
  assert.match(landing, /playerRoundPresentation/)
  assert.doesNotMatch(landing, /Best vs field/)
  assert.doesNotMatch(landing, /Gives back most/)
  assert.doesNotMatch(landing, /differentialPerPlay/)
  assert.doesNotMatch(landing, /Gap to leader/)
  assert.doesNotMatch(landing, /Gross hole results/)
  assert.doesNotMatch(landing, /scoringDistribution/)
  assert.doesNotMatch(landing, /Selected result/i)
  assert.doesNotMatch(landing, /Handicap Index/i)
  assert.doesNotMatch(landing, /Gross finish|Net finish/)
  assert.doesNotMatch(landing, /How .* has been playing/)
  assert.doesNotMatch(landing, /Completed 9-hole individual rounds/)
})

test('Performance exposes explicit neutral Flight and Field comparison lenses', () => {
  assert.match(performance, /Vs Flight/)
  assert.match(performance, /Vs Field/)
  assert.match(performance, /Relative strengths/)
  assert.match(performance, /Largest gaps/)
  assert.match(performance, /All 9 holes/)
  assert.match(performance, /total vs/)
  assert.match(performance, /official flight is selected independently/)
  assert.match(performance, /gross and net result rows/)
  assert.match(performance, /completed individual gross/)
  assert.match(performance, /Official flight comparison unavailable.*showing Vs Field/)
  assert.match(performance, /Methodology &amp; sample/)
  assert.doesNotMatch(performance, /Performance vs league/)
  assert.doesNotMatch(performance, /How .* plays these nine holes/)
  assert.doesNotMatch(performance, /Gives back most/)
  assert.doesNotMatch(performance, /worse/i)
  assert.doesNotMatch(performance, /Gross hole results/)
  assert.doesNotMatch(performance, /Birdie or better/)
  assert.doesNotMatch(performance, /Strokes Gained/)
})

test('slow Player Detail and Performance transitions acknowledge navigation immediately', () => {
  assert.match(landing, /PendingLink[\s\S]*Back to leaderboard/)
  assert.match(landing, /pendingLabel="Opening…"[\s\S]*Performance at Interbay/)
  assert.match(performance, /PendingLink[\s\S]*Back to player/)
  assert.equal(performance.match(/pendingClassName="bg-background text-foreground shadow-sm"/g)?.length, 2)
})

test('entity return links keep arrow and label in one compact navigation control', () => {
  for (const source of [landing, performance]) {
    assert.match(source, /className="inline-flex max-w-full whitespace-nowrap/)
    assert.match(source, /contentClassName="inline-flex max-w-full min-w-0 items-center gap-1 whitespace-nowrap"/)
    assert.match(source, /ArrowLeft className="h-4 w-4 shrink-0"/)
  }
  assert.match(landing, /<span className="truncate">Back to leaderboard<\/span>/)
  assert.match(performance, /<span className="truncate">Back to player<\/span>/)
})

test('Performance reuses canonical compact Follow state beside First Last identity', () => {
  assert.match(performance, /displayPersonName\(data\.displayName\)/)
  assert.match(performance, /<div className="flex min-w-0 items-center gap-1">[\s\S]*<h1[\s\S]*<FollowControl/)
  assert.match(performance, /golferId=\{data\.golferId\}/)
  assert.match(performance, /signedIn=\{data\.viewer\.signedIn\}/)
  assert.match(performance, /isSelf=\{data\.viewer\.isSelf\}/)
  assert.match(performance, /initialFollowing=\{data\.viewer\.isFollowing\}/)
  assert.doesNotMatch(performance, />Follow</)
})

test('implemented hole-relative analysis records a fail-closed comparable-course contract', () => {
  assert.match(identityBoundary, /must be checked against the same source evidence and explicitly added/)
  assert.match(identityBoundary, /matching hole ordinals alone is never sufficient/)
  assert.match(identityBoundary, /completed individual gross hole scores/)
  assert.match(identityBoundary, /does not give it a generalized professional-tour metric name/)
})
