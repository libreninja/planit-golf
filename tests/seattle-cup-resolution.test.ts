import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  ROUND_LIST,
  SEATTLE_CUP_EVENT_ID,
  TEAM_LIST,
  matchNoFor,
} from '../lib/seattle-cup/config.ts'
import {
  calculateSeattleCupTournamentResolution,
  validatePlayoffResolution,
  type SeattleCupPlayoffRecord,
  type SeattleCupResolutionInput,
  type ResolutionMatch,
} from '../lib/seattle-cup/resolution.ts'
import type { TeamKey } from '../lib/seattle-cup/types.ts'

type Points = Record<TeamKey, number>

const ZERO: Points = {
  interbay: 0,
  'jackson-park': 0,
  'bill-wright': 0,
  'west-seattle': 0,
}

// Production-shaped helpers -------------------------------------------------
//
// Every fixture starts from the REAL 2026 schedule graph (60 matches across
// R1-R4 from config) and awards GG-style points on final matches, exactly the
// shape /api/seattle-cup/live derives from.

function baseSchedule(): ResolutionMatch[] {
  return ROUND_LIST.flatMap((round) => round.matchSlots.map((slot, index) => ({
    matchNo: matchNoFor(round.round, index),
    round: round.round,
    teamA: slot.teamA as TeamKey,
    teamB: slot.teamB as TeamKey,
    status: 'scheduled' as const,
    pointsA: null,
    pointsB: null,
  })))
}

function finalize(matches: ResolutionMatch[], matchNo: number, pa: number, pb: number) {
  const match = matches.find((m) => m.matchNo === matchNo)
  assert.ok(match, `match ${matchNo} exists`)
  match.status = 'final'
  match.pointsA = pa
  match.pointsB = pb
}

// Finish every match, awarding `pa` points to side A in each.
function finalizeAll(matches: ResolutionMatch[], pa: number) {
  for (const match of matches) finalize(matches, match.matchNo, pa, 1 - pa)
}

function pairMatchNos(matches: ResolutionMatch[], a: TeamKey, b: TeamKey): number[] {
  return matches
    .filter((m) => (m.teamA === a && m.teamB === b) || (m.teamA === b && m.teamB === a))
    .map((m) => m.matchNo)
    .sort((x, y) => x - y)
}

// Split the schedule into four per-round snapshots carrying shared standings.
function inputs(matches: ResolutionMatch[], points: Points): SeattleCupResolutionInput[] {
  const standings = TEAM_LIST.map((team) => ({
    teamKey: team.key,
    totalPoints: points[team.key],
    roundPoints: 0,
    matchesPlayed: 0,
    matchesWon: 0,
    matchesHalved: 0,
    matchesLost: 0,
  }))
  return ROUND_LIST.map((round, index) => ({
    matches: matches.filter((m) => m.round === round.round),
    overallStandings: standings,
    fetchedAt: 1000 + index,
  }))
}

// A tournament where every match is final: side A of each match won its point
// (overridden per-match below), and `points` are the authoritative GG totals.
function finalTournament(points: Points, override?: (matches: ResolutionMatch[]) => void) {
  const matches = baseSchedule()
  finalizeAll(matches, 1)
  override?.(matches)
  return inputs(matches, points)
}

function playoffRecord(winnerTeamKey: TeamKey, tiedTeamKeys: TeamKey[]): SeattleCupPlayoffRecord {
  return {
    competitionKey: 'seattle-cup',
    seasonYear: 2026,
    ggEventId: SEATTLE_CUP_EVENT_ID,
    winnerTeamKey,
    tiedTeamKeys,
    notes: 'Sudden-death fourball, first hole',
    resolvedAt: '2026-08-30T20:15:00.000Z',
    resolvedBy: 'admin-user-id',
  }
}

// 1. Competition still active ------------------------------------------------

test('competition still active reports no official winner', () => {
  // Real mid-tournament shape: R1+R2 complete (24 finals), R3 in progress.
  const matches = baseSchedule()
  for (const match of matches) if (match.matchNo <= 24) finalize(matches, match.matchNo, 0.5, 0.5)
  finalize(matches, 25, 1, 0)
  const resolution = calculateSeattleCupTournamentResolution(inputs(matches, {
    ...ZERO, interbay: 7.5, 'jackson-park': 7.5, 'bill-wright': 5.5, 'west-seattle': 3.5,
  }), null)

  assert.equal(resolution.status, 'active')
  assert.equal(resolution.winnerTeamKey, null)
  assert.equal(resolution.method, null)
  assert.deepEqual(resolution.tiedTeamKeys, [])
  assert.equal(resolution.headToHeadWins, undefined)
})

// 2. Final, unique points winner ---------------------------------------------

test('final tournament with a unique points leader resolves by points', () => {
  const resolution = calculateSeattleCupTournamentResolution(finalTournament({
    ...ZERO, interbay: 30, 'jackson-park': 15, 'bill-wright': 10, 'west-seattle': 5,
  }), null)

  assert.equal(resolution.status, 'points-winner')
  assert.equal(resolution.winnerTeamKey, 'interbay')
  assert.equal(resolution.method, 'points')
  assert.deepEqual(resolution.tiedTeamKeys, [])
})

// 3/4. Final, 2-team tie resolved by head-to-head MATCH WINS ------------------

function twoTeamTieFixture(aWins: number, bWins: number, halved: number) {
  // interbay + jackson-park tie on 25.5; every other match went to the loser side.
  const matches = baseSchedule()
  finalizeAll(matches, 1)
  const pair = pairMatchNos(matches, 'interbay', 'jackson-park')
  let i = 0
  for (const matchNo of pair) {
    // Side A of a pair match is always one of the two tied teams; award wins by
    // points from that side's perspective regardless of which team is side A.
    const match = matches.find((m) => m.matchNo === matchNo)!
    const aIsInterbay = match.teamA === 'interbay'
    if (i < aWins) {
      finalize(matches, matchNo, aIsInterbay ? 1 : 0, aIsInterbay ? 0 : 1)
    } else if (i < aWins + bWins) {
      finalize(matches, matchNo, aIsInterbay ? 0 : 1, aIsInterbay ? 1 : 0)
    } else {
      finalize(matches, matchNo, 0.5, 0.5)
    }
    i++
  }
  return inputs(matches, {
    ...ZERO,
    interbay: 25.5,
    'jackson-park': 25.5,
    'bill-wright': 5,
    'west-seattle': 4,
  })
}

test('2-team points tie: more head-to-head match wins makes team A official winner', () => {
  const resolution = calculateSeattleCupTournamentResolution(twoTeamTieFixture(4, 2, 0), null)

  assert.equal(resolution.status, 'head-to-head-winner')
  assert.equal(resolution.winnerTeamKey, 'interbay')
  assert.equal(resolution.method, 'head-to-head-wins')
  assert.deepEqual(resolution.tiedTeamKeys.sort(), ['interbay', 'jackson-park'])
  assert.deepEqual(resolution.headToHeadWins, { interbay: 4, 'jackson-park': 2 })
})

test('2-team points tie: more head-to-head match wins makes team B official winner', () => {
  const resolution = calculateSeattleCupTournamentResolution(twoTeamTieFixture(2, 4, 0), null)

  assert.equal(resolution.status, 'head-to-head-winner')
  assert.equal(resolution.winnerTeamKey, 'jackson-park')
  assert.equal(resolution.method, 'head-to-head-wins')
  assert.deepEqual(resolution.headToHeadWins, { interbay: 2, 'jackson-park': 4 })
})

// 5/6. Equal head-to-head wins (halves count as a win for NEITHER) -------------

test('2-team points tie with equal head-to-head wins requires the fourball playoff', () => {
  // The pair's edge in the real graph is odd-sized, so include one halved match:
  // equal wins + 1 halve. The halve must contribute 0 wins to either team.
  const resolution = calculateSeattleCupTournamentResolution(twoTeamTieFixture(3, 3, 1), null)

  assert.equal(resolution.status, 'playoff-required')
  assert.equal(resolution.winnerTeamKey, null)
  assert.equal(resolution.method, null)
  assert.deepEqual(resolution.headToHeadWins, { interbay: 3, 'jackson-park': 3 })
  assert.deepEqual(resolution.tiedTeamKeys.sort(), ['interbay', 'jackson-park'])
  assert.ok(resolution.playoff?.required)
  assert.equal(resolution.playoff?.resolved, false)
})

test('a halved head-to-head match counts as a win for neither team', () => {
  // 1 win each + 3 halves → equal on wins (1-1), not on points-in-matches.
  const resolution = calculateSeattleCupTournamentResolution(twoTeamTieFixture(1, 1, 3), null)

  assert.equal(resolution.status, 'playoff-required')
  assert.deepEqual(resolution.headToHeadWins, { interbay: 1, 'jackson-park': 1 })
})

// 7/8. 3- and 4-team ties go straight to the playoff ---------------------------

test('3-team points tie goes directly to the playoff without pairwise elimination', () => {
  // interbay swept jackson-park head-to-head, but a 3-team tie must NOT resolve
  // pairwise — playoff required immediately.
  const resolution = calculateSeattleCupTournamentResolution(finalTournament({
    ...ZERO, interbay: 19, 'jackson-park': 19, 'bill-wright': 19, 'west-seattle': 3,
  }, (matches) => {
    for (const matchNo of pairMatchNos(matches, 'interbay', 'jackson-park')) {
      const match = matches.find((m) => m.matchNo === matchNo)!
      const aIsInterbay = match.teamA === 'interbay'
      finalize(matches, matchNo, aIsInterbay ? 1 : 0, aIsInterbay ? 0 : 1)
    }
  }), null)

  assert.equal(resolution.status, 'playoff-required')
  assert.equal(resolution.winnerTeamKey, null)
  assert.equal(resolution.method, null)
  assert.deepEqual(resolution.tiedTeamKeys.sort(), ['bill-wright', 'interbay', 'jackson-park'])
  assert.equal(resolution.headToHeadWins, undefined)
})

test('4-team points tie goes directly to the playoff', () => {
  const resolution = calculateSeattleCupTournamentResolution(finalTournament({
    ...ZERO, interbay: 15, 'jackson-park': 15, 'bill-wright': 15, 'west-seattle': 15,
  }), null)

  assert.equal(resolution.status, 'playoff-required')
  assert.deepEqual(resolution.tiedTeamKeys.sort(), ['bill-wright', 'interbay', 'jackson-park', 'west-seattle'])
  assert.equal(resolution.headToHeadWins, undefined)
})

// 9. Valid manual playoff winner ------------------------------------------------

test('a recorded playoff winner is exposed as the official Cup winner', () => {
  const base = calculateSeattleCupTournamentResolution(twoTeamTieFixture(3, 3, 1), null)
  assert.equal(base.status, 'playoff-required')

  const resolution = calculateSeattleCupTournamentResolution(
    twoTeamTieFixture(3, 3, 1),
    playoffRecord('interbay', ['interbay', 'jackson-park']),
  )

  assert.equal(resolution.status, 'playoff-winner')
  assert.equal(resolution.winnerTeamKey, 'interbay')
  assert.equal(resolution.method, 'fourball-playoff')
  assert.ok(resolution.playoff?.resolved)
  assert.equal(resolution.playoff?.notes, 'Sudden-death fourball, first hole')
})

// 12. Unresolved playoff → winner stays null -------------------------------------

test('unresolved playoff keeps the winner null (never fabricated)', () => {
  const resolution = calculateSeattleCupTournamentResolution(twoTeamTieFixture(3, 3, 1), null)

  assert.equal(resolution.status, 'playoff-required')
  assert.equal(resolution.winnerTeamKey, null)
})

// Manual recording validation ----------------------------------------------------

test('valid manual playoff result is accepted', () => {
  const resolution = calculateSeattleCupTournamentResolution(twoTeamTieFixture(3, 3, 1), null)
  const verdict = validatePlayoffResolution(resolution, 'jackson-park')

  assert.ok(verdict.ok)
  assert.equal(verdict.winnerTeamKey, 'jackson-park')
  assert.deepEqual(verdict.tiedTeamKeys.sort(), ['interbay', 'jackson-park'])
})

test('recording a playoff winner is rejected while the competition is active', () => {
  const matches = baseSchedule()
  for (const match of matches) if (match.matchNo <= 24) finalize(matches, match.matchNo, 1, 0)
  const resolution = calculateSeattleCupTournamentResolution(inputs(matches, {
    ...ZERO, interbay: 12, 'jackson-park': 6, 'bill-wright': 4, 'west-seattle': 2,
  }), null)
  const verdict = validatePlayoffResolution(resolution, 'interbay')

  assert.equal(verdict.ok, false)
  assert.match(!verdict.ok ? verdict.error : '', /final/i)
})

test('recording a playoff is rejected when a unique points winner exists', () => {
  const resolution = calculateSeattleCupTournamentResolution(finalTournament({
    ...ZERO, interbay: 30, 'jackson-park': 15, 'bill-wright': 10, 'west-seattle': 5,
  }), null)
  const verdict = validatePlayoffResolution(resolution, 'interbay')

  assert.equal(verdict.ok, false)
  assert.match(!verdict.ok ? verdict.error : '', /no tiebreak/i)
})

test('recording a playoff is rejected when the 2-team tie was resolved head-to-head', () => {
  const resolution = calculateSeattleCupTournamentResolution(twoTeamTieFixture(4, 2, 0), null)
  const verdict = validatePlayoffResolution(resolution, 'interbay')

  assert.equal(verdict.ok, false)
  assert.match(!verdict.ok ? verdict.error : '', /no tiebreak|head-to-head/i)
})

test('recording a winner outside the tied teams is rejected', () => {
  const resolution = calculateSeattleCupTournamentResolution(twoTeamTieFixture(3, 3, 1), null)
  const verdict = validatePlayoffResolution(resolution, 'bill-wright')

  assert.equal(verdict.ok, false)
  assert.match(!verdict.ok ? verdict.error : '', /tied teams/i)
})

test('a stored playoff record cannot fabricate a winner while the tournament is active', () => {
  const matches = baseSchedule()
  for (const match of matches) if (match.matchNo <= 24) finalize(matches, match.matchNo, 1, 0)
  const resolution = calculateSeattleCupTournamentResolution(
    inputs(matches, { ...ZERO, interbay: 12, 'jackson-park': 6, 'bill-wright': 4, 'west-seattle': 2 }),
    playoffRecord('interbay', ['interbay', 'jackson-park']),
  )

  assert.equal(resolution.status, 'active')
  assert.equal(resolution.winnerTeamKey, null)
})

// 13. R4 Singles are 24 independent 1v1 matches on the real graph -----------------

test('head-to-head wins use the real asymmetric match graph, Singles as 24 independent matches', () => {
  // Production pair-edge counts from the real 2026 config graph. The graph is
  // asymmetric: R3+R4 pair edges are 7,7,6,6,5,5; singles-only (R4) are
  // 5,5,4,4,3,3; the full tournament is 11,11,10,10,9,9.
  const matches = baseSchedule()
  function edgeCounts(ms: ResolutionMatch[]): number[] {
    const edges = new Map<string, number>()
    for (const match of ms) {
      const key = [match.teamA, match.teamB].sort().join('|')
      edges.set(key, (edges.get(key) ?? 0) + 1)
    }
    return [...edges.values()].sort((a, b) => b - a)
  }
  assert.deepEqual(edgeCounts(matches), [11, 11, 10, 10, 9, 9])
  assert.deepEqual(edgeCounts(matches.filter((m) => m.round === 3 || m.round === 4)), [7, 7, 6, 6, 5, 5])
  assert.deepEqual(edgeCounts(matches.filter((m) => m.round === 4)), [5, 5, 4, 4, 3, 3])

  // R4 contributes exactly 24 independent 1v1 matches — one per published
  // singles pairing, never one per tee-sheet foursome (which would be 12).
  assert.equal(matches.filter((m) => m.round === 4).length, 24)

  // Head-to-head wins between a tied pair are counted per 1v1 match: with the
  // pair's full edge of 7 matches split 4-3, four independent singles/paired
  // wins resolve the tie — no aggregate or holes-won arithmetic involved.
  const resolution = calculateSeattleCupTournamentResolution(twoTeamTieFixture(4, 3, 0), null)
  assert.equal(resolution.status, 'head-to-head-winner')
  assert.equal(resolution.winnerTeamKey, 'interbay')
  assert.deepEqual(resolution.headToHeadWins, { interbay: 4, 'jackson-park': 3 })
})