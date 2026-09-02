// Coalesced live-result cache. Two layers:
//   1. In-process single-flight (promise map) — GUARANTEED within one instance.
//      Prevents N concurrent in-process requests from each calling upstream.
//   2. DB-backed short-TTL cache (competition_live_cache) — prevents most
//      repeated upstream calls AFTER the first write, across requests. Two
//      cold instances missing simultaneously can both call upstream before
//      either writes — this is BEST-EFFORT cross-instance coalescing, not a
//      strict single-flight guarantee. If strict cross-instance single-flight
//      is ever required, add a Postgres advisory lock around the fill (future).
// Stale-while-error: on upstream failure the caller returns the most recent
// cached row (even if expired) with showingLastKnown=true, preserving the
// leaderboard. See design spec §4.
//
// Callers use the STRUCTURED API (readCachedResult/readStaleResult/
// writeCachedResult with {tenantKey,competitionKey,occurrenceId,scoring}) and
// never compose raw keys. The DB layer is injectable for unit tests via
// makeLiveCacheStore.

import { resultsCacheKey, discoveryCacheKey } from './cache-keys.ts'
import type { LiveResponse, ScoringMode } from './types.ts'

export function makeSingleFlight<T>() {
  const inFlight = new Map<string, Promise<T>>()
  return {
    async run(key: string, work: () => Promise<T>): Promise<T> {
      const existing = inFlight.get(key)
      if (existing) return existing
      const p = work().finally(() => inFlight.delete(key))
      inFlight.set(key, p)
      return p
    },
  }
}

const RESULTS_TTL_SECONDS = 60
const DISCOVERY_TTL_SECONDS = 120

export interface CacheKeyArgs {
  tenantKey: string
  competitionKey: string
  occurrenceId: string
}
export interface ResultCacheKeyArgs extends CacheKeyArgs { scoring: ScoringMode }

export interface CacheRow {
  cache_key: string
  payload: LiveResponse
  result_status: string | null
  fetched_at: string
  expires_at: string
}

// Injectable DB layer. The default uses the service client; tests inject an
// in-memory store. This keeps readCachedResult/readStaleResult unit-testable.
export interface LiveCacheStore {
  readCachedResult(args: ResultCacheKeyArgs): Promise<LiveResponse | null>
  readStaleResult(args: ResultCacheKeyArgs): Promise<LiveResponse | null>
  writeCachedResult(args: ResultCacheKeyArgs, payload: LiveResponse): Promise<void>
  readCachedDiscovery(args: CacheKeyArgs): Promise<unknown | null>
  writeCachedDiscovery(args: CacheKeyArgs, payload: unknown): Promise<void>
  cleanExpired(): Promise<void>
}

export function makeLiveCacheStore(rows: Map<string, CacheRow>): LiveCacheStore {
  const keyOf = (args: ResultCacheKeyArgs) => resultsCacheKey(args)
  return {
    async readCachedResult(args) {
      const k = keyOf(args)
      const r = rows.get(k)
      if (!r) return null
      if (Date.parse(r.expires_at) <= Date.now()) return null
      return r.payload
    },
    async readStaleResult(args) {
      // most recent row regardless of expiry
      const matching = [...rows.entries()].filter(([k]) => k === keyOf(args))
      if (!matching.length) return null
      matching.sort((a, b) => Date.parse(b[1].fetched_at) - Date.parse(a[1].fetched_at))
      return matching[0][1].payload
    },
    async writeCachedResult(args, payload) {
      rows.set(keyOf(args), {
        cache_key: keyOf(args), payload, result_status: payload.resultStatus,
        fetched_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + RESULTS_TTL_SECONDS * 1000).toISOString(),
      })
    },
    async readCachedDiscovery(args) {
      const k = discoveryCacheKey(args)
      const r = rows.get(k)
      if (!r || Date.parse(r.expires_at) <= Date.now()) return null
      return r.payload
    },
    async writeCachedDiscovery(args, payload) {
      rows.set(discoveryCacheKey(args), {
        cache_key: discoveryCacheKey(args), payload: payload as LiveResponse, result_status: null,
        fetched_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + DISCOVERY_TTL_SECONDS * 1000).toISOString(),
      })
    },
    async cleanExpired() {
      for (const [k, r] of rows) if (Date.parse(r.expires_at) <= Date.now() - 24 * 3600_000) rows.delete(k)
    },
  }
}

// Service-role DB-backed store. Created lazily so unit tests that import the
// module for makeSingleFlight/makeLiveCacheStore don't require Supabase.
let _dbStore: LiveCacheStore | null = null
async function dbStore(): Promise<LiveCacheStore> {
  if (_dbStore) return _dbStore
  const { createServiceClient } = await import('../supabase/service.ts')
  const supabase = createServiceClient()
  _dbStore = {
    async readCachedResult(args) {
      const { data } = await supabase.from('competition_live_cache')
        .select('payload, expires_at').eq('cache_key', resultsCacheKey(args))
        .gt('expires_at', new Date().toISOString()).maybeSingle()
      return (data?.payload as LiveResponse) ?? null
    },
    async readStaleResult(args) {
      const { data } = await supabase.from('competition_live_cache')
        .select('payload, fetched_at').eq('cache_key', resultsCacheKey(args))
        .order('fetched_at', { ascending: false }).limit(1).maybeSingle()
      return (data?.payload as LiveResponse) ?? null
    },
    async writeCachedResult(args, payload) {
      await supabase.from('competition_live_cache').upsert({
        cache_key: resultsCacheKey(args), tenant_key: args.tenantKey, competition_key: args.competitionKey,
        occurrence_id: args.occurrenceId, scope: 'results', scoring: args.scoring,
        payload: payload as unknown as Record<string, unknown>, result_status: payload.resultStatus,
        fetched_at: new Date().toISOString(), expires_at: new Date(Date.now() + RESULTS_TTL_SECONDS * 1000).toISOString(),
      })
    },
    async readCachedDiscovery(args) {
      const { data } = await supabase.from('competition_live_cache')
        .select('payload').eq('cache_key', discoveryCacheKey(args))
        .gt('expires_at', new Date().toISOString()).maybeSingle()
      return data?.payload ?? null
    },
    async writeCachedDiscovery(args, payload) {
      await supabase.from('competition_live_cache').upsert({
        cache_key: discoveryCacheKey(args), tenant_key: args.tenantKey, competition_key: args.competitionKey,
        occurrence_id: args.occurrenceId, scope: 'discovery', scoring: null,
        payload: payload as Record<string, unknown>, fetched_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + DISCOVERY_TTL_SECONDS * 1000).toISOString(),
      })
    },
    async cleanExpired() {
      await supabase.from('competition_live_cache').delete()
        .lt('expires_at', new Date(Date.now() - 24 * 3600_000).toISOString())
    },
  }
  return _dbStore
}

// Public entry points used by live.ts. Each takes structured args — callers
// never compose keys.
export async function readCachedResult(args: ResultCacheKeyArgs, store?: LiveCacheStore): Promise<LiveResponse | null> {
  return (store ?? await dbStore()).readCachedResult(args)
}
export async function readStaleResult(args: ResultCacheKeyArgs, store?: LiveCacheStore): Promise<LiveResponse | null> {
  return (store ?? await dbStore()).readStaleResult(args)
}
export async function writeCachedResult(args: ResultCacheKeyArgs, payload: LiveResponse, store?: LiveCacheStore): Promise<void> {
  await (store ?? await dbStore()).writeCachedResult(args, payload)
}
export async function readCachedDiscovery(args: CacheKeyArgs, store?: LiveCacheStore): Promise<unknown | null> {
  return (store ?? await dbStore()).readCachedDiscovery(args)
}
export async function writeCachedDiscovery(args: CacheKeyArgs, payload: unknown, store?: LiveCacheStore): Promise<void> {
  await (store ?? await dbStore()).writeCachedDiscovery(args, payload)
}
export async function cleanExpiredCache(store?: LiveCacheStore): Promise<void> {
  await (store ?? await dbStore()).cleanExpired()
}
