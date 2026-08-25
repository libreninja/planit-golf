// Seattle Cup live-result cache. Reuses the shared competition_live_cache table
// + the resultsCacheKey scheme + makeSingleFlight (imported from
// lib/competition), but typed to SeattleCupRoundSnapshot (the league cache is
// typed to the stroke-play LiveResponse). Tenant key 'seattle-cup' isolates
// these rows from the league caches. Same resilience contract as the league
// cache: short TTL fresh reads, single-flight per round, stale-while-error
// (serve the most recent row — even expired — with showingLastKnown=true on
// upstream failure). See ground-truth report §6 + lib/competition/cache.ts.

import { makeSingleFlight } from '../competition/cache.ts'
import { resultsCacheKey } from '../competition/cache-keys.ts'
import type { SeattleCupRoundSnapshot } from './types.ts'
import type { RoundNumber } from './types.ts'

const TTL_SECONDS = 60

export interface SeattleCupCacheArgs {
  round: RoundNumber
}

function keyOf(args: SeattleCupCacheArgs): string {
  return resultsCacheKey({
    tenantKey: 'seattle-cup',
    competitionKey: 'seattle-cup',
    occurrenceId: `round-${args.round}`,
    scoring: 'match',
  })
}

// Injectable DB layer (real = service client; tests inject an in-memory store).
export interface SeattleCupCacheStore {
  readFresh(args: SeattleCupCacheArgs): Promise<SeattleCupRoundSnapshot | null>
  readStale(args: SeattleCupCacheArgs): Promise<SeattleCupRoundSnapshot | null>
  write(args: SeattleCupCacheArgs, payload: SeattleCupRoundSnapshot): Promise<void>
}

export function makeMemorySeattleCupStore(): { store: SeattleCupCacheStore; rows: Map<string, { payload: SeattleCupRoundSnapshot; expiresAt: number; fetchedAt: number }> } {
  const rows = new Map<string, { payload: SeattleCupRoundSnapshot; expiresAt: number; fetchedAt: number }>()
  const k = (a: SeattleCupCacheArgs) => keyOf(a)
  return {
    rows,
    store: {
      async readFresh(a) {
        const r = rows.get(k(a))
        if (!r || r.expiresAt <= Date.now()) return null
        return r.payload
      },
      async readStale(a) {
        const r = rows.get(k(a))
        return r?.payload ?? null
      },
      async write(a, payload) {
        rows.set(k(a), { payload, fetchedAt: Date.now(), expiresAt: Date.now() + TTL_SECONDS * 1000 })
      },
    },
  }
}

// Resolve the cache store: injected (tests) → DB-backed → in-memory fallback.
// The cache is an optimization, never a hard dependency. If the service client
// can't be constructed (e.g. no service-role key in local dev) or any DB op
// throws, we degrade to an in-memory store so the endpoint still serves fresh
// data — just without cross-request persistence. See ground-truth report §6.
let _dbStore: SeattleCupCacheStore | null = null
let _memFallback: SeattleCupCacheStore | null = null
function memFallbackStore(): SeattleCupCacheStore {
  if (_memFallback) return _memFallback
  const rows = new Map<string, { payload: SeattleCupRoundSnapshot; expiresAt: number }>()
  _memFallback = {
    async readFresh(a) {
      const r = rows.get(keyOf(a))
      if (!r || r.expiresAt <= Date.now()) return null
      return r.payload
    },
    async readStale(a) { return rows.get(keyOf(a))?.payload ?? null },
    async write(a, payload) {
      rows.set(keyOf(a), { payload, expiresAt: Date.now() + TTL_SECONDS * 1000 })
    },
  }
  return _memFallback
}

async function dbStore(): Promise<SeattleCupCacheStore> {
  if (_dbStore) return _dbStore
  try {
    const { createServiceClient } = await import('../supabase/service.ts')
    const supabase = createServiceClient()
    const table = 'competition_live_cache'
    _dbStore = {
      async readFresh(a) {
        try {
          const { data } = await supabase.from(table).select('payload, expires_at')
            .eq('cache_key', keyOf(a)).gt('expires_at', new Date().toISOString()).maybeSingle()
          return (data?.payload as SeattleCupRoundSnapshot | undefined) ?? null
        } catch { return null }
      },
      async readStale(a) {
        try {
          const { data } = await supabase.from(table).select('payload, fetched_at')
            .eq('cache_key', keyOf(a)).order('fetched_at', { ascending: false }).limit(1).maybeSingle()
          return (data?.payload as SeattleCupRoundSnapshot | undefined) ?? null
        } catch { return null }
      },
      async write(a, payload) {
        try {
          const now = new Date()
          await supabase.from(table).upsert({
            cache_key: keyOf(a),
            tenant_key: 'seattle-cup',
            competition_key: 'seattle-cup',
            occurrence_id: `round-${a.round}`,
            scope: 'results',
            scoring: 'match',
            payload: payload as unknown as Record<string, unknown>,
            result_status: payload.resultStatus,
            fetched_at: now.toISOString(),
            expires_at: new Date(now.getTime() + TTL_SECONDS * 1000).toISOString(),
          })
        } catch { /* best-effort */ }
      },
    }
    return _dbStore
  } catch {
    // No service-role key / client misconfigured → degrade to in-memory.
    return memFallbackStore()
  }
}

async function resolveStore(store?: SeattleCupCacheStore): Promise<SeattleCupCacheStore> {
  return store ?? dbStore()
}

export async function readSeattleCupFresh(args: SeattleCupCacheArgs, store?: SeattleCupCacheStore): Promise<SeattleCupRoundSnapshot | null> {
  return (await resolveStore(store)).readFresh(args)
}
export async function readSeattleCupStale(args: SeattleCupCacheArgs, store?: SeattleCupCacheStore): Promise<SeattleCupRoundSnapshot | null> {
  return (await resolveStore(store)).readStale(args)
}
export async function writeSeattleCup(args: SeattleCupCacheArgs, payload: SeattleCupRoundSnapshot, store?: SeattleCupCacheStore): Promise<void> {
  await (await resolveStore(store)).write(args, payload)
}

export const seattleCupSingleFlight = makeSingleFlight<SeattleCupRoundSnapshot>()