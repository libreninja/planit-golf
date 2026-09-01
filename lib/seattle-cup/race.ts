// Pure Seattle Cup race-state calculation.
//
// OUTRIGHT invariant: among every legal allocation of the unresolved matches,
// find the greatest final score that can be held by the runner-up. The shared
// TO WIN line is one half-point above that ceiling, so reaching it guarantees a
// strict points win without invoking the Seattle Cup tiebreak rules.
//
// PROJECTED uses the same invariant after provisionally holding every supported
// live match at its current normalized match-play state (leader 1-0, all-square
// 0.5-0.5). Scheduled and unsupported live matches remain mathematically
// unresolved. This is a current-state projection, not a forecast.

import {
  MAX_TEAM_POINTS,
  ROUND_LIST,
  TEAM_LIST,
  TOTAL_TOURNAMENT_POINTS,
  matchNoFor,
} from './config.ts'
import type {
  Match,
  SeattleCupRaceStatus,
  SeattleCupRoundSnapshot,
  TeamKey,
} from './types.ts'

type RaceMatch = Pick<Match, 'matchNo' | 'teamA' | 'teamB' | 'status' | 'matchState' | 'leadSide'>
type ScoreMap = Record<TeamKey, number>

export interface SeattleCupRaceInput {
  matches: RaceMatch[]
  overallStandings: SeattleCupRoundSnapshot['overallStandings']
  fetchedAt: number
}

interface PreparedRace {
  confirmed: ScoreMap
  matches: RaceMatch[]
  availablePoints: number
  leaderTeamKeys: TeamKey[]
}

const TEAM_KEYS = TEAM_LIST.map((team) => team.key)
const HALF_POINT_TICKS = 2
const EPSILON = 0.001

function emptyScores(): ScoreMap {
  return {
    interbay: 0,
    'jackson-park': 0,
    'bill-wright': 0,
    'west-seattle': 0,
  }
}

function toTicks(points: number): number {
  return Math.round(points * HALF_POINT_TICKS)
}

function fromTicks(ticks: number): number {
  return ticks / HALF_POINT_TICKS
}

function pairKey(a: TeamKey, b: TeamKey): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

function validOpponents(match: Pick<RaceMatch, 'teamA' | 'teamB'>): match is RaceMatch & { teamA: TeamKey; teamB: TeamKey } {
  return match.teamA != null && match.teamB != null && match.teamA !== match.teamB
}

function scheduleMatches(): RaceMatch[] {
  return ROUND_LIST.flatMap((round) => round.matchSlots.map((slot, index) => ({
    matchNo: matchNoFor(round.round, index),
    teamA: slot.teamA,
    teamB: slot.teamB,
    status: 'scheduled' as const,
    matchState: 'tbd' as const,
    leadSide: null,
  })))
}

function prepareRace(snapshots: SeattleCupRaceInput[]): PreparedRace {
  const standingsSnapshot = [...snapshots]
    .filter((snapshot) => snapshot.overallStandings.length > 0)
    .sort((a, b) => {
      const aTotal = a.overallStandings.reduce((sum, standing) => sum + standing.totalPoints, 0)
      const bTotal = b.overallStandings.reduce((sum, standing) => sum + standing.totalPoints, 0)
      return bTotal - aTotal || b.fetchedAt - a.fetchedAt
    })[0]

  const confirmed = emptyScores()
  for (const standing of standingsSnapshot?.overallStandings ?? []) {
    confirmed[standing.teamKey] = Number.isFinite(standing.totalPoints)
      ? Math.max(0, standing.totalPoints)
      : 0
  }

  const actualByMatchNo = new Map<number, RaceMatch>()
  for (const snapshot of snapshots) {
    for (const match of snapshot.matches) actualByMatchNo.set(match.matchNo, match)
  }

  // Normalized actual opponents win. The stable Planit schedule is used only
  // for an absent/malformed pair so a partial GG scope cannot erase point
  // capacity or create a same-team edge.
  const matches = scheduleMatches().map((scheduled) => {
    const actual = actualByMatchNo.get(scheduled.matchNo)
    if (!actual) return scheduled
    return {
      ...actual,
      teamA: validOpponents(actual) ? actual.teamA : scheduled.teamA,
      teamB: validOpponents(actual) ? actual.teamB : scheduled.teamB,
    }
  })

  const confirmedTotal = TEAM_KEYS.reduce((sum, teamKey) => sum + confirmed[teamKey], 0)
  const availablePoints = Math.max(0, TOTAL_TOURNAMENT_POINTS - confirmedTotal)
  const lead = Math.max(...TEAM_KEYS.map((teamKey) => confirmed[teamKey]))
  const leaderTeamKeys = TEAM_KEYS.filter((teamKey) => Math.abs(confirmed[teamKey] - lead) < EPSILON)

  return { confirmed, matches, availablePoints, leaderTeamKeys }
}

function isSupportedLiveState(match: RaceMatch): boolean {
  if (match.status !== 'live') return false
  if (match.matchState === 'all-square') return match.leadSide === null
  if (match.leadSide === 'A') return match.matchState === 'a-up' || match.matchState === 'dormie'
  if (match.leadSide === 'B') return match.matchState === 'b-up' || match.matchState === 'dormie'
  return false
}

function edgeCounts(matches: RaceMatch[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const match of matches) {
    if (!validOpponents(match)) continue
    const key = pairKey(match.teamA, match.teamB)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

function incidentMatches(counts: Map<string, number>, team: TeamKey, except?: TeamKey): number {
  return TEAM_KEYS.reduce((total, opponent) => {
    if (opponent === team || opponent === except) return total
    return total + (counts.get(pairKey(team, opponent)) ?? 0)
  }, 0)
}

function runnerUpCeiling(base: ScoreMap, unresolved: RaceMatch[]): number {
  const counts = edgeCounts(unresolved)
  const ticks = Object.fromEntries(
    TEAM_KEYS.map((teamKey) => [teamKey, toTicks(base[teamKey])]),
  ) as ScoreMap
  let ceilingTicks = 0

  for (let i = 0; i < TEAM_KEYS.length; i++) {
    for (let j = i + 1; j < TEAM_KEYS.length; j++) {
      const a = TEAM_KEYS[i]!
      const b = TEAM_KEYS[j]!
      const sharedMatches = counts.get(pairKey(a, b)) ?? 0
      const aExclusive = ticks[a] + HALF_POINT_TICKS * incidentMatches(counts, a, b)
      const bExclusive = ticks[b] + HALF_POINT_TICKS * incidentMatches(counts, b, a)

      // Across N one-point head-to-head matches, every aggregate half-point
      // allocation from 0 through N is attainable.
      for (let aSharedTicks = 0; aSharedTicks <= HALF_POINT_TICKS * sharedMatches; aSharedTicks++) {
        const bSharedTicks = HALF_POINT_TICKS * sharedMatches - aSharedTicks
        ceilingTicks = Math.max(
          ceilingTicks,
          Math.min(aExclusive + aSharedTicks, bExclusive + bSharedTicks),
        )
      }
    }
  }

  return fromTicks(ceilingTicks)
}

function possibleMaximums(confirmed: ScoreMap, unresolved: RaceMatch[]): ScoreMap {
  const counts = edgeCounts(unresolved)
  const out = emptyScores()
  for (const teamKey of TEAM_KEYS) {
    out[teamKey] = confirmed[teamKey] + incidentMatches(counts, teamKey)
  }
  return out
}

function securedLeader(prepared: PreparedRace, possibleUnresolved: RaceMatch[]): TeamKey | null {
  if (prepared.leaderTeamKeys.length !== 1) return null
  const leader = prepared.leaderTeamKeys[0]!
  const maximums = possibleMaximums(prepared.confirmed, possibleUnresolved)
  return TEAM_KEYS.every((opponent) =>
    opponent === leader || prepared.confirmed[leader] > maximums[opponent] + EPSILON,
  ) ? leader : null
}

export function calculateSeattleCupRaceStatus(snapshots: SeattleCupRaceInput[]): SeattleCupRaceStatus {
  const prepared = prepareRace(snapshots)
  const nonFinal = prepared.matches.filter((match) => match.status !== 'final')
  const live = nonFinal.filter((match) => match.status === 'live')
  const supportedLive = live.filter(isSupportedLiveState)
  const canProject = supportedLive.length > 0
  const mode = canProject ? 'projected' : 'outright'
  const allMatchesFinal = prepared.matches.every((match) => match.status === 'final')
  const projectedPoints = emptyScores()
  if (canProject) {
    for (const match of supportedLive) {
      if (!validOpponents(match)) continue
      if (match.matchState === 'all-square') {
        projectedPoints[match.teamA] += 0.5
        projectedPoints[match.teamB] += 0.5
      } else if (match.leadSide === 'A') {
        projectedPoints[match.teamA] += 1
      } else if (match.leadSide === 'B') {
        projectedPoints[match.teamB] += 1
      }
    }
  }

  if (allMatchesFinal || prepared.availablePoints < EPSILON) {
    return {
      toWin: null,
      mode,
      state: 'final',
      availablePoints: prepared.availablePoints,
      leaderTeamKeys: prepared.leaderTeamKeys,
      projectedPoints,
    }
  }

  if (securedLeader(prepared, nonFinal)) {
    return {
      toWin: null,
      mode,
      state: 'secured',
      availablePoints: prepared.availablePoints,
      leaderTeamKeys: prepared.leaderTeamKeys,
      projectedPoints,
    }
  }

  const base = { ...prepared.confirmed }
  let unresolved = nonFinal
  if (canProject) {
    for (const teamKey of TEAM_KEYS) base[teamKey] += projectedPoints[teamKey]
    unresolved = nonFinal.filter((match) => !isSupportedLiveState(match))
  }

  return {
    toWin: runnerUpCeiling(base, unresolved) + 0.5,
    mode,
    state: 'active',
    availablePoints: prepared.availablePoints,
    leaderTeamKeys: prepared.leaderTeamKeys,
    projectedPoints,
  }
}

// Exact strict-points elimination check used by focused race tests. Tiebreaks
// are intentionally outside this model. If a team can win outright in any
// legal completion, moving every one of its own unresolved matches fully to it
// preserves that win; only the three opponents' mutual edges then need search.
export function isTeamEliminatedOnPoints(snapshots: SeattleCupRaceInput[], team: TeamKey): boolean {
  const prepared = prepareRace(snapshots)
  const unresolved = prepared.matches.filter((match) => match.status !== 'final')
  const counts = edgeCounts(unresolved)
  const targetTicks = toTicks(prepared.confirmed[team])
    + HALF_POINT_TICKS * incidentMatches(counts, team)
  const rivals = TEAM_KEYS.filter((teamKey) => teamKey !== team)
  const rivalTicks = Object.fromEntries(
    rivals.map((teamKey) => [teamKey, toTicks(prepared.confirmed[teamKey])]),
  ) as Record<TeamKey, number>
  const rivalEdges: Array<[TeamKey, TeamKey, number]> = []
  for (let i = 0; i < rivals.length; i++) {
    for (let j = i + 1; j < rivals.length; j++) {
      const a = rivals[i]!
      const b = rivals[j]!
      rivalEdges.push([a, b, counts.get(pairKey(a, b)) ?? 0])
    }
  }

  function canAllocate(edgeIndex: number): boolean {
    if (edgeIndex === rivalEdges.length) {
      return rivals.every((rival) => rivalTicks[rival] < targetTicks)
    }
    const [a, b, matches] = rivalEdges[edgeIndex]!
    for (let aTicks = 0; aTicks <= HALF_POINT_TICKS * matches; aTicks++) {
      const bTicks = HALF_POINT_TICKS * matches - aTicks
      rivalTicks[a] += aTicks
      rivalTicks[b] += bTicks
      const possible = canAllocate(edgeIndex + 1)
      rivalTicks[a] -= aTicks
      rivalTicks[b] -= bTicks
      if (possible) return true
    }
    return false
  }

  return !canAllocate(0)
}

export const SEATTLE_CUP_RACE_INVARIANTS = {
  totalTournamentPoints: TOTAL_TOURNAMENT_POINTS,
  maximumTeamPoints: MAX_TEAM_POINTS,
  scoringIncrement: 0.5,
} as const
