import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildSeattleCup2026Archive,
  SeattleCupArchiveValidationError,
  verifySeattleCup2026Archive,
} from '../lib/seattle-cup/archive.ts'
import { ROUND_LIST, matchNoFor } from '../lib/seattle-cup/config.ts'
import type {
  Match,
  SeattleCupRoundResponse,
  TeamKey,
  TeamStanding,
} from '../lib/seattle-cup/types.ts'

const teams: TeamKey[] = ['interbay', 'jackson-park', 'bill-wright', 'west-seattle']

function matchFor(round: (typeof ROUND_LIST)[number], index: number): Match {
  const slot = round.matchSlots[index]!
  const playerCount = round.format === 'singles' ? 1 : 2
  const player = (side: 'A' | 'B', playerIndex: number) => ({
    ggMemberCardId: `${round.round}-${index}-${side}-${playerIndex}`,
    name: `${side} player ${round.round}-${index}-${playerIndex}`,
    teamKey: side === 'A' ? slot.teamA : slot.teamB,
    courseHandicap: 0,
    handicapDots: [],
    grossScores: [],
    netScores: [],
    identityStatus: 'gg-only' as const,
  })
  return {
    matchNo: matchNoFor(round.round, index),
    round: round.round,
    format: round.format,
    course: round.course,
    teamA: slot.teamA,
    teamB: slot.teamB,
    teamAIdentity: {
      source: 'aggregate-name', pointsSummaryTeamId: null, pointsSummaryTeamKey: null,
      aggregateName: slot.teamA, aggregateNameTeamKey: slot.teamA, affiliation: null,
      affiliationTeamKeys: [], memberTeamKeys: [slot.teamA],
    },
    teamBIdentity: {
      source: 'aggregate-name', pointsSummaryTeamId: null, pointsSummaryTeamKey: null,
      aggregateName: slot.teamB, aggregateNameTeamKey: slot.teamB, affiliation: null,
      affiliationTeamKeys: [], memberTeamKeys: [slot.teamB],
    },
    playersA: Array.from({ length: playerCount }, (_, i) => player('A', i)),
    playersB: Array.from({ length: playerCount }, (_, i) => player('B', i)),
    teeTime: null,
    startingHole: null,
    holes: Array.from({ length: 18 }, (_, i) => ({
      n: i + 1, par: 4, strokeIndex: i + 1, netA: 4, netB: 5,
      grossA: 4, grossB: 5, dotsA: 0, dotsB: 0,
      sourceMatchStatusA: null, sourceMatchStatusB: null, winner: 'A' as const,
    })),
    through: 'final',
    status: 'final',
    matchState: 'final',
    leadSide: 'A',
    leadBy: 1,
    result: '1 up',
    pointsA: 1,
    pointsB: 0,
    sourceResult: '1 up',
    derivedResult: '1 up',
    validationStatus: 'match',
  }
}

function standingsFor(matches: Match[]): TeamStanding[] {
  return teams.map((teamKey) => {
    const teamMatches = matches.filter((match) => match.teamA === teamKey || match.teamB === teamKey)
    const points = teamMatches.reduce((sum, match) =>
      sum + (match.teamA === teamKey ? match.pointsA ?? 0 : match.pointsB ?? 0), 0)
    const wins = teamMatches.filter((match) =>
      match.teamA === teamKey ? match.pointsA! > match.pointsB! : match.pointsB! > match.pointsA!,
    ).length
    return {
      teamKey, roundPoints: points, totalPoints: points,
      matchesPlayed: teamMatches.length, matchesWon: wins, matchesHalved: 0,
      matchesLost: teamMatches.length - wins,
    }
  }).sort((a, b) => b.totalPoints - a.totalPoints)
}

function completeResponses(): SeattleCupRoundResponse[] {
  const perRound = ROUND_LIST.map((round) => round.matchSlots.map((_slot, index) => matchFor(round, index)))
  const allMatches = perRound.flat()
  const overallStandings = standingsFor(allMatches)
  const champion = overallStandings[0]!.teamKey
  return ROUND_LIST.map((round, roundIndex) => ({
    round: round.round,
    format: round.format,
    course: round.course,
    eventName: round.format,
    pairingsPublished: true,
    competitionMatchesAvailable: true,
    scheduledMatchesAvailable: true,
    competitionScopesAvailable: true,
    pairingGroups: [],
    roundStatus: 'final',
    matches: perRound[roundIndex]!,
    roundStandings: standingsFor(perRound[roundIndex]!),
    overallStandings,
    resultStatus: 'final',
    fetchedAt: 1_000 + roundIndex,
    showingLastKnown: false,
    validationIssues: [],
    raceStatus: {
      toWin: null, mode: 'outright', state: 'final', availablePoints: 0,
      leaderTeamKeys: [champion],
      projectedPoints: { interbay: 0, 'jackson-park': 0, 'bill-wright': 0, 'west-seattle': 0 },
    },
    tournamentResolution: {
      status: 'points-winner', winnerTeamKey: champion, tiedTeamKeys: [],
      method: 'points', playoff: null,
    },
  }))
}

test('builds a verifiable immutable envelope for all 60 final matches', () => {
  const archive = buildSeattleCup2026Archive(completeResponses(), {
    archivedAt: '2026-09-01T18:00:00.000Z',
    sourceBaseUrl: 'https://www.planit.golf/',
  })
  assert.equal(archive.content.completeness.matches, 60)
  assert.equal(archive.content.completeness.finalMatches, 60)
  assert.equal(archive.content.completeness.holesPreserved, 1080)
  assert.equal(archive.content.source.baseUrl, 'https://www.planit.golf')
  assert.equal(verifySeattleCup2026Archive(archive), true)
})

test('rejects a partial edition', () => {
  const responses = completeResponses()
  responses[3]!.matches.pop()
  assert.throws(
    () => buildSeattleCup2026Archive(responses, {
      archivedAt: '2026-09-01T18:00:00.000Z', sourceBaseUrl: 'https://www.planit.golf',
    }),
    (error) => error instanceof SeattleCupArchiveValidationError
      && error.issues.some((issue) => issue.includes('expected 24 matches')),
  )
})

test('preserves non-blocking source diagnostics', () => {
  const responses = completeResponses()
  responses[3]!.validationIssues.push({
    matchNo: 49,
    kind: 'published-schedule-mismatch',
    detail: 'final GG lineup replaced the published player',
  })
  const archive = buildSeattleCup2026Archive(responses, {
    archivedAt: '2026-09-01T18:00:00.000Z', sourceBaseUrl: 'https://www.planit.golf',
  })
  assert.equal(archive.content.completeness.sourceDiagnosticCount, 1)
  assert.deepEqual(archive.content.sourceDiagnostics[0], {
    round: 4,
    matchNo: 49,
    kind: 'published-schedule-mismatch',
    detail: 'final GG lineup replaced the published player',
  })
})
