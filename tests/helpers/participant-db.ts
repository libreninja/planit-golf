import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createEventScoringService } from '../../lib/events/scoring.ts'
import { createGolfGeniusEventSyncService } from '../../lib/events/golf-genius-sync.ts'
import type { GolfGeniusEventSnapshot } from '../../lib/events/golf-genius-sync.ts'


const container = 'planit-wine-valley-scoring-test'
export const database = `wine_card_${randomUUID().replaceAll('-', '')}`
const root = new URL('../../', import.meta.url)
let created = false
export function sql(statement: string, db = database): Promise<string> {
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
    'read_event_scoring_state', 'issue_event_scorecard_access', 'revoke_event_scorecard_access',
    'read_participant_scorecard', 'record_participant_gross_score'].includes(name))
  const values = Object.entries(args).map(([key, value]) => {
    assert.match(key, /^p_[a-z_]+$/)
    const raw = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)
    const literal = value === null ? 'NULL' : typeof value === 'number' ? String(value)
      : `'${raw.replaceAll("'", "''")}'${typeof value === 'object' ? '::jsonb' : ''}`
    return `${key} => ${literal}`
  })
  try {
    const result = await sql(`SET ROLE service_role; SELECT to_jsonb(public.${name}(${values.join(',')}));`)
    return { data: result ? JSON.parse(result) : null, error: null }
  } catch (error) {
    const message = String(error)
    return { data: null, error: { code: message.match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1] ?? 'unknown', message } }
  }
}

export const db = { rpc } as unknown as Pick<SupabaseClient, 'rpc'>
export const sync = createGolfGeniusEventSyncService(db)
export const scoring = createEventScoringService(db)

export async function setup() {
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
  const fixture = JSON.parse(await readFile(new URL('fixtures/wine-valley/2026.json', root), 'utf8')) as GolfGeniusEventSnapshot
  const receipt = await sync.syncSnapshot(fixture)
  const state = (await scoring.readEvent(receipt.eventEditionId))!
  const round = state.rounds.find((r) => r.golfGeniusRoundId === '13048553139957950127')!
  const group = round.groups.find((g) => g.golfGeniusGroupId === '13048595300564887052')!
  return { state, round, group, scope: { eventEditionId: receipt.eventEditionId, roundId: round.id, groupId: group.id } }
}
export async function cleanup() {
  if (created) await sql(`DROP DATABASE ${database};`, 'postgres')
}
