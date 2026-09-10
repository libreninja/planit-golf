import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { cleanup, db, setup, sql } from '../helpers/participant-db.ts'
import { createParticipantScorecardService, scorecardTokenHash } from '../../lib/events/participant-scorecard.ts'

const service = createParticipantScorecardService(db)
let context: Awaited<ReturnType<typeof setup>>
let access: Awaited<ReturnType<typeof service.issue>>
before(async () => {
  context = await setup()
  access = await service.issue(context.scope, new Date(Date.now() + 3600_000))
})
after(cleanup)
const command = (extra = {}) => ({ ...context.scope, participantId: context.group.participantIds[0],
  hole: 1, gross: 3, expectedRevision: 0, requestId: randomUUID(), ...extra })

test('valid private link reads only the real Friday PM 12:30 foursome and stores only its digest', async () => {
  const card = await service.read(access.token)
  assert.equal(card.eventName, 'Wine Valley')
  assert.equal(card.roundName, 'FRIDAY AFTERNOON ROUND 1')
  assert.equal(card.startsAt, '2026-09-25T19:30:00+00:00')
  assert.equal(card.players.length, 4)
  assert.ok(card.players.some((p) => p.name === 'Josh Benner'))
  assert.deepEqual(card.players.map((p) => p.id).sort(), [...context.group.participantIds].sort())
  assert.equal(card.holes.length, 18)
  assert.equal(card.holes[0].par, 4)
  assert.doesNotMatch(JSON.stringify(card), /golfGenius|actor_ref|token_hash|memberCard|standings/)
  const stored = await sql(`SELECT row_to_json(a) FROM event_scorecard_access a WHERE id='${access.accessId}'`)
  assert.ok(stored.includes(scorecardTokenHash(access.token)))
  assert.equal(stored.includes(access.token), false)
})

test('entry, persisted reload, partial group, correction, retry, revision and capability provenance', async () => {
  const firstCommand = command()
  const first = await service.recordGrossScore(access.token, firstCommand)
  assert.equal(first.revision, 1)
  assert.equal(first.actor_ref, `scorecard:${access.accessId}`)
  assert.equal(first.source, 'manual')
  let card = await createParticipantScorecardService(db).read(access.token)
  assert.equal(card.scores.length, 1)
  assert.equal(card.scores[0].gross, 3)
  const corrected = await service.recordGrossScore(access.token, command({ gross: 4, expectedRevision: 1 }))
  assert.equal(corrected.revision, 2)
  assert.equal(corrected.previous_gross, 3)
  assert.deepEqual(await service.recordGrossScore(access.token, firstCommand), first)
  card = await service.read(access.token)
  assert.equal(card.scores[0].gross, 4)
  assert.equal(card.scores[0].revision, 2)
  assert.equal(await sql(`SELECT count(*) FROM event_hole_score_revisions WHERE round_id='${context.round.id}'`), '2')
})

test('scope is checked even for well-formed alternate event, round, group and participant IDs', async () => {
  const outsider = context.round.participantIds.find((id) => !context.group.participantIds.includes(id))!
  for (const extra of [{ eventEditionId: randomUUID() }, { roundId: context.state.rounds[0].id },
    { groupId: context.round.groups.find((g) => g.id !== context.group.id)!.id }, { participantId: outsider }]) {
    await assert.rejects(service.recordGrossScore(access.token, command(extra)), { code: 'P1011' })
  }
  const direct = await db.rpc('record_participant_gross_score', {
    p_token_hash: scorecardTokenHash(access.token), p_event_edition_id: context.scope.eventEditionId,
    p_round_id: context.scope.roundId, p_group_id: randomUUID(), p_participant_id: outsider,
    p_hole: 1, p_gross: 4, p_expected_revision: 0, p_request_id: randomUUID(),
  })
  assert.equal(direct.error?.code, 'P1011')
})

test('browser cannot inject recorder authority, extra arguments, coercible values or forged tokens', async () => {
  for (const extra of [{ actorRef: 'admin' }, { source: 'voice' }, { participantAccessHash: 'a'.repeat(64) },
    { gross: '4' }, { expectedRevision: 0.5 }]) {
    await assert.rejects(service.recordGrossScore(access.token, command(extra)), { code: '22023' })
  }
  for (const token of ['', 'a'.repeat(43), `${access.token.slice(0, -1)}!`]) {
    await assert.rejects(service.read(token), { code: 'P1010' })
  }
})

test('stale revision fails and simultaneous writes have one winner', async () => {
  await assert.rejects(service.recordGrossScore(access.token, command({ expectedRevision: 1 })), { code: 'P1002' })
  const results = await Promise.allSettled([3, 4].map((gross) => service.recordGrossScore(access.token, command({ hole: 2, gross }))))
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
  assert.equal(failed.reason.code, 'P1002')
})

test('expired link denies read and write', async () => {
  const expired = await service.issue(context.scope, new Date(Date.now() + 3600_000))
  await sql(`UPDATE event_scorecard_access SET created_at=clock_timestamp()-interval '2 hours',
    expires_at=clock_timestamp()-interval '1 hour' WHERE id='${expired.accessId}'`)
  await assert.rejects(service.read(expired.token), { code: 'P1010' })
  await assert.rejects(service.recordGrossScore(expired.token, command()), { code: 'P1010' })
})

test('revocation denies reads, new writes and replay of an acknowledged request', async () => {
  const revoked = await service.issue(context.scope, new Date(Date.now() + 3600_000))
  const input = command({ hole: 3 })
  await service.recordGrossScore(revoked.token, input)
  await service.revoke(revoked.accessId)
  await assert.rejects(service.read(revoked.token), { code: 'P1010' })
  await assert.rejects(service.recordGrossScore(revoked.token, input), { code: 'P1010' })
})

test('removed group membership immediately loses mutation authority', async () => {
  const participant = context.group.participantIds[0]
  await sql(`UPDATE event_round_participants SET source_active=false WHERE round_id='${context.round.id}' AND participant_id='${participant}'`)
  try {
    assert.equal((await service.read(access.token)).players.some((p) => p.id === participant), false)
    await assert.rejects(service.recordGrossScore(access.token, command({ hole: 4 })), { code: 'P1011' })
  } finally {
    await sql(`UPDATE event_round_participants SET source_active=true WHERE round_id='${context.round.id}' AND participant_id='${participant}'`)
  }
})

test('public database roles cannot read tokens, issue access, revoke, or bypass the service', async () => {
  const signatures = ['issue_event_scorecard_access(text,uuid,uuid,uuid,timestamptz)',
    'revoke_event_scorecard_access(uuid)', 'read_participant_scorecard(text)',
    'record_participant_gross_score(text,uuid,uuid,uuid,uuid,integer,integer,integer,uuid)']
  for (const role of ['anon', 'authenticated']) {
    for (const signature of signatures) assert.equal(await sql(`SELECT has_function_privilege('${role}','public.${signature}','EXECUTE')`), 'f')
    await assert.rejects(sql(`SET ROLE ${role}; SELECT * FROM public.event_scorecard_access`), /42501/)
  }
  await assert.rejects(sql('SET ROLE service_role; UPDATE event_scorecard_access SET group_id=gen_random_uuid()'), /42501/)
})
