// Requires ONLY the dedicated disposable container described in
// docs/wine-valley-scoring.md. No env files or production connection accepted.
import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createEventScoringService } from '../../lib/events/scoring.ts'
import type { RecordGrossScore } from '../../lib/events/scoring.ts'

const container = 'planit-wine-valley-scoring-test'
const database = `scoring_${randomUUID().replaceAll('-', '')}`
const root = new URL('../../', import.meta.url)
let created = false

function sql(statement: string, db = database): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile('docker', ['exec', '-i', container, 'psql', '-X', '-qAt',
      '-h', '/tmp', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'],
    { maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr))
      else resolve(stdout.trim())
    })
    child.stdin!.end(statement)
  })
}

// A SQL transport for the same service RPC calls, against the real functions
// as service_role. This does not fake their validation, transactions or storage.
const rpc = async (name: string, args: Record<string, unknown>) => {
  assert.ok(['record_event_gross_score', 'read_event_scoring_state'].includes(name))
  const values = Object.entries(args).map(([key, value]) => {
    assert.match(key, /^p_[a-z_]+$/)
    const literal = value === null ? 'NULL' : typeof value === 'number' ? String(value)
      : `'${String(value).replaceAll("'", "''")}'`
    return `${key} => ${literal}`
  })
  try {
    const result = await sql(`SET ROLE service_role; SELECT public.${name}(${values.join(',')});`)
    return { data: result ? JSON.parse(result) : null, error: null }
  } catch (error) {
    const message = String(error)
    return { data: null, error: { code: message.match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1] ?? 'unknown', message } }
  }
}
const service = createEventScoringService({ rpc } as unknown as Pick<SupabaseClient, 'rpc'>)
const eventId = '10000000-0000-4000-8000-000000000001'
const roundId = '20000000-0000-4000-8000-000000000002'
const groupId = '30000000-0000-4000-8000-000000000002'
const bobId = '50000000-0000-4000-8000-000000000001'
const tomId = '50000000-0000-4000-8000-000000000002'
const recorder = { actorRef: 'service:wine-valley-local-demo', source: 'manual' as const }
function command(overrides: Partial<RecordGrossScore> = {}): RecordGrossScore {
  return { eventEditionId: eventId, roundId, groupId, participantId: bobId,
    hole: 1, gross: 3, expectedRevision: 0, requestId: randomUUID(), ...overrides }
}

before(async () => {
  await sql(`CREATE DATABASE ${database};`, 'postgres')
  created = true
  // Minimal Supabase platform contracts, with realistic default public grants.
  // ALL actual Planit migrations are applied unmodified, in filename order.
  await sql(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
    END $$;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz,
      raw_user_meta_data jsonb DEFAULT '{}');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('request.jwt.claim.role',true) $$;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    CREATE PUBLICATION supabase_realtime;
  `)
  const dir = new URL('supabase/migrations/', root)
  for (const name of (await readdir(dir)).filter((name) => name.endsWith('.sql')).sort()) {
    // Prove old account-only participant rows survive the additive migration.
    if (name === '20260910000000_event_gross_scoring.sql') {
      await sql(`
        INSERT INTO auth.users(id,email) VALUES ('90000000-0000-4000-8000-000000000001','legacy@example.test');
        INSERT INTO event_series(id,slug,name) VALUES ('90000000-0000-4000-8000-000000000002','legacy-fixture','Legacy');
        INSERT INTO event_editions(id,event_series_id,year) VALUES ('90000000-0000-4000-8000-000000000003','90000000-0000-4000-8000-000000000002',2026);
        INSERT INTO event_participants(id,event_edition_id,user_id) VALUES ('90000000-0000-4000-8000-000000000004','90000000-0000-4000-8000-000000000003','90000000-0000-4000-8000-000000000001');
      `)
    }
    await sql(await readFile(new URL(name, dir), 'utf8'))
  }
  await sql(await readFile(new URL('tests/fixtures/wine-valley.sql', root), 'utf8'))
})

after(async () => {
  if (created) await sql(`DROP DATABASE ${database};`, 'postgres')
})

test('Wine Valley service flow persists independent facts, corrects, retries, reads and projects', async () => {
  const initial = await service.readEvent(eventId)
  assert.ok(initial)
  assert.equal(initial.rounds.length, 4)
  assert.deepEqual(initial.rounds.map((r) => r.groups[0].participantIds.length), [6, 4, 4, 5])
  assert.deepEqual(initial.rounds.map((r) => r.countsTowardCompetition), [false, true, true, false])
  assert.equal(initial.rounds[1].groups[0].startsAt, '2026-09-25T20:15:00+00:00')
  assert.equal(initial.edition.golfGeniusEventId, 'fixture-upstream-event')
  assert.equal(initial.scores.length, 0)
  assert.equal(await sql(`SELECT count(*) FROM event_participants WHERE event_edition_id='${eventId}' AND user_id IS NULL`), '6')
  assert.equal(await sql('SELECT count(*) FROM golfer_external_identities'), '0')
  assert.equal(await sql("SELECT count(*) FROM event_participants WHERE user_id='90000000-0000-4000-8000-000000000001' AND golfer_id IS NULL"), '1')

  const bobBirdie = command()
  const first = await service.recordGrossScore(bobBirdie, recorder)
  assert.equal(first.gross, 3)
  assert.equal(first.previous_gross, null)
  assert.equal(first.revision, 1)
  assert.equal(first.golfer_id, '40000000-0000-4000-8000-000000000001')
  assert.ok(Number.isFinite(Date.parse(first.recorded_at)))
  await service.recordGrossScore(command({ participantId: tomId, gross: 5 }), recorder)
  const corrected = await service.recordGrossScore(command({ gross: 4, expectedRevision: 1 }), recorder)
  assert.equal(corrected.previous_gross, 3)
  assert.equal(corrected.revision, 2)
  assert.equal(corrected.actor_ref, recorder.actorRef)
  assert.equal(corrected.source, 'manual')
  assert.deepEqual(await service.recordGrossScore(bobBirdie, recorder), first)
  await assert.rejects(service.recordGrossScore({ ...bobBirdie, gross: 6 }, recorder), { code: 'P1003' })
  await assert.rejects(service.recordGrossScore(command({ gross: 6, expectedRevision: 1 }), recorder), { code: 'P1002' })

  const read = await service.readEvent(eventId)
  assert.ok(read)
  assert.equal(read.scores.length, 2)
  assert.equal(read.scores.find((s) => s.participant_id === bobId)!.gross, 4)
  const cards = read.standings.rounds[1].scorecards
  assert.deepEqual(cards.map((c) => [c.name, c.grossTotal, c.toParGross, c.holesCompleted]),
    [['Bob', 4, 0, 1], ['Tom', 5, 1, 1], ['Luke', null, null, 0], ['Jamie', null, null, 0]])
  assert.equal(await sql('SELECT count(*) FROM event_hole_score_revisions'), '3')
  assert.equal(await sql('SELECT count(*) FROM igc_league_performances'), '0')
  console.log('Wine Valley: Bob 3 -> corrected 4 (E thru 1); Tom 5 (+1 thru 1); 3 durable revisions; no GG identity/account needed.')
})

test('invalid event, round, group, participant, hole and lifecycle never write', async () => {
  const beforeCount = await sql('SELECT count(*) FROM event_hole_score_revisions')
  for (const invalid of [
    { eventEditionId: '10000000-0000-4000-8000-000000000002' },
    { roundId: '20000000-0000-4000-8000-000000000001' },
    { groupId: '30000000-0000-4000-8000-000000000001' },
    { participantId: randomUUID() }, { hole: 10 },
  ]) await assert.rejects(service.recordGrossScore(command({ hole: 2, ...invalid }), recorder), { code: 'P1001' })
  for (const [table, column, value, restore, target] of [
    ['event_editions', 'status', 'archived', 'active', eventId],
    ['event_rounds', 'score_authority', 'golf_genius', 'planit', roundId],
    ['event_rounds', 'status', 'closed', 'open', roundId],
    ['event_participants', 'status', 'cancelled', 'confirmed', bobId],
    ['event_participants', 'status', 'invited', 'confirmed', bobId],
    ['event_participants', 'participant_type', 'spectator', 'player', bobId],
  ]) {
    await sql(`UPDATE ${table} SET ${column}='${value}' WHERE id='${target}'`)
    try {
      await assert.rejects(service.recordGrossScore(command({ hole: 2 }), recorder), { code: 'P1001' })
      if (column === 'score_authority') {
        const read = (await service.readEvent(eventId))!
        assert.equal(read.standings.overall, null)
        assert.deepEqual(read.standings.unavailableRoundIds, [roundId])
      }
    } finally {
      await sql(`UPDATE ${table} SET ${column}=${restore === null ? 'NULL' : `'${restore}'`} WHERE id='${target}'`)
    }
  }
  assert.equal(await sql('SELECT count(*) FROM event_hole_score_revisions'), beforeCount)
  assert.equal(await service.readEvent(randomUUID()), null)
})

test('database constraints reject cross-edition membership and identity reassignment after scoring', async () => {
  await assert.rejects(sql(`UPDATE event_round_participants SET event_edition_id='10000000-0000-4000-8000-000000000002' WHERE participant_id='${bobId}'`), /23503/)
  await assert.rejects(sql(`UPDATE event_participants SET golfer_id=NULL WHERE id='${bobId}'`), /23514/)
  const otherGolfer = randomUUID()
  await sql(`INSERT INTO golfers(id,display_name) VALUES ('${otherGolfer}','Different golfer')`)
  await assert.rejects(sql(`UPDATE event_participants SET golfer_id='${otherGolfer}' WHERE id='${bobId}'`), /23503/)
  await assert.rejects(sql(`DELETE FROM event_participants WHERE id='${bobId}'`), /23503/)
})

test('concurrent first scores and corrections have one winner; duplicate delivery is idempotent', async () => {
  for (const expectedRevision of [0, 1]) {
    const results = await Promise.allSettled([3, 4].map((gross) =>
      service.recordGrossScore(command({ hole: 2, gross, expectedRevision }), recorder)))
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    assert.equal(rejected.reason.code, 'P1002')
  }
  const duplicate = command({ hole: 3 })
  const receipts = await Promise.all([service.recordGrossScore(duplicate, recorder), service.recordGrossScore(duplicate, recorder)])
  assert.deepEqual(receipts[0], receipts[1])
  assert.equal(await sql(`SELECT count(*) FROM event_hole_score_revisions WHERE round_id='${roundId}' AND hole=2`), '2')
  assert.equal(await sql(`SELECT count(*) FROM event_hole_score_revisions WHERE request_id='${duplicate.requestId}'`), '1')
})

test('second competition round and imported provenance use the same operation', async () => {
  const receipt = await service.recordGrossScore(command({
    roundId: '20000000-0000-4000-8000-000000000003',
    groupId: '30000000-0000-4000-8000-000000000003', gross: 5,
  }), { actorRef: 'service:fixture-import', source: 'import' })
  assert.equal(receipt.source, 'import')
  assert.equal(receipt.revision, 1)
  const read = (await service.readEvent(eventId))!
  assert.equal(read.standings.rounds[1].scorecards[0].holes[0].gross, 4)
  assert.equal(read.standings.rounds[2].scorecards[0].holes[0].gross, 5)
  assert.deepEqual(read.standings.overall!.scorecards[0].holes, [])
})

test('replay-only trip participants can score their rounds without entering competition', async () => {
  const ameliaId = '50000000-0000-4000-8000-000000000005'
  const taylorId = '50000000-0000-4000-8000-000000000006'
  const beforeStandings = (await service.readEvent(eventId))!.standings.overall
  await assert.rejects(service.recordGrossScore(command({ participantId: ameliaId }), recorder), { code: 'P1001' })
  for (const participantId of [ameliaId, taylorId, bobId]) {
    await service.recordGrossScore(command({ participantId,
      roundId: '20000000-0000-4000-8000-000000000001',
      groupId: '30000000-0000-4000-8000-000000000001', gross: 3,
    }), recorder)
  }
  await service.recordGrossScore(command({ participantId: ameliaId,
    roundId: '20000000-0000-4000-8000-000000000004',
    groupId: '30000000-0000-4000-8000-000000000004', gross: 5,
  }), recorder)
  await assert.rejects(service.recordGrossScore(command({ participantId: taylorId,
    roundId: '20000000-0000-4000-8000-000000000004',
    groupId: '30000000-0000-4000-8000-000000000004',
  }), recorder), { code: 'P1001' })
  const read = (await service.readEvent(eventId))!
  assert.deepEqual(read.standings.overall, beforeStandings)
  assert.equal(read.standings.rounds[0].scorecards.find((c) => c.name === 'Amelia')!.grossTotal, 3)
  assert.equal(read.standings.overall!.scorecards.some((c) => ['Amelia', 'Taylor'].includes(c.name)), false)
})

test('real roles deny public reads/operations and all direct service score mutations', async () => {
  const signature = 'public.record_event_gross_score(uuid,uuid,uuid,uuid,integer,integer,integer,uuid,text,text)'
  for (const role of ['anon', 'authenticated']) {
    assert.equal(await sql(`SELECT has_function_privilege('${role}','${signature}','EXECUTE')`), 'f')
    await assert.rejects(sql(`SET ROLE ${role}; SELECT public.read_event_scoring_state('${eventId}')`), /42501/)
    for (const table of ['event_rounds', 'event_round_holes', 'event_round_groups', 'event_round_participants', 'event_hole_score_revisions']) {
      await assert.rejects(sql(`SET ROLE ${role}; SELECT * FROM ${table}`), /42501/)
      assert.equal(await sql(`SELECT relrowsecurity FROM pg_class WHERE oid='public.${table}'::regclass`), 't')
    }
  }
  for (const operation of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
    assert.equal(await sql(`SELECT has_table_privilege('service_role','public.event_hole_score_revisions','${operation}')`), 'f')
  }
  await assert.rejects(sql('SET ROLE service_role; UPDATE event_hole_score_revisions SET gross=9'), /42501/)
  await assert.rejects(sql('SET ROLE service_role; DELETE FROM event_hole_score_revisions'), /42501/)
})

test('SQL operation validates inputs even if the TypeScript boundary is bypassed', async () => {
  for (const bad of ['p_gross => 0', 'p_gross => 100', 'p_source => NULL', "p_actor_ref => ' '",
    'p_hole => NULL', 'p_expected_revision => -1', 'p_request_id => NULL']) {
    const args: Record<string, string> = {
      p_event_edition_id: `'${eventId}'`, p_round_id: `'${roundId}'`, p_group_id: `'${groupId}'`,
      p_participant_id: `'${bobId}'`, p_hole: '4', p_gross: '3', p_expected_revision: '0',
      p_request_id: `'${randomUUID()}'`, p_actor_ref: "'service:test'", p_source: "'manual'",
    }
    const [key, value] = bad.split(' => ')
    args[key] = value
    await assert.rejects(sql(`SET ROLE service_role; SELECT public.record_event_gross_score(${Object.entries(args).map(([k,v]) => `${k} => ${v}`).join(',')})`), /22023/)
  }
})

test('round participation can be represented before tee-group assignment', async () => {
  const jamieId = '50000000-0000-4000-8000-000000000004'
  await sql(`UPDATE event_round_participants SET group_id=NULL WHERE round_id='${roundId}' AND participant_id='${jamieId}'`)
  const read = (await service.readEvent(eventId))!
  const round = read.rounds.find((r) => r.id === roundId)!
  assert.equal(round.participantIds.includes(jamieId), true)
  assert.equal(round.groups.some((g) => g.participantIds.includes(jamieId)), false)
  assert.equal(read.standings.rounds.find((r) => r.occurrenceId === roundId)!.scorecards.some((c) => c.name === 'Jamie'), true)
  await assert.rejects(service.recordGrossScore(command({ participantId: jamieId }), recorder), { code: 'P1001' })
  await sql(`UPDATE event_round_participants SET group_id='${groupId}' WHERE round_id='${roundId}' AND participant_id='${jamieId}'`)
  assert.equal((await service.recordGrossScore(command({ participantId: jamieId }), recorder)).gross, 3)
})
