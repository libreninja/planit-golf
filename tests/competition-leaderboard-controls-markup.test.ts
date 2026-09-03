import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('segmented controls support natural and full-width distributed geometry', () => {
  const source = readFileSync(new URL('../components/competition/segmented-control.tsx', import.meta.url), 'utf8')
  assert.match(source, /fill \? 'w-full min-w-0 flex-1' : 'w-fit shrink-0 self-start'/)
  assert.match(source, /fill && 'min-w-0 flex-1'/)
  const groupings = readFileSync(new URL('../components/competition/grouping-filter.tsx', import.meta.url), 'utf8')
  assert.match(groupings, /<SegmentedControl[\s\S]*fill[\s\S]*\/>/)
})

test('Gross/Net and flight controls share the same responsive row', () => {
  const source = readFileSync(new URL('../components/competition/standings-workspace.tsx', import.meta.url), 'utf8')
  assert.match(source, /flex w-full min-w-0 flex-nowrap items-center gap-2[\s\S]*<ScoringToggle[\s\S]*<GroupingFilter/)
  const groupings = readFileSync(new URL('../components/competition/grouping-filter.tsx', import.meta.url), 'utf8')
  assert.match(groupings, /label: 'All Flights'/)
  assert.match(groupings, /`Flight \$\{flightNumber\}`/)
  assert.match(groupings, /`Proj\. F\$\{flightNumber\}`/)
  assert.doesNotMatch(groupings, /label: 'Overall'/)
  assert.doesNotMatch(source, /overflow-x-auto/)
})

test('collapsed summary includes only primary leaderboard identity', () => {
  const source = readFileSync(new URL('../components/competition/standings-workspace.tsx', import.meta.url), 'utf8')
  const summary = source.slice(source.indexOf('const controlSummary'), source.indexOf('const filtersActive'))
  assert.match(summary, /occurrenceLabel/)
  assert.match(summary, /props\.scoring/)
  assert.match(summary, /groupingSummary/)
  assert.doesNotMatch(summary, /placedOnly|Hide unranked/)
})

test('projected provenance lives in the flight selector rather than a separate row', () => {
  const groupings = readFileSync(new URL('../components/competition/grouping-filter.tsx', import.meta.url), 'utf8')
  const workspace = readFileSync(new URL('../components/competition/standings-workspace.tsx', import.meta.url), 'utf8')
  assert.match(groupings, /projected \? `Proj\. F\$\{flightNumber\}`/)
  assert.doesNotMatch(workspace, /Projected results|About projected flights/)
})

test('expanded scorecard omits the Through narration', () => {
  const source = readFileSync(new URL('../components/competition/scorecard.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /toParNarration|Through \$\{first\.hole\}/)
})

test('Hide unranked keeps fixed geometry in both visual states', () => {
  const source = readFileSync(new URL('../components/competition/standings-workspace.tsx', import.meta.url), 'utf8')
  assert.match(source, /Hide unranked/)
  assert.doesNotMatch(source, /Placed only/)
  assert.equal(source.match(/min-w-\[7\.75rem\]/g)?.length, 2)
  assert.equal(source.match(/rounded-md border/g)?.length! >= 2, true)
})

test('CLEAR FILTERS is always reserved and only interactive when filters are dirty', () => {
  const source = readFileSync(new URL('../components/competition/leaderboard-clear-filters.tsx', import.meta.url), 'utf8')
  assert.match(source, /disabled=\{!active\}/)
  assert.match(source, /w-24/)
  assert.match(source, /disabled:opacity-40/)
  assert.doesNotMatch(source, /invisible|aria-hidden/)
  assert.match(source, /CLEAR FILTERS/)
  const workspace = readFileSync(new URL('../components/competition/standings-workspace.tsx', import.meta.url), 'utf8')
  assert.match(workspace, /ViewTabs|viewControl/)
  assert.match(workspace, /<LeaderboardClearFilters active=\{filtersActive\}/)
})

test('Latest scored-round action always renders inside the joined navigator', () => {
  const source = readFileSync(new URL('../components/competition/occurrence-nav.tsx', import.meta.url), 'utf8')
  assert.match(source, /disabled=\{isLatestResultsDisabled/)
  assert.match(source, /aria-label="Navigate league rounds"/)
  assert.match(source, /aria-label="Return to latest scored round"/)
  assert.match(source, />\s*Latest\s*</)
  assert.match(source, /overflow-hidden rounded-md border/)
  assert.doesNotMatch(source, /Loading…|navigating/)
})

test('occurrence loading replaces the leaderboard content area', () => {
  const source = readFileSync(new URL('../components/competition/standings-workspace.tsx', import.meta.url), 'utf8')
  assert.match(source, /\{occurrenceChanging \? \([\s\S]*<LoadingSkeleton \/>[\s\S]*\) : isInitialEmpty/)
  assert.match(source, /const activeOccurrenceId = selectedOccurrenceContextId/)
  assert.match(source, /find\(\(item\) => item\.id === activeOccurrenceId\)/)
  assert.match(source, /selectedId=\{activeOccurrenceId\}/)
  assert.doesNotMatch(source, /Loading…|Loading\.\.\./)
})
