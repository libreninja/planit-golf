// Pure official Seattle Cup tournament-resolution rules.
//
// Derived: completion, final point leaders, tied teams, two-team head-to-head
// MATCH WINS, and whether a fourball playoff is required. Manual: only the
// winner of a required out-of-band playoff. Golf Genius match points are the
// authoritative win/halve signal; result text, holes, margins, and tee groups
// are intentionally ignored.

import { ROUND_LIST, SEATTLE_CUP_EVENT, TEAM_LIST, TOTAL_TOURNAMENT_POINTS, matchNoFor } from './config.ts'
import type {
  Match,
  SeattleCupRoundSnapshot,
  SeattleCupTournamentResolution,
  TeamKey,
} from './types.ts'

type ResolutionMatch = Pick<Match, 'matchNo' | 'status' | 'teamA' | 'teamB' | 'pointsA' | 'pointsB'>

export interface SeattleCupResolutionInput {
  matches: ResolutionMatch[]
  overallStandings: SeattleCupRoundSnapshot['overallStandings']
  fetchedAt: number
}

export interface SeattleCupPlayoffFact {
  eventKey: string
  tiedTeamKeys: TeamKey[]
  winnerTeamKey: TeamKey
}

const EPSILON = 0.001
const TEAM_KEYS = TEAM_LIST.map((team) => team.key)
const EXPECTED_MATCH_NUMBERS = new Set(
  ROUND_LIST.flatMap((round) => round.matchSlots.map((_, index) => matchNoFor(round.round, index))),
)

function activeResolution(): SeattleCupTournamentResolution {
  return {
    status: 'active',
    tiedTeamKeys: [],
    winnerTeamKey: null,
    method: null,
    headToHeadWins: null,
  }
}

function sameTeamSet(a: TeamKey[], b: TeamKey[]): boolean {
  return a.length === b.length && [...a].sort().every((teamKey, index) => teamKey === [...b].sort()[index])
}

function normalizedMatches(snapshots: SeattleCupResolutionInput[]): ResolutionMatch[] {
  const byMatchNo = new Map<number, ResolutionMatch>()
  for (const snapshot of snapshots) {
    for (const match of snapshot.matches) {
      if (EXPECTED_MATCH_NUMBERS.has(match.matchNo)) byMatchNo.set(match.matchNo, match)
    }
  }
  return [...byMatchNo.values()]
}

function finalStandings(snapshots: SeattleCupResolutionInput[]): SeattleCupResolutionInput['overallStandings'] | null {
  const candidate = [...snapshots]
    .filter((snapshot) => {
      const keys = new Set(snapshot.overallStandings.map((standing) => standing.teamKey))
      return TEAM_KEYS.every((teamKey) => keys.has(teamKey))
    })
    .sort((a, b) => {
      const totalA = a.overallStandings.reduce((sum, standing) => sum + standing.totalPoints, 0)
      const totalB = b.overallStandings.reduce((sum, standing) => sum + standing.totalPoints, 0)
      return totalB - totalA || b.fetchedAt - a.fetchedAt
    })[0]

  if (!candidate) return null
  const pointTotal = candidate.overallStandings.reduce((sum, standing) => sum + standing.totalPoints, 0)
  return Math.abs(pointTotal - TOTAL_TOURNAMENT_POINTS) < EPSILON
    ? candidate.overallStandings
    : null
}

function isCompetitionFinal(matches: ResolutionMatch[]): boolean {
  if (matches.length !== EXPECTED_MATCH_NUMBERS.size) return false
  return matches.every((match) => EXPECTED_MATCH_NUMBERS.has(match.matchNo) && match.status === 'final')
}

function matchHasAuthoritativePoints(match: ResolutionMatch): match is ResolutionMatch & {
  teamA: TeamKey
  teamB: TeamKey
  pointsA: number
  pointsB: number
} {
  return match.teamA != null
    && match.teamB != null
    && match.teamA !== match.teamB
    && match.pointsA != null
    && match.pointsB != null
    && Math.abs(match.pointsA + match.pointsB - 1) < EPSILON
}

function headToHeadMatchWins(
  matches: ResolutionMatch[],
  teamA: TeamKey,
  teamB: TeamKey,
): Partial<Record<TeamKey, number>> | null {
  const relevant = matches.filter((match) =>
    (match.teamA === teamA && match.teamB === teamB)
    || (match.teamA === teamB && match.teamB === teamA),
  )
  if (relevant.length === 0 || relevant.some((match) => !matchHasAuthoritativePoints(match))) return null

  const wins: Partial<Record<TeamKey, number>> = { [teamA]: 0, [teamB]: 0 }
  for (const match of relevant) {
    if (!matchHasAuthoritativePoints(match)) continue
    // A 0.5-0.5 halve is deliberately not a win for either team.
    if (match.pointsA > 0.5) wins[match.teamA] = (wins[match.teamA] ?? 0) + 1
    if (match.pointsB > 0.5) wins[match.teamB] = (wins[match.teamB] ?? 0) + 1
  }
  return wins
}

export function calculateSeattleCupTournamentResolution(
  snapshots: SeattleCupResolutionInput[],
  playoffFact: SeattleCupPlayoffFact | null = null,
): SeattleCupTournamentResolution {
  const matches = normalizedMatches(snapshots)
  const standings = finalStandings(snapshots)
  if (!standings || !isCompetitionFinal(matches)) return activeResolution()

  const highestPoints = Math.max(...standings.map((standing) => standing.totalPoints))
  const tiedTeamKeys = TEAM_KEYS.filter((teamKey) => {
    const standing = standings.find((candidate) => candidate.teamKey === teamKey)
    return standing != null && Math.abs(standing.totalPoints - highestPoints) < EPSILON
  })

  if (tiedTeamKeys.length === 1) {
    return {
      status: 'points-winner',
      tiedTeamKeys: [],
      winnerTeamKey: tiedTeamKeys[0]!,
      method: 'points',
      headToHeadWins: null,
    }
  }

  let headToHeadWins: Partial<Record<TeamKey, number>> | null = null
  if (tiedTeamKeys.length === 2) {
    // If any final match lacks normalized opponents or its authoritative 1-point
    // allocation, Planit cannot prove that the complete between-team history is
    // present. Do not resolve a two-team tiebreak from a partial match graph.
    if (matches.some((match) => !matchHasAuthoritativePoints(match))) return activeResolution()
    const [teamA, teamB] = tiedTeamKeys
    headToHeadWins = headToHeadMatchWins(matches, teamA!, teamB!)
    // Missing/invalid normalized match points cannot be replaced by result text
    // or any other proxy. Stay unresolved until authoritative points exist.
    if (!headToHeadWins) return activeResolution()
    const winsA = headToHeadWins[teamA!] ?? 0
    const winsB = headToHeadWins[teamB!] ?? 0
    if (winsA !== winsB) {
      return {
        status: 'head-to-head-winner',
        tiedTeamKeys,
        winnerTeamKey: winsA > winsB ? teamA! : teamB!,
        method: 'head-to-head-wins',
        headToHeadWins,
      }
    }
  }

  const required: SeattleCupTournamentResolution = {
    status: 'playoff-required',
    tiedTeamKeys,
    winnerTeamKey: null,
    method: 'fourball-playoff',
    headToHeadWins,
  }

  if (!playoffFact
    || playoffFact.eventKey !== SEATTLE_CUP_EVENT.key
    || !sameTeamSet(playoffFact.tiedTeamKeys, tiedTeamKeys)
    || !tiedTeamKeys.includes(playoffFact.winnerTeamKey)) {
    return required
  }

  return {
    ...required,
    status: 'playoff-winner',
    winnerTeamKey: playoffFact.winnerTeamKey,
  }
}

export function validatePlayoffWinner(
  rulesDerivedResolution: SeattleCupTournamentResolution,
  winnerTeamKey: TeamKey,
): void {
  if (rulesDerivedResolution.status !== 'playoff-required') {
    throw new Error('A playoff result can only be recorded when the official rules require a playoff')
  }
  if (!rulesDerivedResolution.tiedTeamKeys.includes(winnerTeamKey)) {
    throw new Error('The playoff winner must be one of the tied teams')
  }
}
