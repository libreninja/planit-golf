// Seattle Cup R1 normalizer + live orchestration tests. Drives the REAL
// pipeline (fetchRoundRaw → normalizeRound → enrichIdentities → getSeattleCupLive)
// with a fake GG client that replays the saved 2025 fixtures — no network. This
// is the record/replay harness: the same code path production runs, fed fixture
// data. Covers the locked R1 test list from the directive.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { fetchRoundRaw, pickFormatTournamentId, type GGClient } from '../lib/seattle-cup/gg-fetch.ts'
import { normalizeRound, normalizeSourceResult } from '../lib/seattle-cup/normalize.ts'
import { getSeattleCupLive } from '../lib/seattle-cup/live.ts'
import { makeMemorySeattleCupStore } from '../lib/seattle-cup/cache.ts'
import { OFFICIAL_2026_SINGLES_MATCH_SCHEDULE, ROUND_LIST, SEATTLE_CUP_ROUNDS, SEATTLE_CUP_TEAMS } from '../lib/seattle-cup/config.ts'
import { calculateSeattleCupRaceStatus } from '../lib/seattle-cup/race.ts'
import { calculateSeattleCupTournamentResolution } from '../lib/seattle-cup/resolution.ts'
import { identitySummary } from '../lib/seattle-cup/identity.ts'
import type { SeattleCupRoundSnapshot, Match, RoundNumber } from '../lib/seattle-cup/types.ts'

const FIX = path.join(process.cwd(), 'fixtures', 'seattle-cup', 'raw')
const readFix = (f: string) => JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf8'))

// Build a fake GG client that replays saved fixtures for the Fourball round.
// Endpoint pattern-matched (the real 2026 ggEventId/ggRoundId in the URLs are
// irrelevant to the replay — only the suffix matters).
function makeFakeFourballClient(opts: { throwOnJson?: boolean; reverseIndividualResults?: boolean } = {}): GGClient {
  const tournamentPayload = readFix('tournament_2025_Fourball.json')
  if (opts.reverseIndividualResults) {
    for (const scope of tournamentPayload.event.scopes) {
      for (const aggregate of scope.aggregates ?? []) {
        if (aggregate.individual_results) aggregate.individual_results.reverse()
      }
    }
  }
  const teeSheet = readFix('tee_sheet_2025_Fourball.json')
  return async (endpoint: string) => {
    if (opts.throwOnJson && endpoint.includes('/tournaments/') && endpoint.endsWith('.json')) throw new Error('upstream down')
    if (endpoint.includes('/tournaments/') && endpoint.endsWith('.json')) return tournamentPayload
    if (endpoint.endsWith('/tournaments')) {
      return [{ event: { id: 'fb-tid', name: 'Fourball', result_scope: 'rs_pos_group' } },
              { event: { id: 'field-tid', name: 'Seattle Cup 2026', result_scope: 'rs_field' } }]
    }
    if (endpoint.endsWith('/tee_sheet')) return teeSheet
    if (endpoint.endsWith('/team_points')) return { teams: buildTeamPointsFromScopes(tournamentPayload.event.scopes) }
    if (endpoint.endsWith(`/rounds/${SEATTLE_CUP_ROUNDS[1].ggRoundId}`)) return { round: { date: '2025-08-16', name: 'Fourball' } }
    return null
  }
}

function makeFake2026CompetitiveClient(format: 'Fourball' | 'Scramble'): GGClient {
  const tournamentPayload = readFix(`tournament_2026_${format}.json`)
  const teeSheet = readFix(`tee_sheet_2026_${format}.json`)
  // Saved from the corresponding production team_points response. Keeping the
  // id→name mapping independent of aggregate.name makes this a real regression
  // for points_summary_team_id resolution rather than a circular fixture join.
  const teamPoints = format === 'Fourball' ? [
    { id: 12980046313629444000, name: 'Bill Wright', round_points: 3, total_points: 3 },
    { id: 12980046317588867000, name: 'West Seattle', round_points: 1.5, total_points: 1.5 },
    { id: 12980046316313799000, name: 'Jackson Park', round_points: 4.5, total_points: 4.5 },
    { id: 12980046315005176000, name: 'Interbay', round_points: 3, total_points: 3 },
  ] : [
    { id: 12980046329198700000, name: 'Bill Wright', round_points: 2.5, total_points: 5.5 },
    { id: 12980046333393005000, name: 'West Seattle', round_points: 2, total_points: 3.5 },
    { id: 12980046332050827000, name: 'Jackson Park', round_points: 3, total_points: 7.5 },
    { id: 12980046330742204000, name: 'Interbay', round_points: 4.5, total_points: 7.5 },
  ]
  return async (endpoint: string) => {
    if (endpoint.includes('/tournaments/') && endpoint.endsWith('.json')) return tournamentPayload
    if (endpoint.endsWith('/tournaments')) {
      return [{ event: { id: `${format.toLowerCase()}-2026`, name: format, result_scope: 'rs_pos_group' } }]
    }
    if (endpoint.endsWith('/tee_sheet')) return teeSheet
    if (endpoint.endsWith('/team_points')) return { teams: teamPoints }
    return { round: { date: format === 'Fourball' ? '2026-08-22' : '2026-08-23', name: format } }
  }
}

// Sum per-team awarded points from scope aggregates → a team_points payload.
function buildTeamPointsFromScopes(scopes: any[], mismatch = false): any[] {
  const byTeam: Record<string, { id: unknown; points: number }> = {}
  for (const s of scopes) {
    for (const a of s.aggregates ?? []) {
      const team = (a.name ?? '').split('(')[0].trim()
      const current = byTeam[team] ?? { id: a.points_summary_team_id ?? null, points: 0 }
      current.points += Number(a.points ?? 0)
      byTeam[team] = current
    }
  }
  return Object.entries(byTeam).map(([name, team]) => ({
    id: team.id,
    name,
    round_points: team.points + (mismatch ? 1 : 0),
    total_points: team.points + (mismatch ? 1 : 0),
  }))
}

function makeSnapshot(round: number, client: GGClient): Promise<SeattleCupRoundSnapshot> {
  return (async () => {
    const raw = await fetchRoundRaw({ round: round as RoundNumber, ggClient: client })
    const { snapshot } = normalizeRound(round as RoundNumber, raw)
    return { ...snapshot, fetchedAt: 0, showingLastKnown: false }
  })()
}

function teePlayer(name: string, teamName: string, id: string) {
  return { name, team_name: teamName, member_card_id: id, score_array: [] }
}

function makePairingGroup(index: number, players: ReturnType<typeof teePlayer>[], hole: number | string = 1) {
  return { pairing_group: { tee_time: ` ${8 + Math.floor(index / 6)}:${String((index % 6) * 10).padStart(2, '0')} AM`, hole, date: '2026-08-29', players } }
}

function makePreplayClient(format: 'Chapman' | 'Singles', teeSheet: any[], scopes: any[] = []): GGClient {
  return async (endpoint) => {
    if (endpoint.includes('/tournaments/') && endpoint.endsWith('.json')) return { event: { name: format, scopes } }
    if (endpoint.endsWith('/tournaments')) {
      return [
        { event: { id: `${format.toLowerCase()}-tid`, name: format, result_scope: format === 'Singles' ? 'rs_pos_partners' : 'rs_pos_group' } },
        { event: { id: 'field-tid', name: 'Seattle Cup 2026', result_scope: 'rs_field' } },
      ]
    }
    if (endpoint.endsWith('/tee_sheet')) return teeSheet
    if (endpoint.endsWith('/team_points')) return { teams: [] }
    return { round: { date: format === 'Chapman' ? '2026-08-29' : '2026-08-30', name: format } }
  }
}

function makeOfficialSinglesTeeGroups(): any[] {
  // Deliberately put four players from four different official matches into
  // each logistical group. If normalization ever treats a foursome as a match,
  // the representative opponent assertions below will fail.
  const players = [
    ...OFFICIAL_2026_SINGLES_MATCH_SCHEDULE.map((match) => ({ match, side: 'a' as const, player: match.playerA })),
    ...OFFICIAL_2026_SINGLES_MATCH_SCHEDULE.map((match) => ({ match, side: 'b' as const, player: match.playerB })),
  ].map(({ match, side, player }) => teePlayer(
    player.name,
    SEATTLE_CUP_TEAMS[player.teamKey].label,
    player.ggMemberCardId ?? `official-${match.matchNo}-${side}`,
  ))
  return Array.from({ length: 12 }, (_, index) => makePairingGroup(
    index,
    players.slice(index * 4, index * 4 + 4),
    index === 0 ? '1A' : index + 1,
  ))
}

// ---------------- 2026 pre-play (TBD) ----------------
test('2026 empty/pre-play GG state produces exactly 12 scheduled Fourball slots with TBD players', async () => {
  // No tournaments, no scopes, no tee sheet, empty team_points → pre-play.
  const client: GGClient = async (endpoint) => {
    if (endpoint.endsWith('/tournaments')) return [{ event: { id: 'fb-tid', name: 'Fourball', result_scope: 'rs_pos_group' } }]  // list exists
    if (endpoint.includes('/tournaments/') && endpoint.endsWith('.json')) return { event: { scopes: [] } }   // 0 scopes
    if (endpoint.endsWith('/tee_sheet')) return []   // no pairings
    if (endpoint.endsWith('/team_points')) return { teams: [] }
    return { round: { date: null, name: 'Fourball' } }
  }
  const snap = await makeSnapshot(1, client)
  assert.equal(snap.matches.length, 12, 'exactly 12 Fourball slots')
  assert.equal(snap.resultStatus, 'not-started')
  for (const m of snap.matches) {
    assert.equal(m.status, 'scheduled')
    assert.equal(m.matchState, 'tbd')
    assert.equal(m.through, 'not-started')
    assert.equal(m.playersA.length, 0, 'no placeholder golfer becomes a real pairing')
    assert.equal(m.playersB.length, 0)
    assert.equal(m.pointsA, null)
    assert.equal(m.pointsB, null)
    assert.equal(m.result, null)
  }
})

test('pre-play slots use the correct team-vs-team schedule ordering', async () => {
  const client: GGClient = async (endpoint) => {
    if (endpoint.endsWith('/tournaments')) return [{ event: { id: 'fb-tid', name: 'Fourball', result_scope: 'rs_pos_group' } }]
    if (endpoint.includes('/tournaments/') && endpoint.endsWith('.json')) return { event: { scopes: [] } }
    if (endpoint.endsWith('/tee_sheet')) return []
    if (endpoint.endsWith('/team_points')) return { teams: [] }
    return { round: { date: null } }
  }
  const snap = await makeSnapshot(1, client)
  const pairs = snap.matches.map((m) => `${m.teamA} vs ${m.teamB}`)
  assert.deepEqual(pairs[0], 'jackson-park vs interbay')
  assert.deepEqual(pairs[1], 'bill-wright vs jackson-park')
  assert.deepEqual(pairs[3], 'west-seattle vs interbay')
  assert.deepEqual(pairs[11], 'west-seattle vs bill-wright')
  // matchNo schedule-stable: R1 = 1..12
  assert.equal(snap.matches[0].matchNo, 1)
  assert.equal(snap.matches[11].matchNo, 12)
})

test('2026 GG mapping and format tournament selection use round ids/tournaments, never workbook ids', () => {
  assert.equal(SEATTLE_CUP_ROUNDS[1].ggEventId, '12971191003644979032')
  assert.deepEqual(Object.values(SEATTLE_CUP_ROUNDS).map((round) => round.ggRoundId), [
    '12971191129037891140',
    '12971191132628215365',
    '12971191135178352198',
    '12971191137325835847',
  ])
  assert.equal(pickFormatTournamentId([
    { event: { id: '12971191256947385914', name: 'Seattle Cup 2026 Chapman', result_scope: 'rs_field' } },
    { event: { id: '12971191228224792120', name: 'Chapman', result_scope: 'rs_pos_group' } },
  ], 'chapman'), '12971191228224792120')
  assert.equal(pickFormatTournamentId([
    { event: { id: '12971191249129203257', name: 'Singles', result_scope: 'rs_pos_partners' } },
    { event: { id: '12971191256947385914', name: 'Seattle Cup 2026', result_scope: 'rs_field' } },
  ], 'singles'), '12971191249129203257')
})

test('2026 R2 Match 14 uses stable GG team identity for both Scramble sides', async () => {
  const snap = await makeSnapshot(2, makeFake2026CompetitiveClient('Scramble'))
  const match = snap.matches.find((candidate) => candidate.matchNo === 14)!

  assert.equal(match.teamA, 'jackson-park')
  assert.equal(match.teamB, 'west-seattle')
  assert.deepEqual(match.playersA.map((player) => player.name), ['Fitzgerald, Dylan', 'Waterman, Grant'])
  assert.deepEqual(match.playersB.map((player) => player.name), ['Morris, Tom', 'Tang, Benjamin'])
  assert.deepEqual(match.playersA.map((player) => player.ggMemberCardId), [
    '10860012332684174875', '7367709487051859929',
  ])
  assert.deepEqual(match.playersB.map((player) => player.ggMemberCardId), [
    '6147861167344739947', '10860025110379652643',
  ])
  assert.ok(match.playersA.every((player) => player.teamKey === 'jackson-park'))
  assert.ok(match.playersB.every((player) => player.teamKey === 'west-seattle'))
  assert.equal(match.teamAIdentity.source, 'points-summary-team-id')
  assert.equal(match.teamBIdentity.source, 'points-summary-team-id')
  assert.equal(match.teamAIdentity.aggregateNameTeamKey, 'jackson-park')
  assert.equal(match.teamBIdentity.aggregateNameTeamKey, 'west-seattle')
  assert.deepEqual(match.teamAIdentity.memberTeamKeys, ['jackson-park'])
  assert.deepEqual(match.teamBIdentity.memberTeamKeys, ['west-seattle'])

  // Team identity must not alter authoritative Scramble side scoring semantics.
  assert.equal(match.result, '4 & 3')
  assert.equal(match.pointsA, 1)
  assert.equal(match.pointsB, 0)
  assert.equal(match.holes[1]!.netA, 4)
  assert.equal(match.holes[1]!.netB, 3)
  assert.equal(match.holes[1]!.winner, 'B')
})

test('2026 production-shaped R1/R2 competitive matches satisfy team identity invariants', async () => {
  const rounds = await Promise.all([
    makeSnapshot(1, makeFake2026CompetitiveClient('Fourball')),
    makeSnapshot(2, makeFake2026CompetitiveClient('Scramble')),
  ])

  for (const snap of rounds) {
    for (const match of snap.matches) {
      assert.ok(match.teamA, `R${snap.round} M${match.matchNo} teamA resolves`)
      assert.ok(match.teamB, `R${snap.round} M${match.matchNo} teamB resolves`)
      assert.notEqual(match.teamA, match.teamB, `R${snap.round} M${match.matchNo} has distinct opponents`)
      assert.ok(match.playersA.every((player) => player.teamKey === match.teamA),
        `R${snap.round} M${match.matchNo} playersA agree with teamA`)
      assert.ok(match.playersB.every((player) => player.teamKey === match.teamB),
        `R${snap.round} M${match.matchNo} playersB agree with teamB`)
    }
    assert.equal(snap.validationIssues.filter((issue) =>
      ['same-team-match', 'player-team-mismatch', 'team-identity-conflict', 'team-identity-unresolved'].includes(issue.kind)).length, 0)
  }
})

test('stable member-card team identity wins over ambiguous affiliation without tee-order inference', async () => {
  const group = makePairingGroup(0, [
    // An unrelated adjacent player must not influence either competitive side.
    teePlayer('Adjacent Interbay', 'Interbay', 'adjacent'),
    teePlayer('West B', 'West Seattle', 'west-b'),
    teePlayer('Bill A', 'Bill Wright', 'bill-a'),
    teePlayer('West A', 'West Seattle', 'west-a'),
  ])
  const scopes = [{ aggregates: [
    {
      name: 'Mixed affiliation (West A + West B)',
      affiliation: 'Interbay Golf Club, West Seattle Golf Club',
      member_cards: [{ member_card_id: 'west-a' }, { member_card_id: 'west-b' }],
    },
    {
      name: 'Bill Wright (Bill A)', affiliation: 'Bill Wright Golf Club',
      member_cards: [{ member_card_id: 'bill-a' }],
    },
  ] }]
  const snap = await makeSnapshot(3, makePreplayClient('Chapman', [group], scopes))
  const match = snap.matches[0]!

  assert.equal(match.teamA, 'west-seattle')
  assert.equal(match.teamAIdentity.source, 'member-card-team')
  assert.deepEqual(match.playersA.map((player) => player.teamKey), ['west-seattle', 'west-seattle'])
  assert.equal(match.playersA.some((player) => player.ggMemberCardId === 'adjacent'), false)
})

test('conflicting authoritative team identities stay unresolved and produce diagnostics', async () => {
  const group = makePairingGroup(0, [
    teePlayer('Stable West A', 'West Seattle', 'west-a'),
    teePlayer('Stable West B', 'West Seattle', 'west-b'),
    teePlayer('Bill A', 'Bill Wright', 'bill-a'),
    teePlayer('Bill B', 'Bill Wright', 'bill-b'),
  ])
  const scopes = [{ aggregates: [
    {
      name: 'Interbay (Stable West A + Stable West B)', affiliation: 'Interbay Golf Club',
      member_cards: [{ member_card_id: 'west-a' }, { member_card_id: 'west-b' }],
    },
    {
      name: 'Bill Wright (Bill A + Bill B)', affiliation: 'Bill Wright Golf Club',
      member_cards: [{ member_card_id: 'bill-a' }, { member_card_id: 'bill-b' }],
    },
  ] }]
  const snap = await makeSnapshot(3, makePreplayClient('Chapman', [group], scopes))
  const match = snap.matches[0]!

  assert.equal(match.teamA, null, 'Planit does not guess when aggregate and stable member identity conflict')
  assert.equal(match.teamAIdentity.source, 'conflict')
  assert.deepEqual(match.playersA.map((player) => player.teamKey), ['west-seattle', 'west-seattle'],
    'stable member-card identity is preserved for diagnosis')
  assert.ok(snap.validationIssues.some((issue) =>
    issue.matchNo === 25 && issue.kind === 'team-identity-conflict'))
})

test('an impossible same-team competitive scope is retained but explicitly diagnosed', async () => {
  const group = makePairingGroup(0, [
    teePlayer('Interbay A', 'Interbay', 'ib-a'),
    teePlayer('Interbay B', 'Interbay', 'ib-b'),
  ])
  const scopes = [{ aggregates: [
    { name: 'Interbay (Interbay A)', member_cards: [{ member_card_id: 'ib-a' }] },
    { name: 'Interbay (Interbay B)', member_cards: [{ member_card_id: 'ib-b' }] },
  ] }]
  const snap = await makeSnapshot(3, makePreplayClient('Chapman', [group], scopes))

  assert.equal(snap.matches[0]!.teamA, 'interbay')
  assert.equal(snap.matches[0]!.teamB, 'interbay')
  assert.ok(snap.validationIssues.some((issue) =>
    issue.matchNo === 25 && issue.kind === 'same-team-match'))
})

test('Chapman pre-play: published 2v2 tee groups expose scheduled players without scores or live/final state', async () => {
  const groups = Array.from({ length: 12 }, (_, index) => makePairingGroup(index, [
    teePlayer(`Interbay ${index}A`, 'Interbay', `ib-${index}-a`),
    teePlayer(`Interbay ${index}B`, 'Interbay', `ib-${index}-b`),
    teePlayer(`Jackson ${index}A`, 'Jackson Park', `jp-${index}-a`),
    teePlayer(`Jackson ${index}B`, 'Jackson Park', `jp-${index}-b`),
  ]))
  const snap = await makeSnapshot(3, makePreplayClient('Chapman', groups))

  assert.equal(snap.pairingsPublished, true)
  assert.equal(snap.competitionMatchesAvailable, true)
  assert.equal(snap.roundStatus, 'pairings-available')
  assert.equal(snap.resultStatus, 'not-started')
  assert.equal(snap.pairingGroups.length, 12)
  assert.equal(snap.pairingGroups.flatMap((group) => group.players).length, 48)
  assert.equal(snap.matches.length, 12)
  for (const match of snap.matches) {
    assert.equal(match.playersA.length, 2)
    assert.equal(match.playersB.length, 2)
    assert.equal(match.status, 'scheduled')
    assert.equal(match.through, 'not-started')
    assert.equal(match.result, null)
    assert.equal(match.pointsA, null)
    assert.equal(match.pointsB, null)
    assert.ok([...match.playersA, ...match.playersB].every((player) =>
      player.grossScores.length === 0 && player.netScores.length === 0))
    assert.ok(match.holes.every((hole) =>
      hole.sourceMatchStatusA === null && hole.sourceMatchStatusB === null))
    assert.ok(match.holes.every((hole) => hole.netA == null && hole.netB == null && hole.grossA == null && hole.grossB == null))
  }
})

test('populated pre-play scopes establish Chapman sides without implying live scoring', async () => {
  const group = makePairingGroup(0, [
    teePlayer('Interbay A', 'Interbay', 'ib-a'), teePlayer('Interbay B', 'Interbay', 'ib-b'),
    teePlayer('Jackson A', 'Jackson Park', 'jp-a'), teePlayer('Jackson B', 'Jackson Park', 'jp-b'),
  ])
  const scopes = [{ aggregates: [
    { name: 'Interbay (A + B)', member_cards: [{ member_card_id: 'ib-a' }, { member_card_id: 'ib-b' }], net_scores: [], gross_scores: [], hbh_match_status: [] },
    { name: 'Jackson Park (A + B)', member_cards: [{ member_card_id: 'jp-a' }, { member_card_id: 'jp-b' }], net_scores: [], gross_scores: [], hbh_match_status: [] },
  ] }]
  const snap = await makeSnapshot(3, makePreplayClient('Chapman', [group], scopes))

  assert.equal(snap.pairingsPublished, true)
  assert.equal(snap.competitionMatchesAvailable, true)
  assert.equal(snap.roundStatus, 'pairings-available')
  assert.equal(snap.matches[0].status, 'scheduled')
  assert.equal(snap.matches[0].playersA.length, 2)
  assert.equal(snap.matches[0].playersB.length, 2)
})

test('Singles pre-play: official schedule supplies 24 true 1v1 matches while foursomes remain logistical', async () => {
  const groups = makeOfficialSinglesTeeGroups()
  const emptyScopeShells = Array.from({ length: 24 }, () => ({ aggregates: [] }))
  const snap = await makeSnapshot(4, makePreplayClient('Singles', groups, emptyScopeShells))

  assert.equal(snap.pairingsPublished, true)
  assert.equal(snap.competitionMatchesAvailable, true)
  assert.equal(snap.scheduledMatchesAvailable, true)
  assert.equal(snap.competitionScopesAvailable, false)
  assert.equal(snap.roundStatus, 'pairings-available')
  assert.equal(snap.resultStatus, 'not-started')
  assert.equal(snap.pairingGroups.length, 12)
  assert.equal(snap.pairingGroups[0].startingHole, '1A')
  assert.equal(snap.pairingGroups.flatMap((group) => group.players).length, 48)
  assert.equal(snap.matches.length, 24)
  assert.deepEqual(snap.matches.map((match) => match.matchNo), Array.from({ length: 24 }, (_, index) => 37 + index))
  for (const match of snap.matches) {
    assert.ok(match.teamA)
    assert.ok(match.teamB)
    assert.equal(match.playersA.length, 1)
    assert.equal(match.playersB.length, 1)
    assert.equal(match.playersA[0]!.teamKey, match.teamA)
    assert.equal(match.playersB[0]!.teamKey, match.teamB)
    assert.ok(match.playersA[0]!.ggMemberCardId, 'official player identity joins to tee-sheet member card')
    assert.ok(match.playersB[0]!.ggMemberCardId, 'official player identity joins to tee-sheet member card')
    assert.equal(match.status, 'scheduled')
    assert.equal(match.through, 'not-started')
    assert.equal(match.result, null)
    assert.equal(match.pointsA, null)
    assert.equal(match.pointsB, null)
    assert.deepEqual(match.playersA[0]!.grossScores, [])
    assert.deepEqual(match.playersA[0]!.netScores, [])
    assert.deepEqual(match.playersB[0]!.grossScores, [])
    assert.deepEqual(match.playersB[0]!.netScores, [])
    assert.ok(match.holes.every((hole) =>
      hole.sourceMatchStatusA === null && hole.sourceMatchStatusB === null))
    assert.ok(match.holes.every((hole) => hole.netA == null && hole.netB == null && hole.grossA == null && hole.grossB == null))
  }

  const assertMatch = (matchNo: number, teamA: string, playerA: string, teamB: string, playerB: string) => {
    const match = snap.matches.find((candidate) => candidate.matchNo === matchNo)!
    assert.equal(match.teamA, teamA)
    assert.equal(match.playersA[0]!.name, playerA)
    assert.equal(match.teamB, teamB)
    assert.equal(match.playersB[0]!.name, playerB)
  }
  assertMatch(37, 'bill-wright', 'Kyuss Lis', 'jackson-park', 'Matt Lipe')
  assertMatch(44, 'interbay', 'Luke Sulpizio', 'jackson-park', 'Jeb Garcia')
  assertMatch(53, 'bill-wright', 'Cameron Duncan', 'interbay', 'Josh Benner')
  assertMatch(60, 'interbay', 'Nathan DePinto', 'bill-wright', 'Tyson Than')

  const firstTeeGroupNames = new Set(snap.pairingGroups[0]!.players.map((player) => player.name))
  assert.ok(snap.matches.every((match) => {
    const competitorNames = [...match.playersA, ...match.playersB].map((player) => player.name)
    return competitorNames.some((name) => !firstTeeGroupNames.has(name))
  }), 'no four-player tee group is interpreted as a competitive match')
})

test('Singles published identities use stable GG card ids and existing roster enrichment', async () => {
  const { store } = makeMemorySeattleCupStore()
  const kyussCardId = OFFICIAL_2026_SINGLES_MATCH_SCHEDULE[0]!.playerA.ggMemberCardId!
  const snap = await getSeattleCupLive({
    round: 4,
    deps: {
      ggClient: makePreplayClient('Singles', makeOfficialSinglesTeeGroups()),
      cacheStore: store,
      rosterLookup: async (memberCardIds) => new Map(memberCardIds.includes(kyussCardId)
        ? [[kyussCardId, { name: 'Kyuss Lis', handicapIndex: null, ghin: 'test-ghin' }]]
        : []),
    },
  })
  const kyuss = snap.matches[0]!.playersA[0]!
  assert.equal(kyuss.ggMemberCardId, kyussCardId)
  assert.equal(kyuss.identityStatus, 'resolved')
  assert.equal(kyuss.ghin, 'test-ghin')
})

// ---------------- 2025 Fourball populated/final ----------------
test('2025 Fourball: 12 real matches, points from GG, round totals reconcile', async () => {
  const snap = await makeSnapshot(1, makeFakeFourballClient())
  assert.equal(snap.matches.length, 12)
  assert.equal(snap.resultStatus, 'final')

  const totalAwarded = snap.matches.reduce((s, m) => s + (m.pointsA ?? 0) + (m.pointsB ?? 0), 0)
  assert.ok(Math.abs(totalAwarded - 12) < 0.001, `round points sum to 12 (one per match); got ${totalAwarded}`)

  // Round standings reconcile to match points.
  const roundSum = snap.roundStandings.reduce((s, t) => s + t.roundPoints, 0)
  assert.ok(Math.abs(roundSum - 12) < 0.001, `roundStandings sum to 12; got ${roundSum}`)

  // Overall standings (from team_points, cross-checked against match-derived).
  const overallSum = snap.overallStandings.reduce((s, t) => s + t.totalPoints, 0)
  assert.ok(Math.abs(overallSum - 12) < 0.001, `overallStandings sum to 12; got ${overallSum}`)
  assert.equal(snap.validationIssues.filter((v) => v.kind === 'round-points-mismatch').length, 0,
    'team_points cross-check matches match-derived round points')
})

test('GG net scores + handicap dots are passed through / preserved', async () => {
  const snap = await makeSnapshot(1, makeFakeFourballClient())
  const m1 = snap.matches[0]
  // Side aggregate net_scores come through as netA/netB per hole.
  assert.equal(m1.holes.length, 18)
  assert.ok(m1.holes[0].netA != null, 'netA present (GG aggregate net)')
  assert.ok(m1.holes[0].netB != null, 'netB present')
  // Per-player handicap dots preserved (from tee sheet join).
  const anyDots = snap.matches.some((m) => m.playersA.some((p) => p.handicapDots.length > 0) || m.playersB.some((p) => p.handicapDots.length > 0))
  assert.ok(anyDots, 'at least one player has handicap dots preserved')
})

test('R1 final Fourball preserves individual scores by stable member id and exposes GG cumulative status', async () => {
  // Reverse every individual_results array so a positional join would attach
  // the wrong golfer's card. The normalizer must join member_cards.member_id_str
  // to individual_results.member_id_str while preserving member-card identity.
  const snap = await makeSnapshot(1, makeFakeFourballClient({ reverseIndividualResults: true }))
  const match = snap.matches[0]!
  const fixtureMatch = readFix('tournament_2025_Fourball.json').event.scopes[0]
  const normalizedSides = [match.playersA, match.playersB]

  assert.equal(match.status, 'final')
  assert.equal(match.result, '5 & 3')
  assert.equal(match.pointsA, 1)
  assert.equal(match.pointsB, 0)
  assert.equal(normalizedSides.flat().length, 4)

  for (let sideIndex = 0; sideIndex < normalizedSides.length; sideIndex++) {
    const aggregate = fixtureMatch.aggregates[sideIndex]
    const expectedByMemberId = new Map(aggregate.individual_results.map((result: any) =>
      [result.member_id_str, result]))
    for (let playerIndex = 0; playerIndex < normalizedSides[sideIndex]!.length; playerIndex++) {
      const card = aggregate.member_cards[playerIndex]
      const expected = expectedByMemberId.get(card.member_id_str) as any
      const player = normalizedSides[sideIndex]![playerIndex]!
      assert.equal(player.ggMemberCardId, card.member_card_id_str)
      assert.equal(player.name, expected.name)
      assert.deepEqual(player.grossScores, expected.gross_scores)
      assert.deepEqual(player.netScores, expected.net_scores)
      assert.equal(player.grossScores.length, 18, `${player.name} gross scores align to 18 holes`)
      assert.equal(player.netScores.length, 18, `${player.name} net scores align to 18 holes`)
    }
  }
  assert.equal(match.playersB[0]!.grossScores[13], null, 'GG null remains aligned at hole 14')

  for (let i = 0; i < 18; i++) {
    assert.equal(match.holes[i]!.sourceMatchStatusA, fixtureMatch.aggregates[0].hbh_match_status[i] || null)
    assert.equal(match.holes[i]!.sourceMatchStatusB, fixtureMatch.aggregates[1].hbh_match_status[i] || null)
  }
})

test('partial/live Fourball exposes only source statuses received so far and does not invent result or points', async () => {
  const scopes = [{ aggregates: [
    {
      name: 'Interbay (Alpha + Beta)',
      member_cards: [
        { member_id_str: 'member-a1', member_card_id_str: 'card-a1' },
        { member_id_str: 'member-a2', member_card_id_str: 'card-a2' },
      ],
      individual_results: [
        { member_id_str: 'member-a2', name: 'Beta', gross_scores: [5, 4], net_scores: [4, 4] },
        { member_id_str: 'member-a1', name: 'Alpha', gross_scores: [4, 3], net_scores: [4, 3] },
      ],
      gross_scores: [4, 3], net_scores: [4, 3], hbh_match_status: ['T', '1 up'],
      score: '', points: null,
    },
    {
      name: 'Jackson Park (Gamma + Delta)',
      member_cards: [
        { member_id_str: 'member-b1', member_card_id_str: 'card-b1' },
        { member_id_str: 'member-b2', member_card_id_str: 'card-b2' },
      ],
      individual_results: null,
      gross_scores: [4, 4], net_scores: [4, 4], hbh_match_status: ['T', ''],
      score: '', points: null,
    },
  ] }]
  const client: GGClient = async (endpoint) => {
    if (endpoint.includes('/tournaments/') && endpoint.endsWith('.json')) return { event: { name: 'Fourball', scopes } }
    if (endpoint.endsWith('/tournaments')) return [{ event: { id: 'fb-live', name: 'Fourball', result_scope: 'rs_pos_group' } }]
    if (endpoint.endsWith('/tee_sheet')) return []
    if (endpoint.endsWith('/team_points')) return { teams: [] }
    return { round: { date: '2026-08-27', name: 'Fourball' } }
  }

  const snap = await makeSnapshot(1, client)
  const match = snap.matches[0]!
  assert.equal(snap.resultStatus, 'live')
  assert.equal(match.status, 'live')
  assert.equal(match.through, 2)
  assert.equal(match.sourceResult, null)
  assert.equal(match.result, null)
  assert.equal(match.derivedResult, null)
  assert.equal(match.pointsA, null)
  assert.equal(match.pointsB, null)
  assert.deepEqual(match.playersA[0]!.grossScores, [4, 3], 'member-id join is not positional')
  assert.deepEqual(match.playersA[1]!.grossScores, [5, 4])
  assert.deepEqual(match.playersB[0]!.grossScores, [], 'missing individual_results does not copy side scores')
  assert.equal(match.holes[0]!.sourceMatchStatusA, 'T')
  assert.equal(match.holes[0]!.sourceMatchStatusB, 'T')
  assert.equal(match.holes[1]!.sourceMatchStatusA, '1 up')
  assert.equal(match.holes[1]!.sourceMatchStatusB, null)
  assert.ok(match.holes.slice(2).every((hole) =>
    hole.sourceMatchStatusA === null && hole.sourceMatchStatusB === null))
  assert.ok(snap.matches.slice(1).every((scheduled) =>
    scheduled.status === 'scheduled' && scheduled.result === null
      && scheduled.pointsA === null && scheduled.pointsB === null))
})

test('match state normalizations: all-square, A-up/B-up, dormie, N&M, 1-up, halve', async () => {
  const snap = await makeSnapshot(1, makeFakeFourballClient())
  const states = snap.matches.map((m) => m.matchState)
  // All final (2025 Fourball is complete) → every match matchState 'final'.
  assert.ok(states.every((s) => s === 'final'), `all final; got ${JSON.stringify(states)}`)
  // M12 was "Tied" (halved) → result "Tied", points 0.5/0.5.
  const m12 = snap.matches[11]
  assert.equal(m12.result, 'Tied')
  assert.ok(Math.abs((m12.pointsA ?? 0) - 0.5) < 0.001 && Math.abs((m12.pointsB ?? 0) - 0.5) < 0.001)
  // A 1-up final exists (M7/M8) and a N&M final exists (M1 "5 & 3").
  assert.ok(snap.matches.some((m) => m.result === '1 up'), 'a 1-up final present')
  assert.ok(snap.matches.some((m) => /&/.test(m.result ?? '')), 'an N&M final present')
  // Validation: derived vs source should match for every final match.
  const mismatches = snap.validationIssues.filter((v) => v.kind === 'result-mismatch')
  assert.equal(mismatches.length, 0, `no result mismatches: ${JSON.stringify(mismatches)}`)
})

test('points come from GG (source); final matches validate sum===1', async () => {
  const snap = await makeSnapshot(1, makeFakeFourballClient())
  for (const m of snap.matches) {
    assert.equal(m.status, 'final')
    const sum = (m.pointsA ?? 0) + (m.pointsB ?? 0)
    assert.ok(Math.abs(sum - 1) < 0.001, `match ${m.matchNo} points sum to 1; got ${sum}`)
  }
  const pointsMismatches = snap.validationIssues.filter((v) => v.kind === 'points-mismatch')
  assert.equal(pointsMismatches.length, 0)
})

test('identity resolution: gg-only names, unresolved is diagnostic', async () => {
  const snap = await makeSnapshot(1, makeFakeFourballClient())
  const summary = identitySummary(snap)
  // 2025 Fourball: every side has 2 named players from GG (individual_results +
  // tee sheet). All resolve to a name → gg-only (no Planit roster lookup in this
  // test). No unresolved.
  assert.equal(summary.unresolved, 0, 'no unresolved identities')
  assert.ok(summary['gg-only'] > 0, 'players resolved from GG')
  // member_card_id is carried for every populated player.
  for (const m of snap.matches) {
    for (const p of [...m.playersA, ...m.playersB]) {
      if (p.identityStatus !== 'tbd') assert.ok(p.ggMemberCardId, 'card id present')
    }
  }
})

test('team_points mismatch is surfaced as a validation issue', async () => {
  const client = makeFakeFourballClient()
  const orig = client
  // Override team_points to be deliberately wrong.
  const badClient: GGClient = async (endpoint) => {
    if (endpoint.endsWith('/team_points')) {
      const tp = readFix('tournament_2025_Fourball.json')
      return { teams: buildTeamPointsFromScopes(tp.event.scopes, true) }
    }
    return orig(endpoint)
  }
  const snap = await makeSnapshot(1, badClient)
  assert.ok(snap.validationIssues.some((v) => v.kind === 'round-points-mismatch'),
    'round-points-mismatch surfaced: ' + JSON.stringify(snap.validationIssues))
})

// ---------------- Singles regression (scopes-not-foursomes) ----------------
test('Singles: a 4-player tee foursome normalizes to independent 1v1 matches from SCOPES, not one 4-way match', async () => {
  const singlesPayload = readFix('tournament_2025_Singles.json')
  const singlesTee = readFix('tee_sheet_2025_Singles.json')
  // Use the first 2 scopes (M1 Interbay vs Bill Wright, M2 Jackson Park vs West
  // Seattle) + the first tee foursome (the 4 players, one per team).
  const twoScopes = singlesPayload.event.scopes.slice(0, 2)
  const firstFoursome = (Array.isArray(singlesTee) ? singlesTee : singlesTee.pairing_groups)[0]

  const client: GGClient = async (endpoint) => {
    if (endpoint.includes('/tournaments/') && endpoint.endsWith('.json')) return { event: { scopes: twoScopes } }
    if (endpoint.endsWith('/tournaments')) return [{ event: { id: 'sg-tid', name: 'Singles', result_scope: 'rs_pos_partners' } }]
    if (endpoint.endsWith('/tee_sheet')) return [firstFoursome]
    if (endpoint.endsWith('/team_points')) return { teams: [] }
    return { round: { date: '2025-08-16', name: 'Singles' } }
  }
  const raw = await fetchRoundRaw({ round: 4, ggClient: client })
  const { snapshot } = normalizeRound(4, raw)
  const real = snapshot.matches.filter((m) => m.status !== 'scheduled')
  // Exactly 2 matches from the 2 scopes (NOT one 4-way match from the foursome).
  assert.equal(real.length, 2, 'two independent 1v1 matches from scopes')
  for (const m of real) {
    assert.equal(m.playersA.length, 1, 'each side has exactly 1 player (1v1)')
    assert.equal(m.playersB.length, 1, 'each side has exactly 1 player (1v1)')
    assert.ok(m.teamA && m.teamB, 'each match has two distinct teams')
    assert.notEqual(m.teamA, m.teamB, 'the two sides are different teams')
  }
  // The two matches pair the right teams: Interbay vs Bill Wright, Jackson Park vs West Seattle.
  const pairs = real.map((m) => [m.teamA, m.teamB].sort().join('|')).sort()
  assert.ok(pairs.includes('bill-wright|interbay'), 'Interbay vs Bill Wright present')
  assert.ok(pairs.includes('jackson-park|west-seattle'), 'Jackson Park vs West Seattle present')
  // NO match has 4 players (the foursome was never interpreted as a match).
  assert.ok(real.every((m) => m.playersA.length + m.playersB.length === 2), 'no 4-way match')
})

test('Singles populated: all 24 GG scopes win over tee grouping as 1v1 matches 37-60', async () => {
  const singlesPayload = readFix('tournament_2025_Singles.json')
  const singlesTee = readFix('tee_sheet_2025_Singles.json')
  const snap = await makeSnapshot(4, makePreplayClient('Singles', singlesTee, singlesPayload.event.scopes))

  assert.equal(snap.pairingsPublished, true)
  assert.equal(snap.competitionMatchesAvailable, true)
  assert.equal(snap.scheduledMatchesAvailable, true)
  assert.equal(snap.competitionScopesAvailable, true)
  assert.equal(snap.matches.length, 24)
  assert.deepEqual(snap.matches.map((match) => match.matchNo), Array.from({ length: 24 }, (_, index) => 37 + index))
  for (const match of snap.matches) {
    assert.equal(match.playersA.length, 1)
    assert.equal(match.playersB.length, 1)
    assert.equal(match.playersA.length + match.playersB.length, 2, 'tee foursome never becomes a competitive match')
    assert.ok(match.teamA)
    assert.ok(match.teamB)
    assert.notEqual(match.teamA, match.teamB)
    assert.ok([...match.playersA, ...match.playersB].every((player) =>
      player.grossScores.length === 0 && player.netScores.length === 0),
    'Singles player arrays are not duplicated from side-level scores')
  }
  assert.notEqual(snap.matches[0]!.playersA[0]!.name, 'Kyuss Lis', 'GG scope opponent overrides the 2026 published fallback')
  assert.ok(snap.matches.some((match) => match.status === 'final' && match.pointsA != null && match.result != null),
    'score/result/points come through from populated GG scopes')
  assert.ok(snap.validationIssues.some((issue) => issue.kind === 'published-schedule-mismatch'),
    'material differences between replayed GG scopes and the 2026 sheet are surfaced')
})

// ---------------- cache + stale-while-error ----------------
test('stale-while-error serves the last valid snapshot with showingLastKnown=true', async () => {
  const { store, rows } = makeMemorySeattleCupStore()
  // First call: succeeds, populates cache.
  const goodClient = makeFakeFourballClient()
  const snap1 = await getSeattleCupLive({ round: 1, deps: { ggClient: goodClient, cacheStore: store, rosterLookup: null } })
  assert.equal(snap1.showingLastKnown, false)
  assert.equal(rows.size, 1, 'cache populated')

  // Expire the fresh row so the next read misses and re-fetches.
  for (const r of rows.values()) r.expiresAt = 0

  // Second call: GG now throws → stale-while-error serves the cached snapshot.
  const badClient = makeFakeFourballClient({ throwOnJson: true })
  const snap2 = await getSeattleCupLive({ round: 1, deps: { ggClient: badClient, cacheStore: store, rosterLookup: null } })
  assert.equal(snap2.showingLastKnown, true, 'serving last-known with showingLastKnown=true')
  assert.equal(snap2.matches.length, 12, 'stale snapshot still has 12 matches')
})

test('no stale row + upstream error → rethrows (route returns 502)', async () => {
  const { store } = makeMemorySeattleCupStore()
  const badClient = makeFakeFourballClient({ throwOnJson: true })
  await assert.rejects(
    () => getSeattleCupLive({ round: 1, deps: { ggClient: badClient, cacheStore: store, rosterLookup: null } }),
    /upstream down/,
  )
})

test('cache read failure is observable and distinct from an ordinary miss', async () => {
  const readFailureEvents: { operation: string; code: string }[] = []
  const failingReadStore = {
    async readFresh() {
      throw Object.assign(new Error('sensitive database detail must not be reported'), { code: '42501' })
    },
    async readStale() { return null },
    async write() {},
  }
  const recovered = await getSeattleCupLive({
    round: 1,
    deps: {
      ggClient: makeFakeFourballClient(),
      cacheStore: failingReadStore,
      rosterLookup: null,
      onCacheError: (event) => readFailureEvents.push(event),
    },
  })
  assert.equal(recovered.resultStatus, 'final', 'fresh GG path remains available after cache read failure')
  assert.deepEqual(readFailureEvents, [{ operation: 'read-fresh', code: '42501' }])

  const missEvents: { operation: string; code: string }[] = []
  const ordinaryMissStore = {
    async readFresh() { return null },
    async readStale() { return null },
    async write() {},
  }
  await getSeattleCupLive({
    round: 1,
    deps: {
      ggClient: makeFakeFourballClient(),
      cacheStore: ordinaryMissStore,
      rosterLookup: null,
      onCacheError: (event) => missEvents.push(event),
    },
  })
  assert.deepEqual(missEvents, [], 'a genuine no-row miss emits no cache failure diagnostic')
})

test('cache write failure is observable without breaking a fresh response', async () => {
  const events: { operation: string; code: string }[] = []
  const store = {
    async readFresh() { return null },
    async readStale() { return null },
    async write() {
      throw Object.assign(new Error('connection detail must not be reported'), { code: '08006' })
    },
  }
  const snapshot = await getSeattleCupLive({
    round: 1,
    deps: {
      ggClient: makeFakeFourballClient(),
      cacheStore: store,
      rosterLookup: null,
      onCacheError: (event) => events.push(event),
    },
  })
  assert.equal(snapshot.resultStatus, 'final')
  assert.deepEqual(events, [{ operation: 'write', code: '08006' }])
})

// ---------------- public-response shape ----------------
test('the normalized response exposes no raw GG payload (only the contract)', async () => {
  const snap = await makeSnapshot(1, makeFakeFourballClient())
  const json = JSON.stringify(snap)
  // No GG-internal field names leak into the public contract.
  for (const leak of ['hbh_match_status', 'points_summary_team_id', 'member_card_id_str', 'aggregates', 'scorecard_statuses', 'disposition']) {
    assert.ok(!json.includes(`"${leak}"`), `raw GG field "${leak}" must not leak into the response`)
  }
})

// ---------------- GG placeholder finality (2026 R3/R4 production incident) ----------------
//
// Once GG published R3 Chapman / R4 Singles pairings, it supplied `score: "-"`
// on every unplayed match's aggregates. The old finality rule ("either side's
// score is non-empty") treated the placeholder as a real result and cascaded:
// matches final → rounds final → fake 0-6 / 0-12 loss records → Race final
// with toWin null. These tests protect the semantic boundary: PAIRINGS DO NOT
// IMPLY FINALITY.

// Production-shaped GG scope pair for a paired-but-unplayed match: players,
// team names, and member cards populated; all 18 holes null; points null; and
// GG's placeholder score "-" on both aggregates (recorded from production
// /api/seattle-cup/live?round=3 on 2026-08-28).
function unplayedPairedScope(teamAName: string, teamBName: string, cardIds: [string, string, string, string], score = '-') {
  const aggregate = (name: string, cards: string[], scoreOverride?: string) => ({
    name, member_cards: cards.map((id) => ({ member_card_id: id })),
    net_scores: [], gross_scores: [], hbh_match_status: [],
    score: scoreOverride ?? score, points: null,
  })
  return { aggregates: [
    aggregate(teamAName, cardIds.slice(0, 2)),
    aggregate(teamBName, cardIds.slice(2)),
  ] }
}

function chapmanTeamName(teamKey: string): string {
  return SEATTLE_CUP_TEAMS[teamKey as keyof typeof SEATTLE_CUP_TEAMS].label
}

// 12 R3 scopes + tee groups shaped exactly like the production pre-play R3
// payload: one scope per scheduled slot, both sides populated, score "-".
function makeUnplayedChapmanClient(): GGClient {
  const scopes = ROUND_LIST[2]!.matchSlots.map((slot, index) => unplayedPairedScope(
    chapmanTeamName(slot.teamA), chapmanTeamName(slot.teamB),
    [`r3-${index}-a1`, `r3-${index}-a2`, `r3-${index}-b1`, `r3-${index}-b2`],
  ))
  const groups = scopes.map((scope, index) => makePairingGroup(index, scope.aggregates.flatMap((aggregate, side) =>
    aggregate.member_cards.map((card: any, player: number) => teePlayer(
      `R3 ${index}-${side}-${player}`, aggregate.name, card.member_card_id,
    )))))
  return makePreplayClient('Chapman', groups, scopes)
}

// 24 R4 scopes shaped like the production pre-play Singles payload: the
// official 1v1 schedule's players with GG's placeholder score "-".
function makeUnplayedSinglesClient(): GGClient {
  const scopes = OFFICIAL_2026_SINGLES_MATCH_SCHEDULE.map((match) => ({
    aggregates: [
      {
        name: `${chapmanTeamName(match.playerA.teamKey)} (${match.playerA.name})`,
        member_cards: [{ member_card_id: match.playerA.ggMemberCardId ?? `official-${match.matchNo}-a` }],
        net_scores: [], gross_scores: [], hbh_match_status: [], score: '-', points: null,
      },
      {
        name: `${chapmanTeamName(match.playerB.teamKey)} (${match.playerB.name})`,
        member_cards: [{ member_card_id: match.playerB.ggMemberCardId ?? `official-${match.matchNo}-b` }],
        net_scores: [], gross_scores: [], hbh_match_status: [], score: '-', points: null,
      },
    ],
  }))
  return makePreplayClient('Singles', makeOfficialSinglesTeeGroups(), scopes)
}

test('normalizeSourceResult: GG placeholder/blank scores are not results; real result forms pass through', () => {
  assert.equal(normalizeSourceResult('-'), null, 'GG "-" placeholder is not a result')
  assert.equal(normalizeSourceResult(' - '), null, 'padded placeholder is not a result')
  assert.equal(normalizeSourceResult(''), null)
  assert.equal(normalizeSourceResult('   '), null)
  assert.equal(normalizeSourceResult(null), null)
  assert.equal(normalizeSourceResult(undefined), null)
  // Real GG match-play result forms (fixture-evidenced) pass through verbatim.
  assert.equal(normalizeSourceResult('Tied'), 'Tied')
  assert.equal(normalizeSourceResult('2 up'), '2 up')
  assert.equal(normalizeSourceResult('2 & 1'), '2 & 1')
  assert.equal(normalizeSourceResult('3&2'), '3&2')
  assert.equal(normalizeSourceResult('5 & 3'), '5 & 3')
})

test('R3 Chapman pairings-posted/unplayed: GG "-" placeholder never implies finality', async () => {
  const snap = await makeSnapshot(3, makeUnplayedChapmanClient())

  assert.equal(snap.competitionScopesAvailable, true, 'pairings/scopes are populated')
  assert.equal(snap.pairingsPublished, true)
  assert.equal(snap.roundStatus, 'pairings-available', 'round must not become final or live')
  assert.equal(snap.resultStatus, 'not-started')
  assert.equal(snap.matches.length, 12)
  for (const match of snap.matches) {
    assert.equal(match.sourceResult, null, 'GG "-" must not normalize into a result')
    assert.equal(match.result, null)
    assert.notEqual(match.status, 'final')
    assert.equal(match.status, 'scheduled')
    assert.equal(match.matchState, 'tbd')
    assert.equal(match.through, 'not-started')
    assert.equal(match.validationStatus, 'tbd')
    assert.equal(match.pointsA, null)
    assert.equal(match.pointsB, null)
    assert.ok(match.holes.every((hole) =>
      hole.netA == null && hole.netB == null && hole.grossA == null && hole.grossB == null),
      'holes stay unplayed')
  }
  // No fake 0-6 loss records.
  for (const standing of [...snap.roundStandings, ...snap.overallStandings]) {
    assert.equal(standing.matchesPlayed, 0)
    assert.equal(standing.matchesWon, 0)
    assert.equal(standing.matchesHalved, 0)
    assert.equal(standing.matchesLost, 0, 'an unplayed match must not count as a loss')
    assert.equal(standing.roundPoints, 0)
  }
})

test('R4 Singles pairings-posted/unplayed: 24 true 1v1 matches stay scheduled, never final', async () => {
  const snap = await makeSnapshot(4, makeUnplayedSinglesClient())

  assert.equal(snap.competitionScopesAvailable, true)
  assert.equal(snap.matches.length, 24)
  assert.equal(snap.roundStatus, 'pairings-available')
  assert.equal(snap.resultStatus, 'not-started')
  for (const match of snap.matches) {
    assert.equal(match.sourceResult, null)
    assert.notEqual(match.status, 'final')
    assert.equal(match.status, 'scheduled')
    assert.equal(match.playersA.length, 1, 'Singles stays independent 1v1')
    assert.equal(match.playersB.length, 1)
    assert.equal(match.pointsA, null)
    assert.equal(match.pointsB, null)
   }
  // The asymmetric official graph is untouched: pair-edge counts 5/5/4/4/3/3.
  const pairCounts = new Map<string, number>()
  for (const match of snap.matches) {
    const key = [match.teamA, match.teamB].sort().join('|')
    pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1)
  }
  assert.deepEqual([...pairCounts.values()].sort((a, b) => a - b), [3, 3, 4, 4, 5, 5])
  // No fake 0-12 loss records.
  for (const standing of [...snap.roundStandings, ...snap.overallStandings]) {
    assert.equal(standing.matchesPlayed, 0)
    assert.equal(standing.matchesLost, 0, 'an unplayed Singles match must not count as a loss')
   }
})

test('real GG results (Tied / 2 up / 2 & 1) still finalize matches, round, and standings', async () => {
  // A fully played Chapman round in authentic GG shape: the winner's aggregate
  // carries the result string, the loser's carries "" (a tie shows "Tied" on
  // both), and GG has awarded points (fixture-recorded forms). Side A wins
  // every decisive match so expected standings are computable.
  const RESULT_CYCLE = ['Tied', '2 up', '2 & 1'] as const
  const slots = ROUND_LIST[2]!.matchSlots
  const scopes = slots.map((slot, index) => {
    const result = RESULT_CYCLE[index % 3]!
    const tie = result === 'Tied'
    const cards = [`p${index}-a1`, `p${index}-a2`, `p${index}-b1`, `p${index}-b2`]
    const aggregate = (name: string, cardIds: string[], score: string, points: string) => ({
      name, member_cards: cardIds.map((id) => ({ member_card_id: id })),
      net_scores: [], gross_scores: [], hbh_match_status: [], score, points,
    })
    return { aggregates: [
      aggregate(chapmanTeamName(slot.teamA), cards.slice(0, 2), result, tie ? '0.50' : '1.00'),
      aggregate(chapmanTeamName(slot.teamB), cards.slice(2), tie ? 'Tied' : '', tie ? '0.50' : '0.00'),
    ] }
  })
  const snap = await makeSnapshot(3, makePreplayClient('Chapman', [], scopes))

  assert.equal(snap.roundStatus, 'final', 'genuine results still finalize the round')
  assert.equal(snap.resultStatus, 'final')
  assert.ok(snap.matches.every((match) => match.status === 'final'))
  assert.deepEqual(
    snap.matches.map((m) => m.sourceResult),
    slots.map((_, index) => RESULT_CYCLE[index % 3]),
    'every real GG result form survives normalization',
  )
  for (const match of snap.matches) {
    assert.equal(match.through, 'final')
    assert.notEqual(match.pointsA, null)
    assert.notEqual(match.pointsB, null)
  }
  // Standings reflect genuinely played matches: every team plays 6, and each
  // team's W/H/L accounts for all 6 (no unplayed match counted as a loss).
  for (const teamKey of Object.keys(SEATTLE_CUP_TEAMS)) {
    let played = 0, won = 0, halved = 0, lost = 0
    slots.forEach((slot, index) => {
      if (slot.teamA !== teamKey && slot.teamB !== teamKey) return
      played++
      if (RESULT_CYCLE[index % 3] === 'Tied') halved++
      else if (slot.teamA === teamKey) won++
      else lost++
    })
    const standing = snap.roundStandings.find((s) => s.teamKey === teamKey)!
    assert.equal(standing.matchesPlayed, played, `${teamKey} matchesPlayed`)
    assert.equal(standing.matchesWon, won, `${teamKey} matchesWon`)
    assert.equal(standing.matchesHalved, halved, `${teamKey} matchesHalved`)
    assert.equal(standing.matchesLost, lost, `${teamKey} matchesLost`)
    assert.equal(standing.roundPoints, won * 1 + halved * 0.5, `${teamKey} roundPoints`)
  }
})

test('live match keeps GG "-" placeholder score but stays live — not final, not scheduled', async () => {
  // GG also emits "-" while a match is on the course. Hole/hbh evidence is the
  // live signal; the placeholder must not finalize it. This guards against
  // replacing the old rule with its mirror image ("final iff score is not a
  // placeholder").
  const holes18 = (filled: number, values: string[]) =>
    Array.from({ length: 18 }, (_, i) => (i < filled ? values[i] ?? '' : ''))
  const scopes = [{ aggregates: [
    {
      name: 'Interbay (Alpha + Beta)',
      member_cards: [{ member_card_id: 'live-a1' }, { member_card_id: 'live-a2' }],
      gross_scores: [4, 3, 5], net_scores: [4, 3, 4],
      hbh_match_status: holes18(3, ['T', 'T', '1 up']),
      score: '-', points: null,
    },
    {
      name: 'Jackson Park (Gamma + Delta)',
      member_cards: [{ member_card_id: 'live-b1' }, { member_card_id: 'live-b2' }],
      gross_scores: [4, 4, 5], net_scores: [4, 4, 5],
      hbh_match_status: holes18(3, ['T', '', '']),
      score: '-', points: null,
    },
  ] }]
  const client: GGClient = async (endpoint) => {
    if (endpoint.includes('/tournaments/') && endpoint.endsWith('.json')) return { event: { name: 'Chapman', scopes } }
    if (endpoint.endsWith('/tournaments')) return [{ event: { id: 'ch-live', name: 'Chapman', result_scope: 'rs_pos_group' } }]
    if (endpoint.endsWith('/tee_sheet')) return []
    if (endpoint.endsWith('/team_points')) return { teams: [] }
    return { round: { date: '2026-08-29', name: 'Chapman' } }
  }

  const snap = await makeSnapshot(3, client)
  const match = snap.matches[0]!
  assert.equal(match.status, 'live', 'in-play evidence makes the match live')
  assert.notEqual(match.status, 'final')
  assert.equal(match.sourceResult, null, 'placeholder is still not a result')
  assert.equal(match.derivedResult, null)
  assert.equal(match.pointsA, null)
  assert.equal(match.pointsB, null)
  assert.equal(match.through, 3)
  assert.equal(snap.roundStatus, 'live')
  assert.equal(snap.resultStatus, 'live')
})

test('full cascade — real R1/R2 finals + unplayed R3/R4 keep standings clean and the Race active with toWin restored', async () => {
  // R1: replay the completed 2025 Fourball fixture (real finals). GG
  // team_points.total_points is tournament-cumulative, so the played rounds
  // carry the production cumulative totals (Interbay 7.5 / Jackson Park 7.5 /
  // Bill Wright 5.5 / West Seattle 3.5 = 24 confirmed points).
  const CUMULATIVE_TOTALS: Record<string, number> = {
    Interbay: 7.5, 'Jackson Park': 7.5, 'Bill Wright': 5.5, 'West Seattle': 3.5,
  }
  const fourballPayload = readFix('tournament_2025_Fourball.json')
  const r1Client: GGClient = async (endpoint) => {
    const base = makeFakeFourballClient()
    if (endpoint.endsWith('/team_points')) {
      return { teams: buildTeamPointsFromScopes(fourballPayload.event.scopes).map((team) => ({
        ...team, total_points: CUMULATIVE_TOTALS[team.name] ?? team.round_points,
      })) }
    }
    return base(endpoint)
  }
  const r1 = await makeSnapshot(1, r1Client)

  // R2 (Scramble): replay the completed 2025 Scramble fixture (real finals).
  const scramblePayload = readFix('tournament_2025_Scramble.json')
  const r2Client: GGClient = async (endpoint) => {
    if (endpoint.includes('/tournaments/') && endpoint.endsWith('.json')) return scramblePayload
    if (endpoint.endsWith('/tournaments')) return [{ event: { id: 'sc2-tid', name: 'Scramble', result_scope: 'rs_pos_group' } }]
    if (endpoint.endsWith('/tee_sheet')) return readFix('tee_sheet_2025_Scramble.json')
    if (endpoint.endsWith('/team_points')) return { teams: buildTeamPointsFromScopes(scramblePayload.event.scopes) }
    return { round: { date: '2026-08-28', name: 'Scramble' } }
  }
  const r2 = await makeSnapshot(2, r2Client)

  // R3/R4: pairings posted, unplayed — GG supplies "-" on every match.
  const r3 = await makeSnapshot(3, makeUnplayedChapmanClient())
  const r4 = await makeSnapshot(4, makeUnplayedSinglesClient())

  // Played rounds remain final; unplayed placeholder rounds do not.
  assert.equal(r1.roundStatus, 'final')
  assert.equal(r2.roundStatus, 'final')
  assert.equal(r3.roundStatus, 'pairings-available')
  assert.equal(r4.roundStatus, 'pairings-available')
  assert.ok(r1.matches.every((m) => m.status === 'final'), 'R1 real results remain final')
  assert.ok(r2.matches.every((m) => m.status === 'final'), 'R2 real results remain final')
  assert.ok(r3.matches.every((m) => m.status !== 'final'), 'R3 placeholder matches are not final')
  assert.ok(r4.matches.every((m) => m.status !== 'final'), 'R4 placeholder matches are not final')

  // Standings: unplayed rounds acquire no fake 0-6 / 0-12 loss records.
  for (const snap of [r3, r4]) {
    for (const standing of [...snap.roundStandings, ...snap.overallStandings]) {
      assert.equal(standing.matchesPlayed, 0, `${snap.round}: no matches played`)
      assert.equal(standing.matchesLost, 0, `${snap.round}: unplayed ≠ loss`)
    }
  }

  // Race: 60 tournament points, 24 confirmed → 36 available, active with a
  // populated toWin (23 = runner-up ceiling 22.5 + 0.5). This is the exact
  // production shape the incident destroyed (state "final", toWin null).
  const race = calculateSeattleCupRaceStatus([r1, r2, r3, r4])
  assert.deepEqual(race, {
    toWin: 23,
    mode: 'outright',
    state: 'active',
    availablePoints: 36,
    leaderTeamKeys: ['interbay', 'jackson-park'],
    projectedPoints: { interbay: 0, 'jackson-park': 0, 'bill-wright': 0, 'west-seattle': 0 },
  })

  // Official tournament resolution stays sane: active, no fabricated winner.
  const resolution = calculateSeattleCupTournamentResolution([r1, r2, r3, r4], null)
  assert.equal(resolution.status, 'active')
  assert.equal(resolution.winnerTeamKey, null)
})
