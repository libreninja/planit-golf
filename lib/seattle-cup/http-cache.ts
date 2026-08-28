import type {
  RoundNumber,
  SeattleCupRoundSnapshot,
  SeattleCupTournamentResolution,
} from './types.ts'

export type SeattleCupHttpCacheState = 'live' | 'upcoming' | 'final'

const BROWSER_REVALIDATE = 'public, max-age=0, must-revalidate'
const NO_STORE = 'no-store'

const SHARED_CACHE_CONTROL: Record<SeattleCupHttpCacheState, string> = {
  live: 'public, s-maxage=10, stale-while-revalidate=15',
  upcoming: 'public, s-maxage=30, stale-while-revalidate=30',
  final: 'public, s-maxage=3600, stale-while-revalidate=86400',
}

const SETTLED_RESOLUTIONS = new Set<SeattleCupTournamentResolution['status']>([
  'points-winner',
  'head-to-head-winner',
  'playoff-winner',
])

export function parseSeattleCupRound(requestUrl: string): RoundNumber | null {
  const roundParam = new URL(requestUrl).searchParams.get('round')
  const round = roundParam ? Number(roundParam) : NaN
  return Number.isInteger(round) && round >= 1 && round <= 4
    ? round as RoundNumber
    : null
}

// Cache the complete response according to its most volatile authoritative
// input. Every round response carries tournament-wide Race and resolution
// state, so an individually-final round is not a settled representation while
// another round is scheduled/live or a playoff result is still pending.
export function seattleCupHttpCacheState(
  snapshots: readonly SeattleCupRoundSnapshot[],
  tournamentResolution: SeattleCupTournamentResolution,
): SeattleCupHttpCacheState {
  if (snapshots.some((snapshot) =>
    snapshot.roundStatus === 'live' || snapshot.resultStatus === 'live')) {
    return 'live'
  }

  const allRoundNumbersPresent = new Set(snapshots.map((snapshot) => snapshot.round)).size === 4
  const allRoundsFinal = snapshots.length === 4 && allRoundNumbersPresent && snapshots.every((snapshot) =>
    snapshot.roundStatus === 'final' && snapshot.resultStatus === 'final')
  if (allRoundsFinal && SETTLED_RESOLUTIONS.has(tournamentResolution.status)) {
    return 'final'
  }

  return 'upcoming'
}

export function seattleCupPublicCacheHeaders(
  snapshots: readonly SeattleCupRoundSnapshot[],
  tournamentResolution: SeattleCupTournamentResolution,
): Record<string, string> {
  // A stale-while-error application response is intentionally not admitted to
  // the CDN: doing so would amplify an already-stale fallback and mask recovery.
  if (snapshots.some((snapshot) => snapshot.showingLastKnown)) {
    return seattleCupNoStoreHeaders()
  }

  const state = seattleCupHttpCacheState(snapshots, tournamentResolution)
  return {
    'Cache-Control': BROWSER_REVALIDATE,
    // Vercel consumes this targeted header at the edge. Keeping browser policy
    // separate makes every browser revalidate while shared requests collapse.
    'Vercel-CDN-Cache-Control': SHARED_CACHE_CONTROL[state],
  }
}

export function seattleCupNoStoreHeaders(): Record<string, string> {
  return { 'Cache-Control': NO_STORE }
}

// Vary must be present even when a request has no allowed Origin. Otherwise a
// no-Origin CDN entry can be reused for a later browser request and omit the
// CORS allow-origin header that CupCentral needs.
export function seattleCupCorsHeaders(origin: string | null): Record<string, string> {
  if (!origin) return { Vary: 'Origin' }
  return {
    'Access-Control-Allow-Origin': origin,
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '300',
  }
}
