import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  MAX_TEAM_POINTS,
  ROUND_LIST,
  TOTAL_TOURNAMENT_POINTS,
  matchNoFor,
} from '../lib/seattle-cup/config.ts'
import {
  calculateSeattleCupRaceStatus,
  isTeamEliminatedOnPoints,
  SEATTLE_CUP_RACE_INVARIANTS,
  type SeattleCupRaceInput,
} from '../lib/seattle-cup/race.ts'
import type { MatchState, MatchStatus, TeamKey } from '../lib/seattle-cup/types.ts'

type Points = Record<TeamKey, number>
type TestMatch = SeattleCupRaceInput['matches'][number]

const ZERO: Points = {
  interbay: 0,
  'jackson-park': 0,
  'bill-wright': 0,
  'west-seattle': 0,
}

const CURRENT: Points = {
  interbay: 7.5,
  'jackson-park': 7.5,
  'bill-wright': 5.5,
  'west-seattle': 3.5,
}

function schedule(): TestMatch[] {
  return ROUND_LIST.flatMap((round) => round.matchSlots.map((slot, index) => ({
    matchNo: matchNoFor(round.round, index),
    teamA: slot.teamA,
    teamB: slot.teamB,
    status: 'scheduled' as const,
    matchState: 'tbd' as const,
    leadSide: null,
  })))
}

function input(
  points: Points,
  mutate: (matches: TestMatch[]) => void = () => {},
): SeattleCupRaceInput[] {
  const matches = schedule()
  mutate(matches)
  return [{
    matches,
    fetchedAt: 1,
    overallStandings: Object.entries(points).map(([teamKey, totalPoints]) => ({
      teamKey: teamKey as TeamKey,
      totalPoints,
      roundPoints: 0,
      matchesPlayed: 0,
      matchesWon: 0,
      matchesHalved: 0,
      matchesLost: 0,
    })),
  }]
}

function setStatus(
  matches: TestMatch[],
  matchNo: number,
  status: MatchStatus,
  matchState: MatchState,
  leadSide: 'A' | 'B' | null,
) {
  const match = matches.find((candidate) => candidate.matchNo === matchNo)
  assert.ok(match, `match ${matchNo} exists`)
  Object.assign(match, { status, matchState, leadSide })
}

function finalizeThrough(matches: TestMatch[], matchNo: number) {
  for (const match of matches) {
    if (match.matchNo <= matchNo) Object.assign(match, {
      status: 'final' as const,
      matchState: 'final' as const,
      leadSide: null,
    })
  }
}

test('production-shaped 2026 graph is 60 tournament points with a 30-point team ceiling', () => {
  assert.equal(TOTAL_TOURNAMENT_POINTS, 60)
  assert.equal(MAX_TEAM_POINTS, 30)
  assert.deepEqual(SEATTLE_CUP_RACE_INVARIANTS, {
    totalTournamentPoints: 60,
    maximumTeamPoints: 30,
    scoringIncrement: 0.5,
  })
  assert.deepEqual(ROUND_LIST.map((round) => round.matchSlots.length), [12, 12, 12, 24])

  const perRoundTeamCeilings = ROUND_LIST.map((round) => Math.max(...Object.keys(ZERO).map((teamKey) =>
    round.matchSlots.filter((slot) => slot.teamA === teamKey || slot.teamB === teamKey).length,
  )))
  assert.deepEqual(perRoundTeamCeilings, [6, 6, 6, 12])
  const singlesPairCounts = new Map<string, number>()
  for (const slot of ROUND_LIST[3]!.matchSlots) {
    const key = [slot.teamA, slot.teamB].sort().join('|')
    singlesPairCounts.set(key, (singlesPairCounts.get(key) ?? 0) + 1)
  }
  assert.deepEqual([...singlesPairCounts.values()].sort((a, b) => a - b), [3, 3, 4, 4, 5, 5])
})

test('tournament start is OUTRIGHT with a graph-derived 26 line and 60 available', () => {
  const race = calculateSeattleCupRaceStatus(input(ZERO))
  assert.deepEqual(race, {
    toWin: 26,
    mode: 'outright',
    state: 'active',
    availablePoints: 60,
    leaderTeamKeys: ['interbay', 'jackson-park', 'bill-wright', 'west-seattle'],
    projectedPoints: ZERO,
  })
})

test('current post-R1/R2 tied-leader state is OUTRIGHT 23 with 36 available', () => {
  const race = calculateSeattleCupRaceStatus(input(CURRENT, (matches) => finalizeThrough(matches, 24)))
  assert.deepEqual(race, {
    toWin: 23,
    mode: 'outright',
    state: 'active',
    availablePoints: 36,
    leaderTeamKeys: ['interbay', 'jackson-park'],
    projectedPoints: ZERO,
  })
})

test('half-point standings make the 22.5 runner-up boundary require 23 outright', () => {
  const race = calculateSeattleCupRaceStatus(input(CURRENT, (matches) => finalizeThrough(matches, 24)))
  assert.equal(race.toWin, 23)
  assert.equal(race.toWin! - 0.5, 22.5)
})

test('supported live leader produces a current-state PROJECTED threshold', () => {
  const race = calculateSeattleCupRaceStatus(input(CURRENT, (matches) => {
    finalizeThrough(matches, 24)
    setStatus(matches, 25, 'live', 'a-up', 'A')
  }))
  assert.equal(race.mode, 'projected')
  assert.equal(race.state, 'active')
  assert.equal(race.toWin, 23)
  assert.equal(race.availablePoints, 36, 'unfinalized live point remains available')
  assert.deepEqual(race.projectedPoints, {
    ...ZERO,
    interbay: 1,
  })
})

test('live all-square projects the current match as 0.5-0.5', () => {
  const race = calculateSeattleCupRaceStatus(input(CURRENT, (matches) => {
    finalizeThrough(matches, 24)
    setStatus(matches, 25, 'live', 'all-square', null)
  }))
  assert.equal(race.mode, 'projected')
  assert.equal(race.toWin, 23)
  assert.equal(race.availablePoints, 36)
  assert.deepEqual(race.projectedPoints, {
    ...ZERO,
    interbay: 0.5,
    'jackson-park': 0.5,
  })
})

test('mixture of finalized, live, and scheduled matches retains each state correctly', () => {
  const race = calculateSeattleCupRaceStatus(input(CURRENT, (matches) => {
    finalizeThrough(matches, 26)
    setStatus(matches, 27, 'live', 'b-up', 'B')
  }))
  assert.equal(race.mode, 'projected')
  assert.equal(race.state, 'active')
  assert.ok(race.toWin != null)
})

test('malformed live state falls back to OUTRIGHT instead of inventing a projection', () => {
  const race = calculateSeattleCupRaceStatus(input(CURRENT, (matches) => {
    finalizeThrough(matches, 24)
    setStatus(matches, 25, 'live', 'a-up', null)
  }))
  assert.equal(race.mode, 'outright')
  assert.equal(race.toWin, 23)
  assert.deepEqual(race.projectedPoints, ZERO)
})

test('malformed live match does not suppress projections from supported live matches', () => {
  const supportedOnly = calculateSeattleCupRaceStatus(input(CURRENT, (matches) => {
    finalizeThrough(matches, 24)
    setStatus(matches, 25, 'live', 'a-up', 'A')
  }))
  const mixed = calculateSeattleCupRaceStatus(input(CURRENT, (matches) => {
    finalizeThrough(matches, 24)
    setStatus(matches, 25, 'live', 'a-up', 'A')
    setStatus(matches, 26, 'live', 'a-up', null)
  }))

  assert.equal(mixed.mode, 'projected')
  assert.deepEqual(mixed.projectedPoints, {
    ...ZERO,
    interbay: 1,
  })
  assert.equal(
    mixed.toWin,
    supportedOnly.toWin,
    'unsupported live match remains unresolved just like a scheduled match',
  )
})

test('a trailing team with no legal strict-points path is mathematically eliminated', () => {
  const late: Points = {
    interbay: 24,
    'jackson-park': 18,
    'bill-wright': 15,
    'west-seattle': 1,
  }
  const snapshots = input(late, (matches) => finalizeThrough(matches, 58))
  assert.equal(isTeamEliminatedOnPoints(snapshots, 'west-seattle'), true)
  assert.equal(isTeamEliminatedOnPoints(snapshots, 'interbay'), false)
})

test('leader strictly beyond every opponent maximum is secured on points', () => {
  const late: Points = {
    interbay: 24,
    'jackson-park': 18,
    'bill-wright': 15,
    'west-seattle': 1,
  }
  const race = calculateSeattleCupRaceStatus(input(late, (matches) => finalizeThrough(matches, 58)))
  assert.equal(race.state, 'secured')
  assert.equal(race.toWin, null)
  assert.equal(race.availablePoints, 2)
  assert.deepEqual(race.leaderTeamKeys, ['interbay'])
})

test('final tournament returns no active line and reports the unique points leader', () => {
  const finalPoints: Points = {
    interbay: 24,
    'jackson-park': 20,
    'bill-wright': 15,
    'west-seattle': 1,
  }
  const race = calculateSeattleCupRaceStatus(input(finalPoints, (matches) => finalizeThrough(matches, 60)))
  assert.equal(race.state, 'final')
  assert.equal(race.toWin, null)
  assert.equal(race.availablePoints, 0)
  assert.deepEqual(race.leaderTeamKeys, ['interbay'])
})

test('final points tie is retained without manufacturing a tiebreak winner', () => {
  const tied: Points = {
    interbay: 22.5,
    'jackson-park': 22.5,
    'bill-wright': 10,
    'west-seattle': 5,
  }
  const race = calculateSeattleCupRaceStatus(input(tied, (matches) => finalizeThrough(matches, 60)))
  assert.equal(race.state, 'final')
  assert.equal(race.toWin, null)
  assert.deepEqual(race.leaderTeamKeys, ['interbay', 'jackson-park'])
})
