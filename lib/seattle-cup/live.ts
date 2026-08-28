// Seattle Cup live orchestration. Fresh cache → single-flight fetch+normalize+
// enrich → cache write → stale-while-error. GG is fetched via fetchRoundRaw
// (404-tolerant: a not-yet-posted round resolves to a TBD snapshot, NOT a
// throw). Genuine upstream failures (network/auth/5xx) propagate out of
// fetchRoundRaw; here we serve the most recent cached snapshot with
// showingLastKnown=true, preserving the leaderboard. When no stale row exists
// the error rethrows and the route returns 502. See ground-truth report §6.

import { fetchRoundRaw, type GGClient } from './gg-fetch.ts'
import { normalizeRound } from './normalize.ts'
import { enrichIdentities, createRosterBatchLookup, type RosterBatchLookup } from './identity.ts'
import {
  cacheErrorEvent, readSeattleCupFresh, readSeattleCupStale, writeSeattleCup, seattleCupSingleFlight,
  type SeattleCupCacheErrorReporter, type SeattleCupCacheOperation, type SeattleCupCacheStore,
} from './cache.ts'
import {
  measureSeattleCupTiming, measureSeattleCupTimingSync, type SeattleCupTimingSink,
} from './timing.ts'
import type { SeattleCupRoundSnapshot, RoundNumber } from './types.ts'

export interface GetSeattleCupLiveInput {
  round: RoundNumber
  // Injected for tests; production omits and uses the real GG client + DB cache.
  deps?: {
    ggClient?: GGClient
    cacheStore?: SeattleCupCacheStore
    rosterLookup?: RosterBatchLookup | null
    timing?: SeattleCupTimingSink
    onCacheError?: SeattleCupCacheErrorReporter
  }
}

function reportCacheError(
  operation: SeattleCupCacheOperation,
  error: unknown,
  reporter?: SeattleCupCacheErrorReporter,
): void {
  const event = cacheErrorEvent(operation, error)
  if (reporter) {
    reporter(event)
    return
  }
  console.warn('[seattle-cup-cache] operation failed', event)
}

export async function getSeattleCupLive(input: GetSeattleCupLiveInput): Promise<SeattleCupRoundSnapshot> {
  const cacheArgs = { round: input.round }
  const store = input.deps?.cacheStore ?? undefined

  // 1. Fresh cache hit.
  let cached: SeattleCupRoundSnapshot | null = null
  try {
    cached = await measureSeattleCupTiming(input.deps?.timing, 'cache-read', () =>
      readSeattleCupFresh(cacheArgs, store))
  } catch (error) {
    reportCacheError('read-fresh', error, input.deps?.onCacheError)
  }
  if (cached) return { ...cached, showingLastKnown: false }

  // 2. Single-flight the fresh fetch+normalize.
  const fresh = await seattleCupSingleFlight.run(`seattle-cup:round-${input.round}`, () =>
    fetchFresh(input, store),
  )
  // 3. Write back (best-effort) — only a genuinely fresh (non-stale) snapshot.
  if (fresh && !fresh.showingLastKnown) {
    try {
      await measureSeattleCupTiming(input.deps?.timing, 'cache-write', () =>
        writeSeattleCup(cacheArgs, fresh, store))
    } catch (error) {
      reportCacheError('write', error, input.deps?.onCacheError)
    }
  }
  return fresh
}

async function fetchFresh(input: GetSeattleCupLiveInput, store?: SeattleCupCacheStore): Promise<SeattleCupRoundSnapshot> {
  try {
    const raw = await measureSeattleCupTiming(input.deps?.timing, 'golf-genius', () =>
      fetchRoundRaw({ round: input.round, ggClient: input.deps?.ggClient }))
    const { snapshot } = measureSeattleCupTimingSync(input.deps?.timing, 'normalization', () =>
      normalizeRound(input.round, raw))
    const full: SeattleCupRoundSnapshot = { ...snapshot, fetchedAt: Date.now(), showingLastKnown: false }

    // Identity enrichment (best-effort; default lookup is created lazily). In
    // tests a fake lookup (or null) is injected; production creates a real
    // igc_league_members lookup. Never blocks on failure.
    let lookup = input.deps?.rosterLookup
    if (lookup === undefined) {
      try { lookup = await createRosterBatchLookup() } catch { lookup = null }
    }
    await measureSeattleCupTiming(input.deps?.timing, 'identity', () =>
      enrichIdentities(full, lookup ?? null))

    return full
  } catch (err) {
    // Stale-while-error: serve the most recent cached row (even if expired) with
    // showingLastKnown=true so the leaderboard survives a transient GG outage.
    console.error(`[getSeattleCupLive] round ${input.round}:`, err)
    let stale: SeattleCupRoundSnapshot | null = null
    try {
      stale = await measureSeattleCupTiming(input.deps?.timing, 'cache-read', () =>
        readSeattleCupStale({ round: input.round }, store))
    } catch (error) {
      reportCacheError('read-stale', error, input.deps?.onCacheError)
    }
    if (stale) return { ...stale, showingLastKnown: true }
    throw err
  }
}
