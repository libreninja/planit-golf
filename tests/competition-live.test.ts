import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getLiveResults } from '../lib/competition/live.ts'
import { makeLiveCacheStore } from '../lib/competition/cache.ts'

// Fake GG serving parent event + round + tournaments + results.
function fakeGg(opts: { tournaments: any[]; results: Record<string, any>; events?: any[]; rounds?: any[] }) {
  return async (endpoint: string) => {
    if (endpoint.includes('/events?season=')) return opts.events ?? [{ id: 'E', name: 'Mens', category_id: 'C' }]
    if (endpoint.endsWith('/rounds')) return opts.rounds ?? [{ id: 'R1', is_points_round: true, position: 18 }]
    if (endpoint.endsWith('/tournaments') && !endpoint.includes('.json')) return opts.tournaments
    const tId = endpoint.split('/').slice(-1)[0].replace('.json', '')
    return opts.results[tId] ?? { event: { scopes: [] } }
  }
}

function fakeEventReader(ev: any | null) {
  return async (_competitionKey: string, occurrenceId: string) =>
    ev ? { ...ev, week_number: Number(occurrenceId) } : null
}

const adapterConfig = { seasonId: 'S', categoryId: 'C', eventFilter: 'mens', tenantKey: 'igc', roundResolution: 'pointsRoundIndex' as const }

test('live results appear WITHOUT a persisted row (discovery from config)', async () => {
  const gg = fakeGg({
    tournaments: [{ event: { id: 'g1', name: 'Gross Regular Season' } }, { event: { id: 'n1', name: 'Net Regular Season' } }],
    results: { g1: { event: { status: 'in_progress', scopes: [{ name: 'Flight 1', aggregates: [{ name: 'Hans Olson', position: '1', gross_scores: [5,6], net_scores: [4,5], to_par_net: [-1,0], to_par_gross: [0,0], totals: { gross_scores: { out: 11 } } }] }] } } },
  })
  const cache = makeLiveCacheStore(new Map())
  const r = await getLiveResults({
    competitionKey: 'mens-league', occurrenceId: '18', scoring: 'gross',
    nowIso: '2026-07-28T18:00:00-07:00',
    deps: { adapterConfig, ggClient: gg, readEvent: fakeEventReader(null), cacheStore: cache },
  })
  assert.equal(r.eventFormat, 'individual')
  assert.equal(r.resultStatus, 'live')
  assert.ok(r.leaderboard, 'leaderboard produced with no persisted row')
  assert.equal(r.leaderboard!.entries.length > 0, true)
  assert.equal(r.showingLastKnown, false)
})

test('no persisted row + discovered round dated today + unknown lifecycle + live partial cards + configured window → live', async () => {
  // Correction 3: with no event row, discovery returns a round dated TODAY.
  // The tournament payload has NO status (lifecycle unknown) but partial cards.
  // The discovered round date must drive the active window so the occurrence
  // shows live even though the persisted event_date was absent.
  const gg = fakeGg({
    events: [{ id: 'E', name: 'Mens League', category_id: 'C' }],
    rounds: [{ id: 'R1', is_points_round: true, position: 18, date: '2026-07-28' }],
    tournaments: [{ event: { id: 'g1', name: 'Gross Regular Season' } }],
    results: { g1: { event: { scopes: [{ name: 'Flight 1', aggregates: [{ name: 'Hans Olson', position: '1', gross_scores: [5], net_scores: [4], to_par_net: [-1], to_par_gross: [0], totals: { gross_scores: { out: 5 } } }] }] } } },
  })
  const cache = makeLiveCacheStore(new Map())
  const r = await getLiveResults({
    competitionKey: 'mens-league', occurrenceId: '18', scoring: 'gross',
    nowIso: '2026-07-28T18:00:00-07:00',
    deps: { adapterConfig, ggClient: gg, readEvent: fakeEventReader(null), cacheStore: cache },
  })
  assert.equal(r.resultStatus, 'live', 'discovered round date drives the window → live despite unknown lifecycle')
  assert.ok(r.leaderboard)
  assert.equal(r.showingLastKnown, false)
})

test('upstream failure → stale-while-error returns last known with showingLastKnown=true', async () => {
  // Correction 7: a thrown GG error must reach the stale-while-error catch
  // (NOT be swallowed into pending/inconclusive), so last-known data is served.
  // Seed a stale cache row from a prior successful fetch.
  const prior: any = {
    occurrence: { id: '18', number: 18, label: 'Week 18', date: null, activeWindow: { start: '', end: null }, format: 'individual', discoveryState: 'discovered', resultStatus: 'live' },
    leaderboard: { occurrenceId: '18', scoringMode: 'gross', grouping: null, entries: [{ key: 'k', name: 'Hans', positionLabel: '1', positionOrder: 1, points: 50, purse: null, flight: null }], scorecards: [], resultStatus: 'live', durableCurrent: false },
    resultStatus: 'live', eventFormat: 'individual', discoveryState: 'discovered', durableCurrent: false, showingLastKnown: false,
  }
  const cache = makeLiveCacheStore(new Map([['results:igc:mens-league:18:gross', {
    cache_key: 'results:igc:mens-league:18:gross', payload: prior, result_status: 'live',
    fetched_at: new Date(Date.now() - 120_000).toISOString(), expires_at: new Date(Date.now() - 60_000).toISOString(),
  }]]))
  // GG throws on every call — the first discovery fetch rejects and propagates.
  const throwingGg = async () => { throw new Error('GG down') }
  const r = await getLiveResults({
    competitionKey: 'mens-league', occurrenceId: '18', scoring: 'gross',
    nowIso: '2026-07-28T18:00:00-07:00',
    deps: { adapterConfig, ggClient: throwingGg, readEvent: fakeEventReader(null), cacheStore: cache },
  })
  assert.equal(r.showingLastKnown, true)
  assert.ok(r.leaderboard, 'last known leaderboard preserved')
  assert.equal(r.leaderboard!.entries[0].name, 'Hans')
})

test('upstream failure with NO stale data → honest unavailable (unknown, no leaderboard, not showingLastKnown, not pending)', async () => {
  // Correction 7 + plan issue #4: a genuine GG failure with no cached data
  // must NOT collapse into a misleading pending/inconclusive/live verdict.
  // It serves an honest unavailable state: resultStatus 'unknown', no
  // leaderboard, showingLastKnown false. (ResultStatus has no 'pending'
  // value; 'unknown' is the unavailable/error result.)
  const cache = makeLiveCacheStore(new Map())   // empty — no stale row
  const throwingGg = async () => { throw new Error('GG down') }
  const r = await getLiveResults({
    competitionKey: 'mens-league', occurrenceId: '18', scoring: 'gross',
    nowIso: '2026-07-28T18:00:00-07:00',
    deps: { adapterConfig, ggClient: throwingGg, readEvent: fakeEventReader(null), cacheStore: cache },
  })
  assert.equal(r.showingLastKnown, false)
  assert.equal(r.leaderboard, null, 'no leaderboard when no stale data available')
  assert.equal(r.resultStatus, 'unknown', 'unavailable/error result, not pending/live')
})

test('durableCurrent derived from event row source vs import (version equality)', async () => {
  const gg = fakeGg({ tournaments: [], results: {} })
  const cache = makeLiveCacheStore(new Map())
  const r = await getLiveResults({
    competitionKey: 'mens-league', occurrenceId: '18', scoring: 'gross',
    nowIso: '2026-07-28T18:00:00-07:00',
    deps: {
      adapterConfig,
      ggClient: async () => { throw new Error('down') },
      readEvent: fakeEventReader({ event_date: '2026-07-28', event_format: 'individual', discovery_state: 'discovered', source_finalized_at: '2026-07-28T22:00:00Z', source_version: 'v9', durable_source_version: 'v9', durable_imported_at: '2026-07-28T19:00:00Z' }),
      cacheStore: cache,
    },
  })
  assert.equal(r.durableCurrent, true, 'version equality (v9==v9) → current despite older import timestamp')
})

// Club Championship: a configured special occurrence (weekNumber 101) resolves
// from the config spec ALONE — no persisted igc_league_events row. The spec
// supplies the date (active window) + GG event/round ids (discovery hints), so
// live discovery succeeds without a durable row (the Standings contract). The
// spec label is used verbatim; the storage week_number 101 is never shown.
test('Club Championship Round 1 resolves from the config spec with NO persisted row', async () => {
  const gg = fakeGg({
    // The spec's ggRoundId must be present for hint verification to accept it.
    rounds: [{ id: '12263658868441114147', is_points_round: true, date: '2026-08-17' }],
    tournaments: [{ event: { id: 'g1', name: 'Gross CLUB CHAMPIONSHIP Round 1: Points' } }],
    results: {}, // no scores posted yet → not_started
  })
  const cache = makeLiveCacheStore(new Map())
  const r = await getLiveResults({
    competitionKey: 'mens-league', occurrenceId: '101', scoring: 'gross',
    nowIso: '2026-08-17T18:00:00-07:00',
    deps: { adapterConfig, ggClient: gg, readEvent: fakeEventReader(null), cacheStore: cache },
  })
  assert.equal(r.occurrence.label, 'Club Championship - Round 1', 'spec label used, never "Week 101"')
  assert.equal(r.occurrence.date, '2026-08-17', 'spec date drives the active window')
  assert.equal(r.occurrence.number, 101, 'storage id retained internally for routing')
  assert.equal(r.eventFormat, 'individual', 'discovery classified the round from the config hint')
  assert.equal(r.leaderboard, null, 'no scores posted yet → no leaderboard')
  assert.notEqual(r.resultStatus, 'live', 'no live scores to show before tee-off')
})
