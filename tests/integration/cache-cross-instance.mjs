// Integration test: cross-instance cache best-effort coalescing (spec test #16).
// Documents the BEST-EFFORT guarantee: when two instances miss the cache
// simultaneously for the same key, both may fetch upstream — the DB cache does
// NOT enforce cross-instance single-flight. Within ONE process the in-process
// single-flight (lib/competition/cache.ts makeSingleFlight) coalesces concurrent
// calls, so this test sees ≥1 upstream call (not exactly one). Strict cross-
// instance single-flight would require a Postgres advisory lock around the fill
// (NOT implemented in this phase — see lib/competition/cache.ts header comment).
//
// This test uses IN-MEMORY fakes (no Supabase, no real GG) so it PASSES without
// any environment. It is not picked up by `pnpm test:unit` (top-level glob is
// tests/*.test.ts, non-recursive). Run manually:
//     node --test tests/integration/cache-cross-instance.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'

test('two concurrent cold-miss getLiveResults calls each return a correct LiveResponse; ≥1 upstream call (no strict single-flight assertion)', async () => {
  const { getLiveResults } = await import('../../lib/competition/live.ts')
  const { makeLiveCacheStore } = await import('../../lib/competition/cache.ts')

  // Counter of upstream GG calls. Two concurrent cold-miss calls in one process
  // are coalesced by the in-process single-flight → one set of calls. Cross-
  // instance (two processes sharing the DB cache) they could BOTH fetch — that
  // is permitted (best-effort), so we assert ≥1, NEVER === 1.
  let upstreamCallCount = 0

  // Fake GG: serves the full discovery path for a single occurrence. Each
  // branch increments upstreamCallCount so we can assert at least one happened.
  const ggClient = async (endpoint) => {
    upstreamCallCount++
    if (endpoint === `/seasons/s1/events`) {
      return { events: [{ id: 'evt1', name: 'Mens League', category_id: 'c1' }] }
    }
    if (endpoint === `/events/evt1/rounds`) {
      return { rounds: [{ id: 'r1', date: '2026-07-28', is_points_round: true }] }
    }
    if (endpoint === `/events/evt1/rounds/r1/tournaments`) {
      return { tournaments: [
        { event: { id: 'g1', name: 'Gross Regular Season' } },
        { event: { id: 'n1', name: 'Net Regular Season' } },
      ] }
    }
    const m = endpoint.match(/tournaments\/([^/]+)\.json$/)
    if (m && m[1] === 'g1') {
      return {
        event: {
          status: 'completed',
          completed_at: '2026-07-28T22:00:00Z',
          version: 'v-cross-1',
          scopes: [{
            name: 'Flight 1',
            aggregates: [
              {
                name: 'Cross Player A', position: 1, points: 500, purse: null,
                member_cards: [{ member_card_id_str: 'CX1' }],
                gross_scores: [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
                net_scores: [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
                to_par_net: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                to_par_gross: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                totals: {
                  gross_scores: { out: 72, total: 72 },
                  net_scores: { out: 72, total: 72 },
                  to_par_net: { out: 0, total: 0 },
                  to_par_gross: { out: 0, total: 0 },
                },
                scorecard_statuses: [{ status: 'Verified' }],
              },
            ],
          }],
        },
      }
    }
    throw new Error(`fake GG: no fixture for ${endpoint}`)
  }

  // In-memory cache store (no DB). Two calls share it; both start cold (empty).
  const cacheStore = makeLiveCacheStore(new Map())

  const deps = {
    adapterConfig: {
      seasonId: 's1', categoryId: 'c1', eventFilter: 'mens', tenantKey: 'igc',
      roundResolution: 'pointsRoundIndex',
    },
    ggClient,
    cacheStore,
    // No persisted event row — discovery resolves from config + GG alone.
    readEvent: async () => null,
  }

  const input = {
    competitionKey: 'mens-league',
    occurrenceId: '1',
    scoring: 'gross',
    nowIso: '2026-07-28T20:00:00Z',
    deps,
  }

  // Two concurrent cold-miss calls for the same key.
  const [r1, r2] = await Promise.all([getLiveResults(input), getLiveResults(input)])

  // Each returns a correct LiveResponse.
  assert.ok(r1 && r2, 'both calls returned a LiveResponse')
  assert.ok(r1.occurrence && r2.occurrence, 'both responses carry an occurrence')
  assert.equal(r1.eventFormat, 'individual', 'r1 classified individual')
  assert.equal(r2.eventFormat, 'individual', 'r2 classified individual')
  assert.ok(r1.leaderboard && r1.leaderboard.entries.length > 0, 'r1 has leaderboard entries')
  assert.ok(r2.leaderboard && r2.leaderboard.entries.length > 0, 'r2 has leaderboard entries')
  assert.equal(r1.resultStatus, 'final', 'r1 resultStatus final (completed upstream)')
  assert.equal(r2.resultStatus, 'final', 'r2 resultStatus final (completed upstream)')

  // At least one upstream call happened. We do NOT assert exactly one — duplicate
  // cold-miss fetches are permitted (best-effort coalescing, spec test #16).
  assert.ok(upstreamCallCount >= 1, `expected ≥1 upstream call, got ${upstreamCallCount}`)

  // NOTE: strict cross-instance single-flight would require a Postgres advisory
  // lock around the cache fill (not implemented in this phase). The in-process
  // single-flight coalesces concurrent calls WITHIN one process; two separate
  // processes sharing the DB cache can both miss and both fetch upstream before
  // either writes. That is acceptable for this phase's best-effort guarantee.
  console.log(
    '  [cache-cross-instance] upstream calls observed: ' + upstreamCallCount +
    '. Strict cross-instance single-flight would require a Postgres advisory lock (not implemented).'
  )
})
