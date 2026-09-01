// Immutable archive envelope for the completed 2026 Seattle Cup. This module is
// intentionally edition-specific: it validates the existing normalized public
// contract without introducing a generic event-history schema.

import { createHash } from 'node:crypto'

import {
  ROUND_LIST,
  SEATTLE_CUP_EVENT_ID,
  SEATTLE_CUP_SEASON_YEAR,
  SEATTLE_CUP_TEAMS,
  TEAM_LIST,
  TOTAL_TOURNAMENT_POINTS,
  matchNoFor,
} from './config.ts'
import type {
  Match,
  RoundNumber,
  SeattleCupRaceStatus,
  SeattleCupRoundResponse,
  SeattleCupRoundSnapshot,
  SeattleCupTournamentResolution,
  TeamKey,
  ValidationIssue,
} from './types.ts'

const EPSILON = 0.001

export interface SeattleCupArchiveSource {
  kind: 'planit-normalized-round-response'
  baseUrl: string
  captures: Array<{
    round: RoundNumber
    endpoint: string
    fetchedAt: number
  }>
}

export interface SeattleCupArchivedPlayer {
  ggMemberCardId: string
  names: string[]
  teamKeys: TeamKey[]
  planitMemberIds: string[]
  ghins: string[]
  appearances: number
}

export interface SeattleCupFinalStanding {
  rank: number
  teamKey: TeamKey
  totalPoints: number
  matchesPlayed: number
  matchesWon: number
  matchesHalved: number
  matchesLost: number
}

export interface SeattleCupArchiveDiagnostic extends ValidationIssue {
  round: RoundNumber
}

export interface SeattleCupArchiveCompleteness {
  rounds: number
  matches: number
  finalMatches: number
  matchesWithAwardedPoints: number
  playerAppearances: number
  playerAppearancesWithGgIdentity: number
  uniquePlayers: number
  holesPreserved: number
  holesWithAnyScore: number
  sourceDiagnosticCount: number
}

export interface SeattleCupEditionArchiveContent {
  archiveId: 'seattle-cup:2026'
  competitionKey: 'seattle-cup'
  seasonYear: 2026
  ggEventId: string
  teams: Array<{ key: TeamKey; label: string }>
  schedule: Array<{
    round: RoundNumber
    format: string
    course: string
    date: string
    ggRoundId: string
    matchNumbers: number[]
  }>
  source: SeattleCupArchiveSource
  rounds: SeattleCupRoundSnapshot[]
  players: SeattleCupArchivedPlayer[]
  finalStandings: SeattleCupFinalStanding[]
  championTeamKey: TeamKey
  raceStatus: SeattleCupRaceStatus
  tournamentResolution: SeattleCupTournamentResolution
  completeness: SeattleCupArchiveCompleteness
  sourceDiagnostics: SeattleCupArchiveDiagnostic[]
}

export interface SeattleCupEditionArchive {
  schemaVersion: 1
  archivedAt: string
  integrity: {
    algorithm: 'sha256'
    contentSha256: string
  }
  content: SeattleCupEditionArchiveContent
}

export class SeattleCupArchiveValidationError extends Error {
  readonly issues: string[]

  constructor(issues: string[]) {
    super(`Seattle Cup 2026 archive is incomplete:\n- ${issues.join('\n- ')}`)
    this.name = 'SeattleCupArchiveValidationError'
    this.issues = issues
  }
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonicalValue(child)]),
    )
  }
  return value
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value))
}

export function seattleCupArchiveContentSha256(content: SeattleCupEditionArchiveContent): string {
  return createHash('sha256').update(canonicalJson(content)).digest('hex')
}

function close(a: number, b: number): boolean {
  return Math.abs(a - b) < EPSILON
}

function hasAnyScore(match: Match): number {
  return match.holes.filter((hole) =>
    hole.netA != null || hole.netB != null || hole.grossA != null || hole.grossB != null,
  ).length
}

function pointsByTeam(matches: Match[]): Map<TeamKey, SeattleCupFinalStanding> {
  const rows = new Map<TeamKey, SeattleCupFinalStanding>()
  for (const team of TEAM_LIST) {
    rows.set(team.key, {
      rank: 0,
      teamKey: team.key,
      totalPoints: 0,
      matchesPlayed: 0,
      matchesWon: 0,
      matchesHalved: 0,
      matchesLost: 0,
    })
  }

  for (const match of matches) {
    if (!match.teamA || !match.teamB || match.pointsA == null || match.pointsB == null) continue
    const a = rows.get(match.teamA)!
    const b = rows.get(match.teamB)!
    a.totalPoints += match.pointsA
    b.totalPoints += match.pointsB
    a.matchesPlayed++
    b.matchesPlayed++
    if (close(match.pointsA, match.pointsB)) {
      a.matchesHalved++
      b.matchesHalved++
    } else if (match.pointsA > match.pointsB) {
      a.matchesWon++
      b.matchesLost++
    } else {
      b.matchesWon++
      a.matchesLost++
    }
  }

  const sorted = [...rows.values()].sort((a, b) =>
    b.totalPoints - a.totalPoints || SEATTLE_CUP_TEAMS[a.teamKey].label.localeCompare(SEATTLE_CUP_TEAMS[b.teamKey].label),
  )
  let previousPoints: number | null = null
  let previousRank = 0
  return new Map(sorted.map((row, index) => {
    const rank = previousPoints != null && close(previousPoints, row.totalPoints) ? previousRank : index + 1
    previousPoints = row.totalPoints
    previousRank = rank
    const ranked = { ...row, rank }
    return [ranked.teamKey, ranked]
  }))
}

function buildPlayerIndex(matches: Match[]): SeattleCupArchivedPlayer[] {
  const players = new Map<string, {
    names: Set<string>
    teamKeys: Set<TeamKey>
    planitMemberIds: Set<string>
    ghins: Set<string>
    appearances: number
  }>()
  for (const match of matches) {
    for (const player of [...match.playersA, ...match.playersB]) {
      if (!player.ggMemberCardId) continue
      const row = players.get(player.ggMemberCardId) ?? {
        names: new Set<string>(), teamKeys: new Set<TeamKey>(),
        planitMemberIds: new Set<string>(), ghins: new Set<string>(), appearances: 0,
      }
      if (player.name) row.names.add(player.name)
      if (player.teamKey) row.teamKeys.add(player.teamKey)
      if (player.planitMemberId) row.planitMemberIds.add(player.planitMemberId)
      if (player.ghin) row.ghins.add(player.ghin)
      row.appearances++
      players.set(player.ggMemberCardId, row)
    }
  }
  return [...players.entries()]
    .map(([ggMemberCardId, row]) => ({
      ggMemberCardId,
      names: [...row.names].sort(),
      teamKeys: [...row.teamKeys].sort(),
      planitMemberIds: [...row.planitMemberIds].sort(),
      ghins: [...row.ghins].sort(),
      appearances: row.appearances,
    }))
    .sort((a, b) => a.ggMemberCardId.localeCompare(b.ggMemberCardId))
}

function validateRound(response: SeattleCupRoundResponse, issues: string[]): void {
  const definition = ROUND_LIST.find((round) => round.round === response.round)
  if (!definition) {
    issues.push(`unexpected round ${response.round}`)
    return
  }
  const label = `round ${response.round}`
  if (response.format !== definition.format) issues.push(`${label}: expected format ${definition.format}, got ${response.format}`)
  if (response.course !== definition.course) issues.push(`${label}: expected course ${definition.course}, got ${response.course}`)
  if (response.resultStatus !== 'final' || response.roundStatus !== 'final') issues.push(`${label}: round is not final`)
  if (response.showingLastKnown) issues.push(`${label}: response is stale/last-known rather than a fresh capture`)
  if (!response.competitionScopesAvailable) issues.push(`${label}: final competitive GG scopes are unavailable`)
  if (response.matches.length !== definition.matchCount) {
    issues.push(`${label}: expected ${definition.matchCount} matches, got ${response.matches.length}`)
  }

  const expectedNumbers = definition.matchSlots.map((_slot, index) => matchNoFor(response.round, index))
  const actualNumbers = response.matches.map((match) => match.matchNo)
  if (canonicalJson(actualNumbers) !== canonicalJson(expectedNumbers)) {
    issues.push(`${label}: match numbers are not the expected contiguous schedule (${expectedNumbers[0]}-${expectedNumbers.at(-1)})`)
  }

  for (const match of response.matches) {
    const matchLabel = `match ${match.matchNo}`
    if (match.round !== response.round) issues.push(`${matchLabel}: round does not match its containing snapshot`)
    if (match.status !== 'final' || match.through !== 'final') issues.push(`${matchLabel}: not final`)
    if (!match.teamA || !match.teamB || match.teamA === match.teamB) issues.push(`${matchLabel}: invalid opponent identity`)
    if (match.pointsA == null || match.pointsB == null || !close((match.pointsA ?? 0) + (match.pointsB ?? 0), 1)) {
      issues.push(`${matchLabel}: missing or invalid awarded points`)
    }
    if (!match.sourceResult || !match.result) issues.push(`${matchLabel}: missing authoritative GG result`)
    const expectedPlayersPerSide = response.format === 'singles' ? 1 : 2
    if (match.playersA.length !== expectedPlayersPerSide || match.playersB.length !== expectedPlayersPerSide) {
      issues.push(`${matchLabel}: expected ${expectedPlayersPerSide} player(s) per side`)
    }
    for (const player of [...match.playersA, ...match.playersB]) {
      if (!player.ggMemberCardId || !player.name || !player.teamKey) {
        issues.push(`${matchLabel}: player identity is incomplete`)
      }
    }
    if (match.holes.length !== 18 || match.holes.some((hole, index) => hole.n !== index + 1)) {
      issues.push(`${matchLabel}: does not preserve an ordered 18-hole card`)
    }
  }
}

export function buildSeattleCup2026Archive(
  responses: SeattleCupRoundResponse[],
  input: { archivedAt: string; sourceBaseUrl: string },
): SeattleCupEditionArchive {
  const issues: string[] = []
  const archivedAtMs = Date.parse(input.archivedAt)
  if (!Number.isFinite(archivedAtMs)) issues.push('archivedAt must be an ISO timestamp')

  const rounds = [...responses].sort((a, b) => a.round - b.round)
  if (rounds.length !== ROUND_LIST.length) issues.push(`expected ${ROUND_LIST.length} round responses, got ${rounds.length}`)
  const roundNumbers = rounds.map((round) => round.round)
  if (canonicalJson(roundNumbers) !== canonicalJson(ROUND_LIST.map((round) => round.round))) {
    issues.push('round responses must contain each of rounds 1-4 exactly once')
  }
  for (const response of rounds) validateRound(response, issues)

  const matches = rounds.flatMap((round) => round.matches)
  const uniqueMatchNumbers = new Set(matches.map((match) => match.matchNo))
  if (matches.length !== 60 || uniqueMatchNumbers.size !== 60) issues.push('archive must contain 60 unique matches')

  const standingsByTeam = pointsByTeam(matches)
  for (const response of rounds) {
    for (const sourceStanding of response.overallStandings) {
      const calculated = standingsByTeam.get(sourceStanding.teamKey)
      if (!calculated || !close(calculated.totalPoints, sourceStanding.totalPoints)) {
        issues.push(`round ${response.round}: cumulative points disagree for ${sourceStanding.teamKey}`)
      }
    }
  }
  const totalAwarded = [...standingsByTeam.values()].reduce((sum, standing) => sum + standing.totalPoints, 0)
  if (!close(totalAwarded, TOTAL_TOURNAMENT_POINTS)) {
    issues.push(`expected ${TOTAL_TOURNAMENT_POINTS} total awarded points, got ${totalAwarded}`)
  }

  const resolutions = rounds.map((round) => canonicalJson(round.tournamentResolution))
  const raceStatuses = rounds.map((round) => canonicalJson(round.raceStatus))
  if (new Set(resolutions).size !== 1) issues.push('round responses disagree on tournamentResolution')
  if (new Set(raceStatuses).size !== 1) issues.push('round responses disagree on raceStatus')
  const tournamentResolution = rounds[0]?.tournamentResolution
  const raceStatus = rounds[0]?.raceStatus
  const championTeamKey = tournamentResolution?.winnerTeamKey
  if (!tournamentResolution || !championTeamKey || tournamentResolution.status === 'active' || tournamentResolution.status === 'playoff-required') {
    issues.push('tournamentResolution does not contain a final champion')
  }
  const calculatedLeader = [...standingsByTeam.values()].sort((a, b) => b.totalPoints - a.totalPoints)[0]?.teamKey
  if (championTeamKey && tournamentResolution?.method === 'points' && championTeamKey !== calculatedLeader) {
    issues.push('points champion disagrees with calculated final standings')
  }
  if (!raceStatus || raceStatus.state !== 'final' || raceStatus.availablePoints !== 0) {
    issues.push('raceStatus is not final with zero available points')
  }
  if (championTeamKey && raceStatus && !raceStatus.leaderTeamKeys.includes(championTeamKey)) {
    issues.push('champion is absent from final race leaders')
  }

  if (issues.length > 0) throw new SeattleCupArchiveValidationError(issues)

  const snapshots = rounds.map((response) => {
    const { raceStatus: _raceStatus, tournamentResolution: _resolution, ...snapshot } = response
    return snapshot
  })
  const players = buildPlayerIndex(matches)
  const sourceDiagnostics = rounds.flatMap((round) =>
    round.validationIssues.map((diagnostic) => ({ ...diagnostic, round: round.round })),
  )
  const finalStandings = [...standingsByTeam.values()].sort((a, b) => a.rank - b.rank)
  const content: SeattleCupEditionArchiveContent = {
    archiveId: 'seattle-cup:2026',
    competitionKey: 'seattle-cup',
    seasonYear: SEATTLE_CUP_SEASON_YEAR,
    ggEventId: SEATTLE_CUP_EVENT_ID,
    teams: TEAM_LIST.map((team) => ({ key: team.key, label: team.label })),
    schedule: ROUND_LIST.map((round) => ({
      round: round.round,
      format: round.format,
      course: round.course,
      date: round.date,
      ggRoundId: round.ggRoundId,
      matchNumbers: round.matchSlots.map((_slot, index) => matchNoFor(round.round, index)),
    })),
    source: {
      kind: 'planit-normalized-round-response',
      baseUrl: input.sourceBaseUrl.replace(/\/$/, ''),
      captures: rounds.map((round) => ({
        round: round.round,
        endpoint: `/api/seattle-cup/live?round=${round.round}`,
        fetchedAt: round.fetchedAt,
      })),
    },
    rounds: snapshots,
    players,
    finalStandings,
    championTeamKey: championTeamKey!,
    raceStatus: raceStatus!,
    tournamentResolution: tournamentResolution!,
    completeness: {
      rounds: snapshots.length,
      matches: matches.length,
      finalMatches: matches.filter((match) => match.status === 'final').length,
      matchesWithAwardedPoints: matches.filter((match) => match.pointsA != null && match.pointsB != null).length,
      playerAppearances: matches.reduce((count, match) => count + match.playersA.length + match.playersB.length, 0),
      playerAppearancesWithGgIdentity: matches.reduce((count, match) =>
        count + [...match.playersA, ...match.playersB].filter((player) => player.ggMemberCardId != null).length, 0),
      uniquePlayers: players.length,
      holesPreserved: matches.reduce((count, match) => count + match.holes.length, 0),
      holesWithAnyScore: matches.reduce((count, match) => count + hasAnyScore(match), 0),
      sourceDiagnosticCount: sourceDiagnostics.length,
    },
    sourceDiagnostics,
  }

  return {
    schemaVersion: 1,
    archivedAt: new Date(archivedAtMs).toISOString(),
    integrity: {
      algorithm: 'sha256',
      contentSha256: seattleCupArchiveContentSha256(content),
    },
    content,
  }
}

export function verifySeattleCup2026Archive(archive: SeattleCupEditionArchive): boolean {
  return archive.schemaVersion === 1
    && archive.integrity.algorithm === 'sha256'
    && archive.integrity.contentSha256 === seattleCupArchiveContentSha256(archive.content)
}
