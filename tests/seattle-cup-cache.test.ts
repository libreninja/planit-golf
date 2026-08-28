import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  makeSupabaseSeattleCupCacheStore,
  SeattleCupCacheError,
} from '../lib/seattle-cup/cache.ts'
import type { SeattleCupRoundSnapshot } from '../lib/seattle-cup/types.ts'

function readSupabase(result: { data: unknown; error: { code?: string; message: string } | null }) {
  const builder = {
    select() { return builder },
    eq() { return builder },
    gt() { return builder },
    maybeSingle: () => Promise.resolve(result),
  }
  return { from: () => builder } as unknown as SupabaseClient
}

test('Supabase cache returns null only for an ordinary no-row miss', async () => {
  const store = makeSupabaseSeattleCupCacheStore(readSupabase({ data: null, error: null }))
  assert.equal(await store.readFresh({ round: 1 }), null)
})

test('Supabase cache read failure is distinct from an ordinary miss', async () => {
  const store = makeSupabaseSeattleCupCacheStore(readSupabase({
    data: null,
    error: { code: 'PGRST301', message: 'JWT and sensitive request detail' },
  }))

  await assert.rejects(
    store.readFresh({ round: 1 }),
    (error: unknown) => {
      assert.ok(error instanceof SeattleCupCacheError)
      assert.equal(error.operation, 'read-fresh')
      assert.equal(error.code, 'PGRST301')
      assert.ok(!error.message.includes('sensitive request detail'))
      return true
    },
  )
})

test('Supabase cache write errors are surfaced with sanitized diagnostics', async () => {
  const supabase = {
    from: () => ({
      upsert: () => Promise.resolve({
        error: { code: '08006', message: 'connection string and sensitive detail' },
      }),
    }),
  } as unknown as SupabaseClient
  const store = makeSupabaseSeattleCupCacheStore(supabase)

  await assert.rejects(
    store.write({ round: 1 }, { resultStatus: 'live' } as SeattleCupRoundSnapshot),
    (error: unknown) => {
      assert.ok(error instanceof SeattleCupCacheError)
      assert.equal(error.operation, 'write')
      assert.equal(error.code, '08006')
      assert.ok(!error.message.includes('sensitive detail'))
      return true
    },
  )
})
