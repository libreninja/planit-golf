import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  enrichIdentities,
  makeSupabaseRosterBatchLookup,
  type RosterBatchLookup,
} from '../lib/seattle-cup/identity.ts'
import type { MatchPlayer, SeattleCupRoundSnapshot } from '../lib/seattle-cup/types.ts'

function player(name: string, ggMemberCardId: string | null): MatchPlayer {
  return {
    name,
    ggMemberCardId,
    teamKey: null,
    ghin: null,
    identityStatus: name ? 'gg-only' : 'unresolved',
    courseHandicap: null,
    handicapDots: [],
    grossScores: [],
    netScores: [],
  }
}

function snapshot(playersA: MatchPlayer[], playersB: MatchPlayer[]): SeattleCupRoundSnapshot {
  return {
    round: 1,
    format: 'fourball',
    course: 'Test',
    eventName: 'Test',
    pairingsPublished: false,
    competitionMatchesAvailable: true,
    scheduledMatchesAvailable: true,
    competitionScopesAvailable: true,
    resultStatus: 'not-started',
    roundStatus: 'scheduled',
    fetchedAt: 0,
    showingLastKnown: false,
    matches: [{
      matchNo: 1,
      round: 1,
      format: 'fourball',
      course: 'Test',
      teamA: 'interbay',
      teamB: 'jackson-park',
      teamAIdentity: {
        source: 'member-card-team',
        pointsSummaryTeamId: null,
        pointsSummaryTeamKey: null,
        aggregateName: 'Interbay',
        aggregateNameTeamKey: 'interbay',
        affiliation: null,
        affiliationTeamKeys: [],
        memberTeamKeys: ['interbay'],
      },
      teamBIdentity: {
        source: 'conflict',
        pointsSummaryTeamId: null,
        pointsSummaryTeamKey: null,
        aggregateName: 'Jackson Park',
        aggregateNameTeamKey: 'jackson-park',
        affiliation: null,
        affiliationTeamKeys: [],
        memberTeamKeys: ['bill-wright'],
      },
      playersA,
      playersB,
      teeTime: null,
      startingHole: null,
      status: 'scheduled',
      matchState: 'all-square',
      leadSide: null,
      leadBy: 0,
      through: 'not-started',
      result: null,
      pointsA: null,
      pointsB: null,
      holes: [],
      sourceResult: null,
      derivedResult: null,
      validationStatus: 'tbd',
    }],
    pairingGroups: [],
    roundStandings: [],
    overallStandings: [],
    validationIssues: [{
      matchNo: 1,
      kind: 'team-identity-conflict',
      detail: 'preserve this diagnostic',
    }],
  } as SeattleCupRoundSnapshot
}

test('multiple unique member IDs are resolved through one batched lookup', async () => {
  const calls: string[][] = []
  const lookup: RosterBatchLookup = async (ids) => {
    calls.push([...ids])
    return new Map([
      ['card-a', { name: 'Roster A', handicapIndex: '4.2', ghin: 'ghin-a' }],
      ['card-b', { name: 'Roster B', handicapIndex: null }],
    ])
  }
  const value = snapshot(
    [player('GG A', 'card-a'), player('GG duplicate A', 'card-a')],
    [player('GG B', 'card-b'), player('No stable id', null)],
  )

  await enrichIdentities(value, lookup)

  assert.deepEqual(calls, [['card-a', 'card-b']], 'deduplicated IDs are passed in stable encounter order')
  assert.equal(value.matches[0]!.playersA[0]!.name, 'Roster A')
  assert.equal(value.matches[0]!.playersA[1]!.name, 'Roster A')
  assert.equal(value.matches[0]!.playersB[0]!.name, 'Roster B')
  assert.equal(value.matches[0]!.playersB[1]!.name, 'No stable id')
})

test('duplicate and null member IDs do not create duplicate lookup work', async () => {
  let calls = 0
  let requested: readonly string[] = []
  const value = snapshot(
    [player('One', 'same-card'), player('Two', 'same-card')],
    [player('No id', null)],
  )

  await enrichIdentities(value, async (ids) => {
    calls++
    requested = ids
    return new Map()
  })

  assert.equal(calls, 1)
  assert.deepEqual(requested, ['same-card'])
})

test('empty identity input performs no lookup', async () => {
  let calls = 0
  const value = snapshot([player('No id', null)], [])
  await enrichIdentities(value, async () => {
    calls++
    return new Map()
  })
  assert.equal(calls, 0)
})

test('missing roster identities preserve GG identity and team diagnostics', async () => {
  const value = snapshot([player('Authoritative GG Name', 'missing-card')], [])
  const beforeTeamIdentity = structuredClone(value.matches[0]!.teamAIdentity)
  const beforeConflict = structuredClone(value.validationIssues)

  await enrichIdentities(value, async () => new Map())

  assert.equal(value.matches[0]!.playersA[0]!.name, 'Authoritative GG Name')
  assert.equal(value.matches[0]!.playersA[0]!.identityStatus, 'gg-only')
  assert.deepEqual(value.matches[0]!.teamAIdentity, beforeTeamIdentity,
    'stable-member team precedence is outside roster enrichment and remains unchanged')
  assert.deepEqual(value.validationIssues, beforeConflict,
    'team conflict diagnostics remain unchanged')
})

test('Supabase roster lookup uses one IN query and maps requested IDs deterministically', async () => {
  const calls = { from: 0, select: 0, in: 0, order: 0 }
  let inValues: readonly string[] = []
  const rows = [
    { league_key: 'mens', member_card_id: 'card-a', name: 'First A', handicap_index: '2.0' },
    { league_key: 'womens', member_card_id: 'card-a', name: 'Second A', handicap_index: '3.0' },
    { league_key: 'mens', member_card_id: 'card-b', name: 'Player B', handicap_index: null },
  ]
  const builder = {
    select() { calls.select++; return builder },
    in(_column: string, values: readonly string[]) { calls.in++; inValues = values; return builder },
    order() { calls.order++; return Promise.resolve({ data: rows, error: null }) },
  }
  const supabase = {
    from() { calls.from++; return builder },
  } as unknown as SupabaseClient
  const lookup = makeSupabaseRosterBatchLookup(supabase)

  const entries = await lookup(['card-b', 'card-a', 'card-a', ''])

  assert.deepEqual(calls, { from: 1, select: 1, in: 1, order: 1 })
  assert.deepEqual(inValues, ['card-b', 'card-a'])
  assert.equal(entries.get('card-a')?.name, 'First A', 'first ordered league row wins deterministically')
  assert.equal(entries.get('card-b')?.name, 'Player B')
})

test('Supabase roster lookup skips the query for an empty ID list', async () => {
  let fromCalls = 0
  const lookup = makeSupabaseRosterBatchLookup({
    from() { fromCalls++; throw new Error('must not query') },
  } as unknown as SupabaseClient)

  assert.deepEqual(await lookup([]), new Map())
  assert.equal(fromCalls, 0)
})
