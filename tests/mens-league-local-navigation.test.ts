import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  MENS_LEAGUE_DESTINATIONS,
  isMensLeagueDestinationActive,
  mensLeagueTeeSheetCompatibilityHref,
} from '../lib/igc/mens-league-navigation.ts'
import { buildBreadcrumb, buildNav, computeActiveHref } from '../lib/app-shell/navigation.ts'
import { normalizeUrlState } from '../components/competition/url-state.ts'
import type { AppShellUser } from '../lib/app-shell/user.ts'

const publicUser: AppShellUser = {
  signedIn: false,
  userId: null,
  email: null,
  displayName: null,
  league: null,
  gtgAccess: false,
  scouting: false,
  harvestCaptain: false,
  harvest: false,
  harvestReview: false,
  isAdmin: false,
}

test('Men’s League local navigation exposes Weekly then Season only', () => {
  assert.deepEqual(
    MENS_LEAGUE_DESTINATIONS.map(({ key, label, href }) => ({ key, label, href })),
    [
      { key: 'weekly', label: 'Weekly', href: '/igc/mens-league?view=weekly' },
      { key: 'season', label: 'Season', href: '/igc/mens-league?view=season' },
    ],
  )
})

test('exactly the selected local destination is current', () => {
  for (const active of MENS_LEAGUE_DESTINATIONS.map((item) => item.key)) {
    const states = MENS_LEAGUE_DESTINATIONS.map((item) => (
      isMensLeagueDestinationActive(item.key, active)
    ))
    assert.equal(states.filter(Boolean).length, 1)
    assert.equal(states[MENS_LEAGUE_DESTINATIONS.findIndex((item) => item.key === active)], true)
  }

  const markup = readFileSync(new URL('../components/igc/mens-league-local-navigation.tsx', import.meta.url), 'utf8')
  assert.match(markup, /<Link/)
  assert.match(markup, /href=\{destination\.href\}/)
  assert.match(markup, /aria-current=\{active \? 'page' : undefined\}/)
  assert.match(markup, /aria-label="Men's League"/)
  assert.match(markup, /grid-cols-2/)
  assert.doesNotMatch(markup, /Tee Sheet/)
})

test('Weekly owns leaderboard controls while Season renders without a filter panel', () => {
  const shell = readFileSync(new URL('../components/competition/standings-shell.tsx', import.meta.url), 'utf8')
  const weekly = readFileSync(new URL('../components/competition/standings-workspace.tsx', import.meta.url), 'utf8')

  assert.match(shell, /<MensLeagueLocalNavigation/)
  assert.match(shell, /showSeason \? \([\s\S]*<SeasonPointsView[\s\S]*\) : \([\s\S]*<StandingsWorkspace/)
  assert.doesNotMatch(shell, /LeaderboardControlPanel|LeaderboardClearFilters|ViewTabs/)
  assert.match(weekly, /<LeaderboardControlPanel/)
  assert.match(weekly, /<OccurrenceNav/)
  assert.match(weekly, /<ScoringToggle/)
  assert.match(weekly, /<GroupingFilter/)
  assert.match(weekly, /Hide unranked/)
  assert.match(weekly, /<LeaderboardClearFilters/)
})

test('the former Tee Sheet route redirects into Weekly and preserves deep-link context', () => {
  const page = readFileSync(new URL('../app/igc/mens-league/tee-sheet/page.tsx', import.meta.url), 'utf8')
  const teeSheet = readFileSync(new URL('../components/competition/weekly-tee-sheet.tsx', import.meta.url), 'utf8')

  assert.match(page, /redirect\(mensLeagueTeeSheetCompatibilityHref\(await searchParams\)\)/)
  assert.doesNotMatch(page, /WeeklyTeeSheet|MensLeagueLocalNavigation/)
  assert.equal(
    mensLeagueTeeSheetCompatibilityHref({ week: '23', view: 'season', source: 'saved' }),
    '/igc/mens-league?week=23&view=weekly&source=saved',
  )
  assert.match(teeSheet, /aria-label="Tee sheet view"/)
  assert.match(teeSheet, /For you/)
  assert.match(teeSheet, /Full tee sheet/)
})

test('global navigation omits Tee Sheet and Standings is not active on its route', () => {
  const nav = buildNav(publicUser)
  const links = nav.filter((item) => item.type === 'link')
  assert.equal(links.some((item) => item.label === 'Tee Sheet'), false)
  assert.equal(computeActiveHref('/igc/mens-league', nav), '/igc/mens-league')
  assert.notEqual(computeActiveHref('/igc/mens-league/tee-sheet', nav), '/igc/mens-league')
})

test('Men’s League breadcrumbs stay at the league level, including during compatibility redirect', () => {
  assert.deepEqual(
    buildBreadcrumb('/igc/mens-league').map((crumb) => crumb.label),
    ['Interbay', "Men's League"],
  )
  assert.deepEqual(
    buildBreadcrumb('/igc/mens-league/tee-sheet').map((crumb) => crumb.label),
    ['Interbay', "Men's League"],
  )
})

test('existing standings deep-link query state remains accepted', () => {
  const state = normalizeUrlState(
    new URLSearchParams('view=weekly&week=17&scoring=gross&grouping=Flight+2&placed=only'),
    { occurrenceParam: 'week', allowedViews: ['season', 'weekly'], allowedScoring: ['gross', 'net'] },
  )
  assert.deepEqual(state, {
    view: 'weekly', occurrenceId: '17', scoring: 'gross', grouping: 'Flight 2', placedOnly: true,
  })
})
