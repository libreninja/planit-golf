import { test } from 'node:test'
import assert from 'node:assert/strict'

import { ROUND_LIST, SEATTLE_CUP_EVENT, matchNoFor } from '../lib/seattle-cup/config.ts'
import {
  calculateSeattleCupTournamentResolution,
  validatePlayoffWinner,
  type SeattleCupResolutionInput,
} from '../lib/seattle-cup/resolution.ts'
import {
  isMissingPlayoffTable,
  saveSeattleCupPlayoffResult,
  type PlayoffStore,
  type SeattleCupPlayoffRecord,
} from '../lib/seattle-cup/playoff-store.ts'
import type { TeamKey } from '../lib/seattle-cup/types.ts'

type Points = Record<TeamKey, number>
type ResolutionMatch = SeattleCupResolutionInput['matches'][number]

function finalMatches(): ResolutionMatch[] {
  return ROUND_LIST.flatMap((round) => round.matchSlots.map((slot, index) => ({
    matchNo: matchNoFor(round.round, index),
    status: 'final' as const,
    teamA: slot.teamA,
    teamB: slot.teamB,
    pointsA: 1,
    pointsB: 0,
  })))
}

function input(points: Points, mutate: (matches: ResolutionMatch[]) => void = () => {}): SeattleCupResolutionInput[] {
  const matches = finalMatches()
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

function setHeadToHead(
  matches: ResolutionMatch[],
  first: TeamKey,
  second: TeamKey,
  outcomes: Array<TeamKey | 'halve'>,
): void {
  const relevant = matches.filter((match) =>
    (match.teamA === first && match.teamB === second)
    || (match.teamA === second && match.teamB === first),
  )
  assert.ok(relevant.length > 0)
  for (const [index, match] of relevant.entries()) {
    const outcome = outcomes[index] ?? 'halve'
    if (outcome === 'halve') {
      match.pointsA = 0.5
      match.pointsB = 0.5
    } else {
      match.pointsA = match.teamA === outcome ? 1 : 0
      match.pointsB = match.teamB === outcome ? 1 : 0
    }
  }
}

const UNIQUE: Points = {
  interbay: 24,
  'jackson-park': 20,
  'bill-wright': 10,
  'west-seattle': 6,
}

const TWO_TIED: Points = {
  interbay: 22,
  'jackson-park': 22,
  'bill-wright': 10,
  'west-seattle': 6,
}

test('unique final points leader wins with no tiebreak', () => {
  assert.deepEqual(calculateSeattleCupTournamentResolution(input(UNIQUE)), {
    status: 'points-winner',
    tiedTeamKeys: [],
    winnerTeamKey: 'interbay',
    method: 'points',
    headToHeadWins: null,
  })
})

test('exactly two teams tied: team A wins on head-to-head MATCH WINS', () => {
  const resolution = calculateSeattleCupTournamentResolution(input(TWO_TIED, (matches) => {
    setHeadToHead(matches, 'interbay', 'jackson-park', ['interbay', 'interbay', 'jackson-park'])
  }))
  assert.equal(resolution.status, 'head-to-head-winner')
  assert.equal(resolution.winnerTeamKey, 'interbay')
  assert.deepEqual(resolution.headToHeadWins, { interbay: 2, 'jackson-park': 1 })
})

test('exactly two teams tied: team B wins on head-to-head MATCH WINS', () => {
  const resolution = calculateSeattleCupTournamentResolution(input(TWO_TIED, (matches) => {
    setHeadToHead(matches, 'interbay', 'jackson-park', ['jackson-park', 'jackson-park', 'interbay'])
  }))
  assert.equal(resolution.status, 'head-to-head-winner')
  assert.equal(resolution.winnerTeamKey, 'jackson-park')
  assert.deepEqual(resolution.headToHeadWins, { interbay: 1, 'jackson-park': 2 })
})

test('two-team points tie plus equal head-to-head wins requires a playoff', () => {
  const resolution = calculateSeattleCupTournamentResolution(input(TWO_TIED, (matches) => {
    setHeadToHead(matches, 'interbay', 'jackson-park', ['interbay', 'jackson-park'])
  }))
  assert.equal(resolution.status, 'playoff-required')
  assert.equal(resolution.winnerTeamKey, null)
  assert.equal(resolution.method, 'fourball-playoff')
  assert.deepEqual(resolution.tiedTeamKeys, ['interbay', 'jackson-park'])
})

test('halved head-to-head matches do not count as wins', () => {
  const resolution = calculateSeattleCupTournamentResolution(input(TWO_TIED, (matches) => {
    setHeadToHead(matches, 'interbay', 'jackson-park', [])
  }))
  assert.equal(resolution.status, 'playoff-required')
  assert.deepEqual(resolution.headToHeadWins, { interbay: 0, 'jackson-park': 0 })
})

test('three teams tied on final points require a playoff directly', () => {
  const resolution = calculateSeattleCupTournamentResolution(input({
    interbay: 18,
    'jackson-park': 18,
    'bill-wright': 18,
    'west-seattle': 6,
  }))
  assert.equal(resolution.status, 'playoff-required')
  assert.deepEqual(resolution.tiedTeamKeys, ['interbay', 'jackson-park', 'bill-wright'])
  assert.equal(resolution.headToHeadWins, null)
})

test('four teams tied on final points require a playoff directly', () => {
  const resolution = calculateSeattleCupTournamentResolution(input({
    interbay: 15,
    'jackson-park': 15,
    'bill-wright': 15,
    'west-seattle': 15,
  }))
  assert.equal(resolution.status, 'playoff-required')
  assert.deepEqual(resolution.tiedTeamKeys, ['interbay', 'jackson-park', 'bill-wright', 'west-seattle'])
})

test('valid manual playoff winner becomes authoritative', () => {
  const snapshots = input(TWO_TIED, (matches) => setHeadToHead(matches, 'interbay', 'jackson-park', []))
  const resolution = calculateSeattleCupTournamentResolution(snapshots, {
    eventKey: SEATTLE_CUP_EVENT.key,
    tiedTeamKeys: ['interbay', 'jackson-park'],
    winnerTeamKey: 'jackson-park',
  })
  assert.equal(resolution.status, 'playoff-winner')
  assert.equal(resolution.winnerTeamKey, 'jackson-park')
  assert.equal(resolution.method, 'fourball-playoff')
})

test('reject playoff winner outside the unresolved tie', () => {
  const derived = calculateSeattleCupTournamentResolution(input(TWO_TIED, (matches) => {
    setHeadToHead(matches, 'interbay', 'jackson-park', [])
  }))
  assert.throws(() => validatePlayoffWinner(derived, 'bill-wright'), /must be one of the tied teams/)
})

test('reject manual playoff result when the rules do not require one', () => {
  const derived = calculateSeattleCupTournamentResolution(input(UNIQUE))
  assert.throws(() => validatePlayoffWinner(derived, 'interbay'), /only be recorded when/)
})

function memoryPlayoffStore(): PlayoffStore & { writes: number } {
  let record: SeattleCupPlayoffRecord | null = null
  return {
    writes: 0,
    async read() { return record },
    async save(value) {
      this.writes++
      const now = new Date().toISOString()
      record = {
        eventKey: SEATTLE_CUP_EVENT.key,
        season: SEATTLE_CUP_EVENT.season,
        ggEventId: SEATTLE_CUP_EVENT.ggEventId,
        tiedTeamKeys: value.tiedTeamKeys,
        winnerTeamKey: value.winnerTeamKey,
        notes: value.notes,
        resolvedAt: record?.resolvedAt ?? now,
        recordedByUserId: record?.recordedByUserId ?? value.actorUserId,
        createdAt: record?.createdAt ?? now,
        updatedByUserId: value.actorUserId,
        updatedAt: now,
      }
      return record
    },
  }
}

test('service records a valid manual playoff winner with rules-derived participants', async () => {
  const store = memoryPlayoffStore()
  const record = await saveSeattleCupPlayoffResult({
    snapshots: input(TWO_TIED, (matches) => setHeadToHead(matches, 'interbay', 'jackson-park', [])),
    winnerTeamKey: 'jackson-park',
    notes: 'Won on the second playoff hole',
    actorUserId: 'admin-1',
  }, store)
  assert.deepEqual(record.tiedTeamKeys, ['interbay', 'jackson-park'])
  assert.equal(record.winnerTeamKey, 'jackson-park')
  assert.equal(record.recordedByUserId, 'admin-1')
  assert.equal(store.writes, 1)
})

test('service rejects an outsider before persistence', async () => {
  const store = memoryPlayoffStore()
  await assert.rejects(saveSeattleCupPlayoffResult({
    snapshots: input(TWO_TIED, (matches) => setHeadToHead(matches, 'interbay', 'jackson-park', [])),
    winnerTeamKey: 'bill-wright',
    notes: null,
    actorUserId: 'admin-1',
  }, store), /must be one of the tied teams/)
  assert.equal(store.writes, 0)
})

test('service rejects a manual result for a rules-derived points winner', async () => {
  const store = memoryPlayoffStore()
  await assert.rejects(saveSeattleCupPlayoffResult({
    snapshots: input(UNIQUE),
    winnerTeamKey: 'interbay',
    notes: null,
    actorUserId: 'admin-1',
  }, store), /only be recorded when/)
  assert.equal(store.writes, 0)
})

test('service correction preserves the recorder and attributes the latest editor', async () => {
  const store = memoryPlayoffStore()
  const snapshots = input(TWO_TIED, (matches) => setHeadToHead(matches, 'interbay', 'jackson-park', []))
  await saveSeattleCupPlayoffResult({
    snapshots,
    winnerTeamKey: 'interbay',
    notes: null,
    actorUserId: 'admin-1',
  }, store)
  const corrected = await saveSeattleCupPlayoffResult({
    snapshots,
    winnerTeamKey: 'jackson-park',
    notes: 'Corrected from the signed playoff card',
    actorUserId: 'admin-2',
  }, store)
  assert.equal(corrected.winnerTeamKey, 'jackson-park')
  assert.equal(corrected.recordedByUserId, 'admin-1')
  assert.equal(corrected.updatedByUserId, 'admin-2')
  assert.equal(store.writes, 2)
})

test('an explicitly corrected playoff record replaces the previous winner', () => {
  const snapshots = input(TWO_TIED, (matches) => setHeadToHead(matches, 'interbay', 'jackson-park', []))
  const first = calculateSeattleCupTournamentResolution(snapshots, {
    eventKey: SEATTLE_CUP_EVENT.key,
    tiedTeamKeys: ['interbay', 'jackson-park'],
    winnerTeamKey: 'interbay',
  })
  const corrected = calculateSeattleCupTournamentResolution(snapshots, {
    eventKey: SEATTLE_CUP_EVENT.key,
    tiedTeamKeys: ['interbay', 'jackson-park'],
    winnerTeamKey: 'jackson-park',
  })
  assert.equal(first.winnerTeamKey, 'interbay')
  assert.equal(corrected.status, 'playoff-winner')
  assert.equal(corrected.winnerTeamKey, 'jackson-park')
})

test('no playoff record means no fabricated winner', () => {
  const resolution = calculateSeattleCupTournamentResolution(input(TWO_TIED, (matches) => {
    setHeadToHead(matches, 'interbay', 'jackson-park', [])
  }))
  assert.equal(resolution.status, 'playoff-required')
  assert.equal(resolution.winnerTeamKey, null)
})

test('R4 Singles contributes independent 1v1 matches, never tee-group opponents', () => {
  const r4InterbayJackson = new Set(
    ROUND_LIST[3]!.matchSlots
      .map((slot, index) => ({ slot, matchNo: matchNoFor(4, index) }))
      .filter(({ slot }) => new Set([slot.teamA, slot.teamB]).has('interbay')
        && new Set([slot.teamA, slot.teamB]).has('jackson-park'))
      .map(({ matchNo }) => matchNo),
  )
  assert.ok(r4InterbayJackson.size > 1, 'R4 contains multiple independent matches for this team pairing')

  const resolution = calculateSeattleCupTournamentResolution(input(TWO_TIED, (matches) => {
    setHeadToHead(matches, 'interbay', 'jackson-park', [])
    for (const match of matches) {
      if (!r4InterbayJackson.has(match.matchNo)) continue
      match.pointsA = match.teamA === 'interbay' ? 1 : 0
      match.pointsB = match.teamB === 'interbay' ? 1 : 0
    }
  }))
  assert.equal(resolution.status, 'head-to-head-winner')
  assert.equal(resolution.winnerTeamKey, 'interbay')
  assert.equal(resolution.headToHeadWins?.interbay, r4InterbayJackson.size)
  assert.equal(resolution.headToHeadWins?.['jackson-park'], 0)
})

test('incomplete competition remains active even if current standings have a leader', () => {
  const snapshots = input(UNIQUE)
  snapshots[0]!.matches[59]!.status = 'scheduled'
  snapshots[0]!.matches[59]!.pointsA = null
  snapshots[0]!.matches[59]!.pointsB = null
  assert.equal(calculateSeattleCupTournamentResolution(snapshots).status, 'active')
})

test('two-team tie stays unresolved when the normalized final match graph lacks authoritative points', () => {
  const snapshots = input(TWO_TIED, (matches) => setHeadToHead(matches, 'interbay', 'jackson-park', []))
  snapshots[0]!.matches[0]!.pointsA = null
  snapshots[0]!.matches[0]!.pointsB = null
  assert.equal(calculateSeattleCupTournamentResolution(snapshots).status, 'active')
})

test('rollout fallback recognizes only the missing-table/schema-cache conditions', () => {
  assert.equal(isMissingPlayoffTable({ code: '42P01' }), true)
  assert.equal(isMissingPlayoffTable({ code: 'PGRST205' }), true)
  assert.equal(isMissingPlayoffTable({
    message: 'Could not find the table \'public.seattle_cup_playoff_resolutions\' in the schema cache',
  }), true)

  // Unrelated database errors must never be swallowed.
  assert.equal(isMissingPlayoffTable({ code: '42501' }), false)
  assert.equal(isMissingPlayoffTable({ code: 'PGRST301' }), false)
  assert.equal(isMissingPlayoffTable({ message: 'JWT expired' }), false)
  assert.equal(isMissingPlayoffTable({ message: 'connection terminated unexpectedly' }), false)
  assert.equal(isMissingPlayoffTable({ message: 'duplicate key value violates unique constraint "seattle_cup_playoff_resolutions_pkey"' }), false)
  assert.equal(isMissingPlayoffTable({ message: 'relation "seattle_cup_other_table" does not exist' }), false)
  assert.equal(isMissingPlayoffTable({ message: 'does not exist' }), false)
})
