import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createEventScoringService, projectEventGrossStandings } from '../lib/events/scoring.ts'
import type { EventScoringState, RecordGrossScore, ScoreReceipt } from '../lib/events/scoring.ts'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const command: RecordGrossScore = {
  eventEditionId: id(1), roundId: id(2), groupId: id(3), participantId: id(4),
  hole: 1, gross: 3, expectedRevision: 0, requestId: id(5),
}
const recorder = { actorRef: 'service:local-demo', source: 'manual' as const }
const mock = (rpc: unknown) => createEventScoringService({ rpc } as Pick<SupabaseClient, 'rpc'>)

test('service rejects malformed transport input before any persistence call', async () => {
  const service = mock(() => { assert.fail('must not call persistence') })
  for (const bad of [
    { gross: 0 }, { gross: 100 }, { gross: 3.5 }, { gross: NaN },
    { gross: '3' }, { hole: 0 }, { hole: 19 }, { hole: 1.5 },
    { expectedRevision: -1 }, { expectedRevision: 1.5 }, { expectedRevision: 2147483647 },
    { requestId: 'name-is-not-identity' }, { participantId: 'Bob' },
  ]) {
    await assert.rejects(service.recordGrossScore({ ...command, ...bad } as RecordGrossScore, recorder), { code: '22023' })
  }
  for (const actorRef of ['', '   ', 'x'.repeat(201)]) {
    await assert.rejects(service.recordGrossScore(command, { ...recorder, actorRef }), { code: '22023' })
  }
})

test('record delegates once to atomic operation with trusted recorder context', async () => {
  let calls = 0
  const receipt = { gross: 3, revision: 1 }
  const service = mock(async (name: string, args: Record<string, unknown>) => {
    calls++
    assert.equal(name, 'record_event_gross_score')
    assert.equal(args.p_participant_id, command.participantId)
    assert.equal(args.p_actor_ref, recorder.actorRef)
    assert.equal(args.p_source, 'manual')
    assert.equal(args.p_expected_revision, 0)
    return { data: receipt, error: null }
  })
  assert.deepEqual(await service.recordGrossScore(command, recorder), receipt)
  assert.equal(calls, 1)
})

test('read/write failures propagate; missing event alone returns null', async () => {
  for (const code of ['P1001', 'P1002', 'P1003', '42501', '42P01']) {
    const service = mock(async () => ({ data: null, error: { code, message: 'failed' } }))
    await assert.rejects(service.recordGrossScore(command, recorder), { code })
    await assert.rejects(service.readEvent(id(1)), { code })
  }
  const empty = mock(async () => ({ data: null, error: null }))
  assert.equal(await empty.readEvent(id(1)), null)
  await assert.rejects(empty.recordGrossScore(command, recorder), { code: 'unavailable' })
})

function state(): EventScoringState {
  return {
    edition: { id: id(1), seriesSlug: 'wine-valley-demo', name: 'Wine Valley demo', year: 2026,
      status: 'active', visibility: 'invite_only', startsOn: null, endsOn: null, locationName: null,
      golfGeniusEventId: null },
    participants: ['Bob', 'Tom', 'Luke'].map((name, n) => ({
      id: id(10 + n), golferId: id(20 + n), name, type: 'player', status: 'confirmed',
    })),
    rounds: [1, 2].map((n) => ({
      id: id(n + 30), number: n, name: `Round ${n}`, courseName: 'Fixture', startsOn: '2026-09-24',
      status: 'open', countsTowardCompetition: true, scoreAuthority: 'planit', golfGeniusRoundId: null,
      participantIds: [id(10), id(11), id(12)],
      holes: [{ hole: 1, par: 4 }, { hole: 2, par: 3 }],
      groups: [{ id: id(n + 40), name: '10:15', startsAt: '2026-09-24T17:15:00Z', startingHole: 1,
        golfGeniusGroupId: null,
        participantIds: [id(10), id(11), id(12)] }],
    })),
    scores: [],
  }
}
function score(round: number, participant: number, hole: number, gross: number): ScoreReceipt {
  return { request_id: id(99), event_edition_id: id(1), round_id: id(round + 30),
    group_id: id(round + 40), participant_id: id(participant + 10), golfer_id: id(participant + 20),
    hole, gross, previous_gross: null, revision: 1, actor_ref: recorder.actorRef,
    source: 'manual', recorded_at: '2026-09-24T17:20:00Z' }
}

test('projections distinguish missing from zero, rank ties, and isolate multi-round holes', () => {
  const input = state()
  input.scores = [score(1, 0, 1, 3), score(1, 1, 1, 3), score(2, 0, 2, 4)]
  const before = structuredClone(input)
  const view = projectEventGrossStandings(input)
  assert.ok(view.overall)
  assert.deepEqual(input, before)
  assert.equal(view.provisional, true)
  assert.deepEqual(view.rounds[0].entries.map((e) => e.positionLabel), ['T1', 'T1', null])
  const bob = view.rounds[0].scorecards[0]
  assert.equal(bob.memberCardId, null)
  assert.equal(bob.grossTotal, 3)
  assert.equal(bob.toParGross, -1)
  assert.equal(bob.holesCompleted, 1)
  assert.equal(bob.holes[1].gross, null)
  const luke = view.overall.scorecards.find((card) => card.name === 'Luke')!
  assert.equal(luke.grossTotal, null)
  assert.equal(luke.toParGross, null)
  const overallBob = view.overall.scorecards.find((card) => card.name === 'Bob')!
  assert.equal(overallBob.grossTotal, 7)
  assert.equal(overallBob.toParGross, 0)
  assert.deepEqual(overallBob.holes, [])
  assert.equal(view.overall.entries[0].name, 'Tom')
})

test('completion is based on the played-hole set; inactive participants are not ranked', () => {
  const input = state()
  input.participants[1].status = 'cancelled'
  input.participants[2].type = 'spectator'
  input.scores = [score(1, 0, 1, 4), score(1, 0, 2, 3)]
  const view = projectEventGrossStandings(input)
  assert.ok(view.overall)
  assert.equal(view.rounds[0].scorecards.length, 1)
  assert.equal(view.rounds[0].scorecards[0].scorecardStatus, 'completed')
  assert.equal(view.rounds[0].scorecards[0].isLive, false)
  assert.equal(view.overall.scorecards[0].holesCompleted, 2)
  assert.equal(view.overall.scorecards[0].isLive, true) // still has round 2 to play
})

test('competition inclusion is explicit, independent of chronology, names and trip membership', () => {
  const input = state()
  input.rounds[0].countsTowardCompetition = false
  input.rounds[0].name = 'Competition-looking upstream name'
  input.rounds[1].name = 'Replay-looking upstream name'
  input.rounds[1].groups[0].participantIds = [id(10), id(11)] // Luke is replay-only
  input.rounds[1].participantIds = [id(10), id(11)]
  input.scores = [score(1, 0, 1, 9), score(1, 2, 1, 1), score(2, 0, 1, 4)]
  const view = projectEventGrossStandings(input)
  assert.ok(view.overall)
  assert.equal(view.rounds[0].scorecards.length, 3)
  assert.equal(view.rounds[1].scorecards.length, 2)
  assert.equal(view.overall.scorecards.find((c) => c.name === 'Bob')!.grossTotal, 4)
  assert.equal(view.overall.scorecards.some((c) => c.name === 'Luke'), false)
})

test('GG-owned competition rounds make overall unavailable, never a native-only partial ranking', () => {
  const input = state()
  input.rounds[1].scoreAuthority = 'golf_genius'
  input.rounds[1].golfGeniusRoundId = 'existing-upstream-round'
  input.scores = [score(1, 0, 1, 3)]
  const view = projectEventGrossStandings(input)
  assert.equal(view.rounds.length, 1)
  assert.equal(view.overall, null)
  assert.deepEqual(view.unavailableRoundIds, [id(32)])
  input.rounds[1].countsTowardCompetition = false // unavailable replay is not competition
  assert.ok(projectEventGrossStandings(input).overall)
})
