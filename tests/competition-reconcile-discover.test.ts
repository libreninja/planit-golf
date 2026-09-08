import { test } from 'node:test'
import assert from 'node:assert/strict'
import { discoverAndPersistEventClassification } from '../lib/competition/reconcile/discover.ts'

function fakeGg(opts: { tournaments: any[]; results: Record<string, any>; events?: any[]; rounds?: any[]; roundStatus?: string }) {
  return async (endpoint: string) => {
    if (endpoint.includes('/events?season=')) return opts.events ?? [{ id: 'E', category_id: 'C' }]
    if (endpoint.endsWith('/rounds')) return opts.rounds ?? [{ id: 'R1', is_points_round: true, position: 18, status: opts.roundStatus }]
    if (endpoint.endsWith('/tournaments') && !endpoint.includes('.json')) return opts.tournaments
    const tId = endpoint.split('/').slice(-1)[0].replace('.json', '')
    return opts.results[tId] ?? { event: { scopes: [], status: opts.roundStatus } }
  }
}

const adapterConfig = { seasonId: 'S', categoryId: 'C', eventFilter: 'mens', tenantKey: 'igc', roundResolution: 'pointsRoundIndex' as const }

test('persists individual/discovered and source_finalized_at when upstream completed', async () => {
  const writes: any[] = []
  const db = { updateClassification: async (w: any) => { writes.push(w); return { ok: true } } }
  const gg = fakeGg({
    tournaments: [{ event: { id: 'g1', name: 'Gross Regular Season' } }],
    results: { g1: { event: { status: 'completed', scopes: [{ name: 'Flight 1', aggregates: [{ name: 'Hans', position: '1', gross_scores: [5,6], net_scores: [4,5], to_par_net: [-1,0], to_par_gross: [0,0], totals: { gross_scores: { out: 11 } } }] }] } } },
    roundStatus: 'completed',
  })
  const r = await discoverAndPersistEventClassification({ competitionKey: 'mens-league', weekNumber: 18, adapterConfig, ggClient: gg, db: db as any, nowIso: '2026-07-28T22:00:00Z' })
  assert.equal(r.eventFormat, 'individual')
  assert.equal(r.discoveryState, 'discovered')
  assert.ok(writes[0].source_finalized_at, 'source_finalized_at persisted when completed')
  assert.equal(writes[0].status, 'finalized')
})

test('persists unknown/pending for an upcoming round with no tournaments', async () => {
  const writes: any[] = []
  const db = { updateClassification: async (w: any) => { writes.push(w); return { ok: true } } }
  const gg = fakeGg({ tournaments: [], results: {}, roundStatus: 'not_started' })
  const r = await discoverAndPersistEventClassification({ competitionKey: 'mens-league', weekNumber: 19, adapterConfig, ggClient: gg, db: db as any, nowIso: '2026-07-29T22:00:00Z' })
  assert.equal(r.eventFormat, 'unknown')
  assert.equal(r.discoveryState, 'pending')
  assert.equal(writes[0].source_finalized_at, null)
  assert.equal(writes[0].status, 'upcoming')
})

test('rediscovery demotes a premature finalized row when GG is still in progress', async () => {
  const writes: any[] = []
  const db = { updateClassification: async (w: any) => { writes.push(w); return { ok: true } } }
  const gg = fakeGg({
    tournaments: [{ event: { id: 'n1', name: 'Net Regular Season' } }],
    results: { n1: { event: { scopes: [{ name: 'Overall', aggregates: [
      { name: 'Early', position: '1', gross_scores: [4], net_scores: [3], to_par_net: [0], to_par_gross: [1], scorecard_statuses: [{ status: 'completed' }] },
      { name: 'Later', position: null, gross_scores: [null], net_scores: [null], to_par_net: [null], to_par_gross: [null], scorecard_statuses: [{ status: 'no_holes' }] },
    ] }] } } },
  })
  await discoverAndPersistEventClassification({ competitionKey: 'mens-league', weekNumber: 22, adapterConfig, ggClient: gg, db: db as any, nowIso: '2026-09-08T20:15:00Z' })
  assert.equal(writes[0].source_finalized_at, null)
  assert.equal(writes[0].status, 'live')
})
