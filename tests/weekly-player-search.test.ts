import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  filterLeaderboardByFavorites,
  filterLeaderboardByGrouping,
  filterLeaderboardByPlacement,
  filterLeaderboardByPlayerName,
} from '../components/competition/leaderboard-filter.ts'
import { filterWeeklyTeeSheetByPlayerName } from '../lib/competition/weekly-tee-sheet.ts'
import type { Leaderboard } from '../lib/competition/types.ts'

function board(): Leaderboard {
  const rows = [
    { key: 'a', name: 'Olson, Hans', flight: 'Flight 1', positionLabel: '1', memberCardId: 'mc-a' },
    { key: 'b', name: 'De La Cruz, Ana Maria', flight: 'Flight 2', positionLabel: '2', memberCardId: 'mc-b' },
    { key: 'c', name: 'Van Hollebeke, Benjamin Alexander', flight: 'Flight 1', positionLabel: null, memberCardId: 'mc-c' },
  ]
  return {
    occurrenceId: '24',
    scoringMode: 'gross',
    grouping: null,
    resultStatus: 'final',
    durableCurrent: true,
    entries: rows.map((row, index) => ({
      key: row.key,
      name: row.name,
      flight: row.flight,
      positionLabel: row.positionLabel,
      positionOrder: index + 1,
      points: null,
      purse: null,
    })),
    scorecards: rows.map((row) => ({
      key: row.key,
      memberCardId: row.memberCardId,
      name: row.name,
      netTotal: null,
      grossTotal: null,
      toParNet: null,
      toParGross: null,
      holesCompleted: 0,
      scorecardStatus: null,
      isLive: false,
      holes: [],
    })),
  }
}

test('Weekly search matches displayed First Last names case-insensitively', () => {
  const source = board()
  assert.deepEqual(filterLeaderboardByPlayerName(source, 'Hans Olson')!.entries.map((row) => row.key), ['a'])
  assert.deepEqual(filterLeaderboardByPlayerName(source, 'aNa mArIa de la cruz')!.entries.map((row) => row.key), ['b'])
})

test('Weekly search composes with flight, Favorites, and Hide unranked using AND semantics', () => {
  const source = board()
  const followState = { signedIn: true, followedGolferIds: ['golfer-a', 'golfer-b'], selfGolferIds: [] }
  const identities = { 'mc-a': 'golfer-a', 'mc-b': 'golfer-b', 'mc-c': 'golfer-c' }

  const flight = filterLeaderboardByGrouping(source, 'Flight 1')
  assert.deepEqual(filterLeaderboardByPlayerName(flight, 'Hans')!.entries.map((row) => row.key), ['a'])

  const favorites = filterLeaderboardByFavorites(source, true, identities, followState)
  assert.deepEqual(filterLeaderboardByPlayerName(favorites, 'Ana')!.entries.map((row) => row.key), ['b'])

  const ranked = filterLeaderboardByPlacement(source, true)
  assert.deepEqual(filterLeaderboardByPlayerName(ranked, 'Benjamin')!.entries, [])
})

test('clearing search restores the same board and no-match is an empty selection', () => {
  const source = board()
  assert.equal(filterLeaderboardByPlayerName(source, ''), source)
  assert.equal(filterLeaderboardByPlayerName(source, '   '), source)
  assert.deepEqual(filterLeaderboardByPlayerName(source, 'Nobody Here')!.entries, [])
})

test('search preserves authoritative row order and identity/provenance objects', () => {
  const source = board()
  const scorecards = source.scorecards
  const result = filterLeaderboardByPlayerName(source, 'ol')!
  assert.deepEqual(result.entries.map((row) => row.key), ['a', 'c'])
  assert.equal(result.scorecards, scorecards)
  assert.equal(result.occurrenceId, source.occurrenceId)
  assert.deepEqual(source.entries.map((row) => row.key), ['a', 'b', 'c'])
})

test('upcoming search selects displayed names locally while retaining tee-time provenance', () => {
  const groups = [{
    id: 'group-1', date: '2026-09-08', teeTime: '4:30 PM', startingTee: '1',
    course: 'Interbay', rotation: null, groupLabel: 'A', sortOrder: 0,
    players: [
      { sourceName: 'Olson, Hans', firstName: 'Hans', lastName: 'Olson', memberCardId: 'mc-a', teamName: null },
      { sourceName: 'Smith, Alexandra Catherine', firstName: null, lastName: null, memberCardId: 'mc-long', teamName: null },
    ],
  }]
  const result = filterWeeklyTeeSheetByPlayerName(groups, 'alexandra catherine smith')
  assert.equal(result[0].id, 'group-1')
  assert.equal(result[0].teeTime, '4:30 PM')
  assert.deepEqual(result[0].players.map((player) => player.memberCardId), ['mc-long'])
  assert.equal(groups[0].players.length, 2)
})

test('search is prominent above Weekly controls and uses no navigation or request per keystroke', () => {
  const workspace = readFileSync(new URL('../components/competition/standings-workspace.tsx', import.meta.url), 'utf8')
  const shell = readFileSync(new URL('../components/competition/standings-shell.tsx', import.meta.url), 'utf8')
  const search = readFileSync(new URL('../components/competition/player-search.tsx', import.meta.url), 'utf8')
  assert.ok(workspace.indexOf('<PlayerSearch') < workspace.indexOf('<LeaderboardControlPanel'))
  assert.match(search, /placeholder="Search players"/)
  assert.match(search, /aria-label="Clear player search"/)
  assert.match(workspace, /filterLeaderboardByPlayerName\(followedLb, props\.searchQuery\)/)
  assert.match(shell, /window\.history\.replaceState/)
  assert.doesNotMatch(search, /fetch\(|router\.|useRouter/)
})

test('no-match state states uncertainty correctly and clears only the search', () => {
  const search = readFileSync(new URL('../components/competition/player-search.tsx', import.meta.url), 'utf8')
  const workspace = readFileSync(new URL('../components/competition/standings-workspace.tsx', import.meta.url), 'utf8')
  assert.match(search, />No players match</)
  assert.match(search, />\s*Clear search\s*</)
  assert.doesNotMatch(search, /not participating|isn.t playing/i)
  assert.match(workspace, /onClearSearch=\{\(\) => props\.onSearchQueryChange\(''\)\}/)
})
