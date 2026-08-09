import { test } from 'node:test'
import assert from 'node:assert/strict'
import { discoverOccurrence, type DiscoverInput } from '../lib/competition/adapters/golfgenius/discovery.ts'

// Fake GG client records calls and serves canned responses by endpoint suffix.
// `throwOn` lets a test simulate a genuine upstream failure (network/auth/5xx)
// on a specific endpoint substring — the client THROWS, mimicking the real
// client's contract that genuine errors reject while 404/empty returns null.
function fakeGg(opts: {
  events?: any[]                  // GET /events?season={sid}
  rounds?: any[]                   // GET /events/{eid}/rounds (full discovery)
  tournaments?: any[]              // GET /events/{eid}/rounds/{rid}/tournaments
  results?: Record<string, any>   // GET .../tournaments/{tid}.json
  throwOn?: string                // endpoint substring that should reject
  eventRounds?: any[]             // GET /events/{eid}/rounds when verifying a hinted event id
}) {
  const calls: string[] = []
  const fn = async (endpoint: string) => {
    calls.push(endpoint)
    if (opts.throwOn && endpoint.includes(opts.throwOn)) {
      throw new Error('upstream failure: ' + endpoint)
    }
    // Hint verification: GET /events/{eid}/rounds for a hinted event id.
    if (/\/events\/[^/]+\/rounds$/.test(endpoint) && opts.eventRounds !== undefined) return opts.eventRounds
    if (endpoint.endsWith('/tournaments') && !endpoint.includes('.json')) return opts.tournaments ?? []
    if (/\/events\/[^/]+\/rounds$/.test(endpoint)) return opts.rounds ?? []
    if (endpoint.includes('/events?season=')) return opts.events ?? []
    const tId = endpoint.split('/').slice(-1)[0].replace('.json', '')
    return opts.results?.[tId] ?? { event: { scopes: [] } }
  }
  return { fn, calls }
}

const baseInput = (over: Partial<DiscoverInput>): DiscoverInput => ({
  competitionKey: 'mens-league',
  tenantKey: 'igc',
  adapterConfig: {
    seasonId: 'S', categoryId: 'C', eventFilter: 'mens', tenantKey: 'igc',
    roundResolution: 'pointsRoundIndex',
  },
  occurrenceContext: { number: 18, date: null },
  persistedHints: null,
  teamOverride: false,
  ggClient: (async () => []) as any,
  scoringMode: 'gross',
  ...over,
})

test('no persisted row but discoverable: resolves event + round + tournaments from config and returns occurrence metadata', async () => {
  const gg = fakeGg({
    events: [{ id: 'E', name: 'Mens League', category_id: 'C' }],
    rounds: [{ id: 'R1', name: 'Round 18', is_points_round: true, position: 18, date: '2026-07-28' }],
    tournaments: [
      { event: { id: 'g1', name: 'Gross Regular Season' } },
      { event: { id: 'n1', name: 'Net Regular Season' } },
    ],
    results: {
      g1: { event: { status: 'in_progress', completed_at: null, version: 'v9', scopes: [{ name: 'Flight 1', aggregates: [{ name: 'Hans Olson', position: '1', gross_scores: [5,6], net_scores: [4,5], to_par_net: [-1,0], to_par_gross: [0,0], totals: { gross_scores: { out: 11 } } }] }] } },
    },
  })
  const r = await discoverOccurrence({ ...baseInput({ ggClient: gg.fn }), persistedHints: null })
  assert.equal(r.eventFormat, 'individual')
  assert.equal(r.discoveryState, 'discovered')
  // Occurrence metadata is carried on r.resolved (ResolvedOccurrence).
  assert.equal(r.resolved.ggEventId, 'E')
  assert.equal(r.resolved.ggRoundId, 'R1')
  assert.equal(r.resolved.grossTournamentId, 'g1')
  assert.equal(r.resolved.roundDate, '2026-07-28', 'round date carried from discovered GG round')
  assert.equal(r.resolved.eventName, 'Mens League')
  assert.equal(r.resolved.sourceVersion, 'v9')
  assert.ok(r.leaderboard, 'leaderboard produced from full discovery')
  assert.equal(r.resultStatus, 'live')
  assert.ok(gg.calls.some((c) => c.includes('/events?season=')), 'resolved parent event from config')
})

test('row without gg_event_id but with config → full discovery (not a team verdict)', async () => {
  const gg = fakeGg({
    events: [{ id: 'E', name: 'Mens League', category_id: 'C' }],
    rounds: [{ id: 'R1', is_points_round: true, position: 18 }],
    tournaments: [],
  })
  const r = await discoverOccurrence({ ...baseInput({ ggClient: gg.fn }), persistedHints: { ggEventId: null, ggRoundId: null, grossTournamentId: null, netTournamentId: null } })
  assert.equal(r.eventFormat, 'unknown')
  assert.equal(r.discoveryState, 'pending')
  assert.equal(r.leaderboard, null)
})

test('stale persisted tournament ids fail to fetch → falls back to full discovery', async () => {
  // Persisted hint says gross=g1, but the GG fetch for g1 is empty. The
  // adapter must NOT synthesize individual from the persisted id; it falls
  // back to listing tournaments and re-discovers g2.
  const gg = fakeGg({
    events: [{ id: 'E', name: 'Mens League', category_id: 'C' }],
    rounds: [{ id: 'R1', is_points_round: true, position: 18 }],
    tournaments: [{ event: { id: 'g2', name: 'Gross Regular Season' } }],
    results: {
      g1: { event: { scopes: [] } },              // stale: empty
      g2: { event: { status: 'in_progress', scopes: [{ name: 'Flight 1', aggregates: [{ name: 'Hans Olson', position: '1', gross_scores: [5], net_scores: [4], to_par_net: [-1], to_par_gross: [0], totals: { gross_scores: { out: 5 } } }] }] } },
    },
  })
  const r = await discoverOccurrence({
    ...baseInput({ ggClient: gg.fn }),
    persistedHints: { ggEventId: 'E', ggRoundId: 'R1', grossTournamentId: 'g1', netTournamentId: null },
  })
  assert.equal(r.eventFormat, 'individual')
  assert.equal(r.resolved.grossTournamentId, 'g2', 'fell back to freshly discovered tournament id')
  assert.ok(r.leaderboard, 'results produced after fallback')
})

test('stale persisted gg_event_id hint (event no longer has rounds) → falls back to full config discovery', async () => {
  // Persisted gg_event_id 'ESTALE' returns no rounds when verified, so the
  // adapter falls back to listing events from config and finds 'E'.
  const gg = fakeGg({
    events: [{ id: 'E', name: 'Mens League', category_id: 'C' }],
    rounds: [{ id: 'R1', is_points_round: true, position: 18, date: '2026-07-28' }],
    eventRounds: [],   // verifying hinted event 'ESTALE' yields no rounds → stale
    tournaments: [{ event: { id: 'g1', name: 'Gross Regular Season' } }],
    results: { g1: { event: { status: 'in_progress', scopes: [{ name: 'Flight 1', aggregates: [{ name: 'Hans Olson', position: '1', gross_scores: [5], net_scores: [4], to_par_net: [-1], to_par_gross: [0], totals: { gross_scores: { out: 5 } } }] }] } } },
  })
  const r = await discoverOccurrence({
    ...baseInput({ ggClient: gg.fn }),
    persistedHints: { ggEventId: 'ESTALE', ggRoundId: 'R1', grossTournamentId: null, netTournamentId: null },
  })
  assert.equal(r.resolved.ggEventId, 'E', 'fell back to config-discovered event id, not the stale hint')
  assert.ok(gg.calls.some((c) => c.includes('/events?season=')), 'fell back to listing events from config')
})

test('team override produces team even with no tournaments', async () => {
  const gg = fakeGg({ events: [{ id: 'E', category_id: 'C' }], rounds: [{ id: 'R1', is_points_round: true, position: 18 }], tournaments: [] })
  const r = await discoverOccurrence({ ...baseInput({ ggClient: gg.fn, teamOverride: true }) })
  assert.equal(r.eventFormat, 'team')
  assert.equal(r.discoveryState, 'discovered')
  assert.equal(r.leaderboard, null)
})

test('genuine upstream failure THROWS (not swallowed) so stale-while-error can catch it', async () => {
  // The GG client rejects on the tournament-results fetch. discoverOccurrence
  // must propagate the rejection — NOT swallow it into pending/inconclusive.
  // The caller's stale-while-error handler relies on the thrown error to serve
  // last-known data with showingLastKnown=true.
  const gg = fakeGg({
    events: [{ id: 'E', name: 'Mens League', category_id: 'C' }],
    rounds: [{ id: 'R1', is_points_round: true, position: 18, date: '2026-07-28' }],
    tournaments: [{ event: { id: 'g1', name: 'Gross Regular Season' } }],
    throwOn: '/tournaments/',   // the results .json fetch will reject
  })
  await assert.rejects(
    () => discoverOccurrence({ ...baseInput({ ggClient: gg.fn }) }),
    /upstream failure/,
    'a thrown GG error must propagate, not be swallowed into pending/failed',
  )
})
