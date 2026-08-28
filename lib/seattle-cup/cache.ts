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
import type { SupabaseClient } from '@supabase/supabase-js'
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

export type SeattleCupCacheOperation = 'read-fresh' | 'read-stale' | 'write'

export interface SeattleCupCacheErrorEvent {
  operation: SeattleCupCacheOperation
  code: string
}

export type SeattleCupCacheErrorReporter = (event: SeattleCupCacheErrorEvent) => void

export class SeattleCupCacheError extends Error {
  readonly operation: SeattleCupCacheOperation
  readonly code: string

  constructor(operation: SeattleCupCacheOperation, code = 'unknown') {
    super(`Seattle Cup cache ${operation} failed (${code})`)
    this.name = 'SeattleCupCacheError'
    this.operation = operation
    this.code = code
  }
}

function cacheError(operation: SeattleCupCacheOperation, error: unknown): SeattleCupCacheError {
  if (error instanceof SeattleCupCacheError) return error
  const rawCode = typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code ?? 'unknown')
    : 'unknown'
  const code = /^[A-Za-z0-9_-]{1,32}$/.test(rawCode) ? rawCode : 'unknown'
  return new SeattleCupCacheError(operation, code)
}

export function cacheErrorEvent(
  operation: SeattleCupCacheOperation,
  error: unknown,
): SeattleCupCacheErrorEvent {
  const normalized = cacheError(operation, error)
  return { operation: normalized.operation, code: normalized.code }
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

// Resolve the cache store: injected (tests) → DB-backed. The live orchestration
// treats fresh-read and write failures as non-fatal cache optimization failures,
// while preserving the distinction between a genuine miss and a failed read.
let _dbStore: SeattleCupCacheStore | null = null

export function makeSupabaseSeattleCupCacheStore(supabase: SupabaseClient): SeattleCupCacheStore {
  const table = 'competition_live_cache'
  return {
    async readFresh(a) {
      try {
        const { data, error } = await supabase.from(table).select('payload, expires_at')
          .eq('cache_key', keyOf(a)).gt('expires_at', new Date().toISOString()).maybeSingle()
        if (error) throw cacheError('read-fresh', error)
        return (data?.payload as SeattleCupRoundSnapshot | undefined) ?? null
      } catch (error) {
        throw cacheError('read-fresh', error)
      }
    },
    async readStale(a) {
      try {
        const { data, error } = await supabase.from(table).select('payload, fetched_at')
          .eq('cache_key', keyOf(a)).order('fetched_at', { ascending: false }).limit(1).maybeSingle()
        if (error) throw cacheError('read-stale', error)
        return (data?.payload as SeattleCupRoundSnapshot | undefined) ?? null
      } catch (error) {
        throw cacheError('read-stale', error)
      }
    },
    async write(a, payload) {
      try {
        const now = new Date()
        const { error } = await supabase.from(table).upsert({
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
        if (error) throw cacheError('write', error)
      } catch (error) {
        throw cacheError('write', error)
      }
    },
  }
}

async function dbStore(): Promise<SeattleCupCacheStore> {
  if (_dbStore) return _dbStore
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Seattle Cup cache persistence is not configured')
  }
  const { createServiceClient } = await import('../supabase/service.ts')
  _dbStore = makeSupabaseSeattleCupCacheStore(createServiceClient())
  return _dbStore
}

async function resolveStore(store?: SeattleCupCacheStore): Promise<SeattleCupCacheStore> {
  return store ?? dbStore()
}

export async function readSeattleCupFresh(args: SeattleCupCacheArgs, store?: SeattleCupCacheStore): Promise<SeattleCupRoundSnapshot | null> {
  try {
    return await (await resolveStore(store)).readFresh(args)
  } catch (error) {
    throw cacheError('read-fresh', error)
  }
}
export async function readSeattleCupStale(args: SeattleCupCacheArgs, store?: SeattleCupCacheStore): Promise<SeattleCupRoundSnapshot | null> {
  try {
    return await (await resolveStore(store)).readStale(args)
  } catch (error) {
    throw cacheError('read-stale', error)
  }
}
export async function writeSeattleCup(args: SeattleCupCacheArgs, payload: SeattleCupRoundSnapshot, store?: SeattleCupCacheStore): Promise<void> {
  try {
    await (await resolveStore(store)).write(args, payload)
  } catch (error) {
    throw cacheError('write', error)
  }
}

export const seattleCupSingleFlight = makeSingleFlight<SeattleCupRoundSnapshot>()
