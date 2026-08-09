import { test } from 'node:test'
import assert from 'node:assert/strict'
import { discoverOccurrence, pickGrossNet, type DiscoverInput } from '../lib/competition/adapters/golfgenius/discovery.ts'
import type { DiscoveredTournament } from '../lib/competition/classify.ts'

// P0: per-round GG tournament selection for the Club Championship.
//
// The CC event (12263651301715371717) lists, in EACH round's tournament list:
//   - the OVERALL championship tournament (result_scope='rs_field'), with the
//     SAME id across both rounds — GG's own cross-round aggregate
//   - the PER-ROUND tournament (result_scope='rs_flight'), unique per round
//
// Today's pickGrossNet grabbed the FIRST /gross/ match = the overall (it's
// listed first), so BOTH rounds would read GG's combined-18-hole overall
// instead of their own 9-hole round — double-counting in the Planit aggregate.
//
// Fix: when more than one gross/net candidate exists, prefer the per-round
// (rs_flight) over the overall (rs_field). These tests use the REAL GG ids
// captured from the live event metadata (probe-cc-tournament-fields.mjs).

const ROUNDS = {
  R1: '12263658868441114147',
  R2: '12263654969047016987',
}
const EVENT = '12263651301715371717'

// Overall (rs_field) — identical across both rounds.
const OVERALL_GROSS = { id: '12942038792293869285', name: "Gross IGC Men's Club Championship 2026", result_scope: 'rs_field' }
const OVERALL_NET = { id: '12942038813097617126', name: "Net IGC Men's Club Championship 2026", result_scope: 'rs_field' }
// Per-round (rs_flight) — unique per round.
const R1_GROSS = { id: '12942031306132317916', name: 'Gross CLUB CHAMPIONSHIP Round 1: Points Only', result_scope: 'rs_flight' }
const R1_NET = { id: '12942031321231812317', name: 'Net CLUB CHAMPIONSHIP Round 1: Points Only', result_scope: 'rs_flight' }
const R2_GROSS = { id: '12942038059666400994', name: 'Gross CLUB CHAMPIONSHIP Round 2: Points and Purse', result_scope: 'rs_flight' }
const R2_NET = { id: '12942038072819738339', name: 'Net CLUB CHAMPIONSHIP Round 2: Points and Purse', result_scope: 'rs_flight' }

function mkT(t: { id: string; name: string; result_scope: string }): DiscoveredTournament {
  return { id: t.id, name: t.name, metadataFormat: null, nameKind: 'individual', resultScope: t.result_scope as 'rs_field' | 'rs_flight' }
}

test('pickGrossNet: Round 1 list picks the per-round (rs_flight) gross+net, NOT the overall', () => {
  // GG lists the overall FIRST — the old bug grabbed it.
  const list = [OVERALL_GROSS, OVERALL_NET, R1_GROSS, R1_NET].map(mkT)
  const gn = pickGrossNet(list)
  assert.equal(gn.gross, R1_GROSS.id, 'Round 1 gross must be the Round 1 per-round tournament, not the overall')
  assert.equal(gn.net, R1_NET.id, 'Round 1 net must be the Round 1 per-round tournament, not the overall')
  assert.notEqual(gn.gross, OVERALL_GROSS.id)
  assert.notEqual(gn.net, OVERALL_NET.id)
})

test('pickGrossNet: Round 2 list picks the per-round (rs_flight) gross+net, NOT the overall', () => {
  const list = [OVERALL_GROSS, OVERALL_NET, R2_GROSS, R2_NET].map(mkT)
  const gn = pickGrossNet(list)
  assert.equal(gn.gross, R2_GROSS.id)
  assert.equal(gn.net, R2_NET.id)
  assert.notEqual(gn.gross, OVERALL_GROSS.id)
  assert.notEqual(gn.net, OVERALL_NET.id)
})

test('pickGrossNet: the two rounds resolve to DIFFERENT per-round tournaments (no double-counting)', () => {
  const r1 = pickGrossNet([OVERALL_GROSS, OVERALL_NET, R1_GROSS, R1_NET].map(mkT))
  const r2 = pickGrossNet([OVERALL_GROSS, OVERALL_NET, R2_GROSS, R2_NET].map(mkT))
  assert.notEqual(r1.gross, r2.gross, 'Round 1 and Round 2 gross must differ')
  assert.notEqual(r1.net, r2.net, 'Round 1 and Round 2 net must differ')
  // And neither round uses the shared overall ids.
  for (const id of [r1.gross, r1.net, r2.gross, r2.net]) {
    assert.ok(id !== OVERALL_GROSS.id && id !== OVERALL_NET.id, `round must not consume the overall aggregate: ${id}`)
  }
})

test('pickGrossNet: a single-candidate week (no overall, rs_flight only) is unchanged', () => {
  // Normal weekly round: one gross + one net, both rs_flight, no overall.
  const list = [
    { id: 'wg', name: 'Gross Regular Season', result_scope: 'rs_flight' },
    { id: 'wn', name: 'Net Regular Season', result_scope: 'rs_flight' },
  ].map(mkT)
  const gn = pickGrossNet(list)
  assert.equal(gn.gross, 'wg')
  assert.equal(gn.net, 'wn')
})

test('pickGrossNet: overall-only ambiguity with unknown scope falls back to a non-field candidate', () => {
  // If a per-round tournament lacked result_scope (older GG), it must still be
  // preferred over the rs_field overall (it is "non-field").
  const list: DiscoveredTournament[] = [
    { id: OVERALL_GROSS.id, name: OVERALL_GROSS.name, metadataFormat: null, nameKind: 'individual', resultScope: 'rs_field' },
    { id: 'pg', name: 'Gross Round 1', metadataFormat: null, nameKind: 'individual', resultScope: null },
  ]
  const gn = pickGrossNet(list)
  assert.equal(gn.gross, 'pg', 'unknown-scope per-round is preferred over the rs_field overall')
})

// ---- End-to-end: discoverOccurrence resolves the right per-round tournament ----
// Proves the contract at the discovery level, not just the picker: with the CC
// round id hinted, discovery selects that round and picks its per-round gross/net.

function fakeGg(opts: { eventRounds?: any[]; tournaments?: any[]; results?: Record<string, any> }) {
  const fn = async (endpoint: string) => {
    if (/\/events\/[^/]+\/rounds$/.test(endpoint) && opts.eventRounds !== undefined) return opts.eventRounds
    if (endpoint.endsWith('/tournaments') && !endpoint.includes('.json')) return opts.tournaments ?? []
    if (/\/events\/[^/]+\/rounds$/.test(endpoint)) return []
    const tId = endpoint.split('/').slice(-1)[0].replace('.json', '')
    return opts.results?.[tId] ?? { event: { scopes: [] } }
  }
  return fn
}

const baseInput = (over: Partial<DiscoverInput>): DiscoverInput => ({
  competitionKey: 'mens-league',
  tenantKey: 'igc',
  adapterConfig: { seasonId: 'S', categoryId: 'C', eventFilter: 'mens', tenantKey: 'igc', roundResolution: 'byDateWindow' },
  occurrenceContext: { number: 101, date: '2026-08-17' },
  persistedHints: null,
  teamOverride: false,
  ggClient: (async () => []) as any,
  scoringMode: 'gross',
  ...over,
})

test('discoverOccurrence: Round 1 (hinted round id) → resolved gross/net are the Round 1 per-round tournaments', async () => {
  const gg = fakeGg({
    eventRounds: [{ id: ROUNDS.R1, date: '2026-08-17' }, { id: ROUNDS.R2, date: '2026-08-18' }],
    tournaments: [
      { event: { ...OVERALL_GROSS } },
      { event: { ...OVERALL_NET } },
      { event: { ...R1_GROSS } },
      { event: { ...R1_NET } },
    ],
    // No posted scores yet → empty scopes → not_started (we only assert ids).
    results: {},
  })
  const r = await discoverOccurrence({
    ...baseInput({
      ggClient: gg,
      persistedHints: { ggEventId: EVENT, ggRoundId: ROUNDS.R1, grossTournamentId: null, netTournamentId: null },
    }),
  })
  assert.equal(r.resolved.ggRoundId, ROUNDS.R1)
  assert.equal(r.resolved.grossTournamentId, R1_GROSS.id, 'discovered gross must be Round 1 per-round, not the overall')
  assert.equal(r.resolved.netTournamentId, R1_NET.id, 'discovered net must be Round 1 per-round, not the overall')
})

test('discoverOccurrence: Round 2 (hinted round id) → resolved gross/net are the Round 2 per-round tournaments', async () => {
  const gg = fakeGg({
    eventRounds: [{ id: ROUNDS.R1, date: '2026-08-17' }, { id: ROUNDS.R2, date: '2026-08-18' }],
    tournaments: [
      { event: { ...OVERALL_GROSS } },
      { event: { ...OVERALL_NET } },
      { event: { ...R2_GROSS } },
      { event: { ...R2_NET } },
    ],
    results: {},
  })
  const r = await discoverOccurrence({
    ...baseInput({
      ggClient: gg,
      occurrenceContext: { number: 102, date: '2026-08-18' },
      persistedHints: { ggEventId: EVENT, ggRoundId: ROUNDS.R2, grossTournamentId: null, netTournamentId: null },
    }),
    scoringMode: 'gross',
  })
  assert.equal(r.resolved.ggRoundId, ROUNDS.R2)
  assert.equal(r.resolved.grossTournamentId, R2_GROSS.id)
  assert.equal(r.resolved.netTournamentId, R2_NET.id)
})