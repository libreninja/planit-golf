// Requires ONLY the dedicated disposable container described in
// docs/wine-valley-scoring.md. No env files or production connection accepted.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createEventScoringService } from '../../lib/events/scoring.ts'
import { createGolfGeniusEventSyncService } from '../../lib/events/golf-genius-sync.ts'
import type { GolfGeniusEventSnapshot } from '../../lib/events/golf-genius-sync.ts'

const container = 'planit-wine-valley-scoring-test'
const database = `wine_sync_${randomUUID().replaceAll('-', '')}`
const root = new URL('../../', import.meta.url)
let created = false

function sql(statement: string, db = database): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile('docker', ['exec', '-i', container, 'psql', '-X', '-qAt',
      '-h', '/tmp', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'],
    { maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr))
      else resolve(stdout.trim())
    })
    child.stdin!.end(statement)
  })
}

const rpc = async (name: string, args: Record<string, unknown>) => {
  assert.ok(['sync_event_from_golf_genius', 'record_event_gross_score',
    'read_event_scoring_state'].includes(name))
  const values = Object.entries(args).map(([key, value]) => {
    assert.match(key, /^p_[a-z_]+$/)
    const raw = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)
    const literal = value === null ? 'NULL' : typeof value === 'number' ? String(value)
      : `'${raw.replaceAll("'", "''")}'${typeof value === 'object' ? '::jsonb' : ''}`
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

const db = { rpc } as unknown as Pick<SupabaseClient, 'rpc'>
const sync = createGolfGeniusEventSyncService(db)
const scoring = createEventScoringService(db)
const canonicalJoshId = '70000000-0000-4000-8000-000000000001'
let fixture: GolfGeniusEventSnapshot

before(async () => {
  await sql(`CREATE DATABASE ${database};`, 'postgres')
  created = true
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
    await sql(await readFile(new URL(name, dir), 'utf8'))
  }
  await sql(`
    INSERT INTO golfers(id, display_name) VALUES ('${canonicalJoshId}', 'Joshua Benner');
    INSERT INTO golfer_external_identities(golfer_id, source_system, scope_type, scope_key,
      external_id, display_name_snapshot, resolution_status, resolution_reason)
    VALUES ('${canonicalJoshId}', 'golf_genius', 'competition_season', 'igc-mens-2026',
      '2925267413723276873', 'Josh Benner', 'resolved', 'fixture_existing_identity');
  `)
  fixture = JSON.parse(await readFile(new URL('fixtures/wine-valley/2026.json', root), 'utf8')) as GolfGeniusEventSnapshot
})

after(async () => {
  if (created) await sql(`DROP DATABASE ${database};`, 'postgres')
})

test('real Wine Valley sync is idempotent and matches an existing canonical golfer by GG member card', async () => {
  const first = await sync.syncSnapshot(fixture)
  const initial = await scoring.readEvent(first.eventEditionId)
  assert.ok(initial)
  const second = await sync.syncSnapshot(fixture)
  const repeated = await scoring.readEvent(second.eventEditionId)

  assert.equal(first.eventEditionId, second.eventEditionId)
  assert.equal(initial.edition.golfGeniusEventId, '13048548030221936456')
  assert.equal(initial.edition.golfGeniusPortalId, 'gd6ebm')
  assert.equal(initial.participants.length, 33)
  assert.equal(initial.rounds.length, 4)
  assert.deepEqual(repeated, initial)

  const josh = initial.participants.find((participant) => participant.golfGeniusRosterId === '13048562246395913799')
  assert.equal(josh?.golferId, canonicalJoshId)
  assert.equal(josh?.name, 'Joshua Benner')
  assert.equal(josh?.golfGeniusDisplayName, 'Josh Benner')
})

test('unmatched GG roster entries become stable canonical golfers without account or name matching', async () => {
  const receipt = await sync.syncSnapshot(fixture)
  const event = await scoring.readEvent(receipt.eventEditionId)
  assert.ok(event)
  const landree = event.participants.find((participant) =>
    participant.golfGeniusMemberCardId === '11289750871795066802')
  assert.ok(landree?.golferId)
  assert.equal(landree.name, 'Landree Bower')
  assert.equal(landree.golfGeniusRosterId, '13048564464176096850')

  const repeated = await sync.syncSnapshot(fixture)
  const reread = await scoring.readEvent(repeated.eventEditionId)
  assert.equal(reread?.participants.find((participant) =>
    participant.golfGeniusMemberCardId === '11289750871795066802')?.golferId, landree.golferId)
})

test('real rounds retain explicit purpose, asymmetric participation and the unassigned Saturday player', async () => {
  const receipt = await sync.syncSnapshot(fixture)
  const event = await scoring.readEvent(receipt.eventEditionId)
  assert.ok(event)
  assert.deepEqual(event.rounds.map((round) => ({
    number: round.number,
    purpose: round.purpose,
    included: round.countsTowardCompetition,
    authority: round.scoreAuthority,
    participants: round.participantIds.length,
    groups: round.groups.length,
  })), [
    { number: 1, purpose: 'replay', included: false, authority: 'planit', participants: 12, groups: 4 },
    { number: 2, purpose: 'competition', included: true, authority: 'planit', participants: 28, groups: 7 },
    { number: 3, purpose: 'competition', included: true, authority: 'planit', participants: 33, groups: 8 },
    { number: 4, purpose: 'replay', included: false, authority: 'planit', participants: 8, groups: 2 },
  ])

  const john = event.participants.find((participant) => participant.golfGeniusDisplayName === 'John Casey')!
  const saturday = event.rounds[2]
  const membership = saturday.participations?.find((entry) => entry.participantId === john.id)
  assert.equal(membership?.groupId, null)
  assert.equal(membership?.competitionEligible, true)
  assert.equal(membership?.golfGeniusPlayerRoundId, '13051510346173408976')
  assert.equal(saturday.groups.some((group) => group.participantIds.includes(john.id)), false)

  const landree = event.participants.find((participant) => participant.golfGeniusDisplayName === 'Landree Bower')!
  assert.deepEqual(event.rounds.filter((round) => round.participantIds.includes(landree.id)).map((round) => round.number), [3])
})

test('a replay-only golfer remains visible in that round but is excluded from competition standings', async () => {
  const changed = structuredClone(fixture)
  const henryRosterId = '13048562577611712073'
  for (const round of changed.rounds.filter((entry) => entry.countsTowardCompetition)) {
    round.participations = round.participations.filter((entry) => entry.rosterId !== henryRosterId)
  }
  try {
    const receipt = await sync.syncSnapshot(changed)
    const event = await scoring.readEvent(receipt.eventEditionId)
    assert.ok(event?.standings.overall)
    const henry = event.participants.find((participant) => participant.golfGeniusDisplayName === 'Henry Mills')!
    assert.deepEqual(event.rounds.filter((round) => round.participantIds.includes(henry.id)).map((round) => round.number), [1])
    assert.equal(event.standings.rounds[0].scorecards.some((card) => card.key === henry.golferId), true)
    assert.equal(event.standings.overall.scorecards.some((card) => card.key === henry.golferId), false)
  } finally {
    await sync.syncSnapshot(fixture)
  }
})

test('later GG grouping and tee-time changes reconcile in place', async () => {
  const changed = structuredClone(fixture)
  const friday = changed.rounds[1]
  const joshRosterId = '13048562246395913799'
  const oldGroup = friday.groups[0]
  const newGroup = friday.groups[1]
  newGroup.name = '12:45 PM'
  newGroup.teeTime = '12:45 PM'
  friday.participations.find((entry) => entry.rosterId === joshRosterId)!.groupId = newGroup.groupId

  try {
    const beforeReceipt = await sync.syncSnapshot(fixture)
    const before = await scoring.readEvent(beforeReceipt.eventEditionId)
    const beforeRound = before!.rounds[1]
    const josh = before!.participants.find((participant) => participant.golfGeniusDisplayName === 'Josh Benner')!
    const stableGroupId = beforeRound.groups.find((group) => group.golfGeniusGroupId === newGroup.groupId)!.id

    await sync.syncSnapshot(changed)
    const after = await scoring.readEvent(beforeReceipt.eventEditionId)
    const afterRound = after!.rounds[1]
    const reconciled = afterRound.groups.find((group) => group.golfGeniusGroupId === newGroup.groupId)!
    assert.equal(reconciled.id, stableGroupId)
    assert.equal(reconciled.startsAt, '2026-09-25T19:45:00+00:00')
    assert.equal(reconciled.participantIds.includes(josh.id), true)
    assert.equal(afterRound.groups.find((group) => group.golfGeniusGroupId === oldGroup.groupId)!
      .participantIds.includes(josh.id), false)
  } finally {
    await sync.syncSnapshot(fixture)
  }
})

test('a Planit-owned score for a real Wine Valley group survives ordinary GG resync', async () => {
  const receipt = await sync.syncSnapshot(fixture)
  const before = await scoring.readEvent(receipt.eventEditionId)
  assert.ok(before)
  const friday = before.rounds.find((round) => round.golfGeniusRoundId === '13048553139957950127')!
  const group = friday.groups.find((entry) => entry.golfGeniusGroupId === '13048595300564887052')!
  const josh = before.participants.find((participant) => participant.golfGeniusDisplayName === 'Josh Benner')!
  assert.equal(group.participantIds.includes(josh.id), true)

  const scored = await scoring.recordGrossScore({
    eventEditionId: receipt.eventEditionId,
    roundId: friday.id,
    groupId: group.id,
    participantId: josh.id,
    hole: 1,
    gross: 3,
    expectedRevision: 0,
    requestId: randomUUID(),
  }, { actorRef: 'service:wine-valley-real-group-demo', source: 'manual' })
  assert.equal(scored.gross, 3)
  assert.equal(scored.revision, 1)

  await sync.syncSnapshot(fixture)
  const after = await scoring.readEvent(receipt.eventEditionId)
  const persisted = after!.scores.find((score) => score.request_id === scored.request_id)
  assert.deepEqual(persisted, scored)
  assert.equal(after!.rounds[1].groups.find((entry) => entry.id === group.id)?.startsAt,
    '2026-09-25T19:30:00+00:00')
  assert.equal(after!.standings.rounds.find((round) => round.occurrenceId === friday.id)
    ?.scorecards.find((card) => card.key === josh.golferId)?.holes[0].gross, 3)

  console.log(`Wine Valley demo: ${josh.golfGeniusDisplayName}, Friday PM 12:30 PM, hole 1 = 3; revision ${scored.revision} survived GG resync.`)
})

test('GG event roster references and sync mutation stay behind the service boundary', async () => {
  const signature = 'public.sync_event_from_golf_genius(jsonb)'
  for (const role of ['anon', 'authenticated']) {
    assert.equal(await sql(`SELECT has_function_privilege('${role}','${signature}','EXECUTE')`), 'f')
    assert.equal(await sql(`SELECT has_table_privilege('${role}',
      'public.event_participant_golf_genius_refs','SELECT')`), 'f')
    await assert.rejects(sql(`SET ROLE ${role}; SELECT * FROM event_participant_golf_genius_refs`), /42501/)
  }
})
