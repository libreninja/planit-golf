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
import { normalizeRound } from '../lib/seattle-cup/normalize.ts'
import { getSeattleCupLive } from '../lib/seattle-cup/live.ts'
import { makeMemorySeattleCupStore } from '../lib/seattle-cup/cache.ts'
import { OFFICIAL_2026_SINGLES_MATCH_SCHEDULE, SEATTLE_CUP_ROUNDS, SEATTLE_CUP_TEAMS } from '../lib/seattle-cup/config.ts'
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

// Sum per-team awarded points from scope aggregates → a team_points payload.
function buildTeamPointsFromScopes(scopes: any[], mismatch = false): any[] {
  const byTeam: Record<string, number> = {}
  for (const s of scopes) {
    for (const a of s.aggregates ?? []) {
      const team = (a.name ?? '').split('(')[0].trim()
      byTeam[team] = (byTeam[team] ?? 0) + Number(a.points ?? 0)
    }
  }
  return Object.entries(byTeam).map(([name, round_points]) => ({
    name, round_points: round_points + (mismatch ? 1 : 0), total_points: round_points + (mismatch ? 1 : 0),
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
      rosterLookup: async (memberCardId) => memberCardId === kyussCardId
        ? { name: 'Kyuss Lis', handicapIndex: null, ghin: 'test-ghin' }
        : null,
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

// ---------------- public-response shape ----------------
test('the normalized response exposes no raw GG payload (only the contract)', async () => {
  const snap = await makeSnapshot(1, makeFakeFourballClient())
  const json = JSON.stringify(snap)
  // No GG-internal field names leak into the public contract.
  for (const leak of ['hbh_match_status', 'points_summary_team_id', 'member_card_id_str', 'aggregates', 'scorecard_statuses', 'disposition']) {
    assert.ok(!json.includes(`"${leak}"`), `raw GG field "${leak}" must not leak into the response`)
  }
})
