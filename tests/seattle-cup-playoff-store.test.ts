// Hardening contract for lib/seattle-cup/playoff-store.ts (PR #20 implementation):
//   READS  — null only for a genuine no-row result or the narrowly recognized
//            missing-table rollout condition on the ACTIVE backing table
//            (seattle_cup_tournament_results: 42P01 / PGRST205 / matching
//            schema-cache message). Every other persistence failure propagates —
//            a DB failure must never silently masquerade as "no playoff result".
//   WRITES — a production/server write must NEVER silently fall back to an
//            in-memory store; if the persistent store cannot be constructed or
//            reached, the write throws. Explicitly injected in-memory stores
//            (tests / explicit local development) remain fully supported.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  isMissingPlayoffTable,
  readSeattleCupPlayoffRecord,
  writeSeattleCupPlayoffRecord,
  deleteSeattleCupPlayoffRecord,
  makeSupabasePlayoffStore,
  makeMemoryPlayoffStore,
} from '../lib/seattle-cup/playoff-store.ts'
import { SEATTLE_CUP_EVENT_ID } from '../lib/seattle-cup/config.ts'
import type { SeattleCupPlayoffRecord } from '../lib/seattle-cup/resolution.ts'
import type { TeamKey } from '../lib/seattle-cup/types.ts'

const ACTIVE_TABLE = 'seattle_cup_tournament_results'

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

// Minimal supabase-js query-builder stub for the read path
// (.from().select().eq().eq().maybeSingle()).
function stubSupabase(result: { data: unknown; error: { code?: string; message: string } | null }) {
  const builder = {
    select() { return builder },
    eq() { return builder },
    maybeSingle: () => Promise.resolve(result),
  }
  return { from: () => builder }
}

// 1. Missing-table predicate -------------------------------------------------

test('predicate recognizes only active-table missing/schema-cache conditions', () => {
  assert.equal(isMissingPlayoffTable({ code: '42P01', message: `relation "public.${ACTIVE_TABLE}" does not exist` }), true)
  assert.equal(isMissingPlayoffTable({ code: 'PGRST205', message: `Could not find the table 'public.${ACTIVE_TABLE}' in the schema cache` }), true)
  assert.equal(isMissingPlayoffTable({
    message: `schema cache error: ${ACTIVE_TABLE} Could not find the table in the schema cache`,
  }), true)

  // Unrelated database errors must never be swallowed.
  assert.equal(isMissingPlayoffTable({ code: '42501', message: `permission denied for table ${ACTIVE_TABLE}` }), false)
  assert.equal(isMissingPlayoffTable({ code: 'PGRST301', message: 'JWT expired' }), false)
  assert.equal(isMissingPlayoffTable({ message: 'JWT expired' }), false)
  assert.equal(isMissingPlayoffTable({ message: 'connection terminated unexpectedly' }), false)
  assert.equal(isMissingPlayoffTable({ code: '23505', message: `duplicate key value violates unique constraint "${ACTIVE_TABLE}_pkey"` }), false)
  assert.equal(isMissingPlayoffTable({ code: '42P01', message: 'relation "seattle_cup_other_table" does not exist' }), false)
  assert.equal(isMissingPlayoffTable({ message: 'relation "some_other_table" does not exist' }), false)
  assert.equal(isMissingPlayoffTable({ message: 'does not exist' }), false)
})

// 2. DB-layer read paths through the public read function --------------------

test('no persisted playoff row reads as null', async () => {
  const store = readSeattleCupPlayoffRecord(makeSupabasePlayoffStore(
    stubSupabase({ data: null, error: null }) as unknown as SupabaseClient,
  ))
  assert.equal(await store, null)
})

test(`active table missing with PostgreSQL 42P01 reads as null (${ACTIVE_TABLE} named)`, async () => {
  const store = readSeattleCupPlayoffRecord(makeSupabasePlayoffStore(
    stubSupabase({ data: null, error: { code: '42P01', message: `relation "public.${ACTIVE_TABLE}" does not exist` } }) as unknown as SupabaseClient,
  ))
  assert.equal(await store, null)
})

test('active table missing with PostgREST PGRST205 reads as null', async () => {
  const store = readSeattleCupPlayoffRecord(makeSupabasePlayoffStore(
    stubSupabase({ data: null, error: { code: 'PGRST205', message: `Could not find the table 'public.${ACTIVE_TABLE}' in the schema cache` } }) as unknown as SupabaseClient,
  ))
  assert.equal(await store, null)
})

test('narrowly matched schema-cache error naming the active table reads as null', async () => {
  const store = readSeattleCupPlayoffRecord(makeSupabasePlayoffStore(
    stubSupabase({ data: null, error: { message: `Could not find the table 'public.${ACTIVE_TABLE}' in the schema cache` } }) as unknown as SupabaseClient,
  ))
  assert.equal(await store, null)
})

test('permission denied (42501) propagates — never masquerades as no-record', async () => {
  const store = readSeattleCupPlayoffRecord(makeSupabasePlayoffStore(
    stubSupabase({ data: null, error: { code: '42501', message: 'permission denied for table seattle_cup_tournament_results' } }) as unknown as SupabaseClient,
  ))
  await assert.rejects(store, /permission denied/)
})

test('auth/JWT failure (PGRST301) propagates', async () => {
  const store = readSeattleCupPlayoffRecord(makeSupabasePlayoffStore(
    stubSupabase({ data: null, error: { code: 'PGRST301', message: 'JWT expired' } }) as unknown as SupabaseClient,
  ))
  await assert.rejects(store, /JWT expired/)
})

test('network/connection failure propagates', async () => {
  const failing = {
    read: () => Promise.reject(new TypeError('fetch failed')),
    write: () => Promise.reject(new TypeError('fetch failed')),
    remove: () => Promise.reject(new TypeError('fetch failed')),
  }
  await assert.rejects(readSeattleCupPlayoffRecord(failing), /fetch failed/)
})

test('unrelated database error propagates', async () => {
  const store = readSeattleCupPlayoffRecord(makeSupabasePlayoffStore(
    stubSupabase({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } }) as unknown as SupabaseClient,
  ))
  await assert.rejects(store, /duplicate key/)
})

test('missing-table error referring to SOME OTHER table propagates', async () => {
  const store = readSeattleCupPlayoffRecord(makeSupabasePlayoffStore(
    stubSupabase({ data: null, error: { code: '42P01', message: 'relation "seattle_cup_other_table" does not exist' } }) as unknown as SupabaseClient,
  ))
  await assert.rejects(store, /other_table/)
})

test('db-backed read maps a row onto the playoff record shape', async () => {
  const store = makeSupabasePlayoffStore(
    stubSupabase({
      data: {
        competition_key: 'seattle-cup',
        season_year: 2026,
        gg_event_id: SEATTLE_CUP_EVENT_ID,
        winner_team_key: 'interbay',
        tied_team_keys: ['interbay', 'jackson-park'],
        notes: 'Sudden-death fourball, first hole',
        resolved_at: '2026-08-30T20:15:00.000Z',
        resolved_by: 'admin-user-id',
      },
      error: null,
    }) as unknown as SupabaseClient,
  )
  const record = await readSeattleCupPlayoffRecord(store)
  assert.equal(record?.winnerTeamKey, 'interbay')
  assert.deepEqual(record?.tiedTeamKeys, ['interbay', 'jackson-park'])
})

// 3. Writes: persistent store only; no silent in-memory fallback -------------

test('public write with persistence unavailable (no service key) throws — never a silent in-memory write', async () => {
  const hadUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const hadKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  delete process.env.NEXT_PUBLIC_SUPABASE_URL
  delete process.env.SUPABASE_SERVICE_ROLE_KEY
  try {
    await assert.rejects(
      writeSeattleCupPlayoffRecord(playoffRecord('interbay', ['interbay', 'jackson-park'])),
      /persistence unavailable/i,
    )
  } finally {
    if (hadUrl != null) process.env.NEXT_PUBLIC_SUPABASE_URL = hadUrl
    if (hadKey != null) process.env.SUPABASE_SERVICE_ROLE_KEY = hadKey
  }
})

test('public delete with persistence unavailable (no service key) throws', async () => {
  const hadUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const hadKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  delete process.env.NEXT_PUBLIC_SUPABASE_URL
  delete process.env.SUPABASE_SERVICE_ROLE_KEY
  try {
    await assert.rejects(deleteSeattleCupPlayoffRecord(), /persistence unavailable/i)
  } finally {
    if (hadUrl != null) process.env.NEXT_PUBLIC_SUPABASE_URL = hadUrl
    if (hadKey != null) process.env.SUPABASE_SERVICE_ROLE_KEY = hadKey
  }
})

test('public read with persistence unavailable (no service key) propagates the construction failure', async () => {
  const hadUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const hadKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  delete process.env.NEXT_PUBLIC_SUPABASE_URL
  delete process.env.SUPABASE_SERVICE_ROLE_KEY
  try {
    await assert.rejects(readSeattleCupPlayoffRecord(), /persistence unavailable/i)
  } finally {
    if (hadUrl != null) process.env.NEXT_PUBLIC_SUPABASE_URL = hadUrl
    if (hadKey != null) process.env.SUPABASE_SERVICE_ROLE_KEY = hadKey
  }
})

// 4. Explicit injected memory store (tests / explicit local development) -----

test('explicitly injected memory store round-trips a playoff record', async () => {
  const { store } = makeMemoryPlayoffStore()
  const record = playoffRecord('interbay', ['interbay', 'jackson-park'])
  await writeSeattleCupPlayoffRecord(record, store)
  assert.deepEqual(await readSeattleCupPlayoffRecord(store), record)
  await deleteSeattleCupPlayoffRecord(store)
  assert.equal(await readSeattleCupPlayoffRecord(store), null)
})