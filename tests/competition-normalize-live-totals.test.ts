import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeTournament,
  type GGResultsFixture,
  type GGAggregate,
} from '../lib/competition/adapters/golfgenius/normalize.ts'
import { aggregateLeaderboard } from '../lib/competition/aggregate.ts'

// Live-totals fallback regression coverage. GG populates `a.totals`
// (out/in/total) only at finalization; a card in progress has null summary
// totals even though per-hole scores are present. normalizeTournament now
// derives running Gross/Net + To Par from the scored holes when totals are
// absent, while finalized totals always take precedence.

function scope(aggregate: GGAggregate): GGResultsFixture {
  return { event: { scopes: [{ name: 'Overall', aggregates: [aggregate] }] } }
}

// Bell, Jerry — the production trace: +2 thru 3 holes, no totals (live).
// par 4,3,3 → gross 5,4,3 → gross to-par +1,+1,0 ; net == gross here.
function bellLive(): GGAggregate {
  return {
    name: 'Bell, Jerry',
    position: null,
    points: null,
    purse: null,
    member_cards: [{ member_card_id_str: 'mc-bell' }],
    gross_scores: [5, 4, 3, null, null, null, null, null, null],
    net_scores: [5, 4, 3, null, null, null, null, null, null],
    to_par_gross: [1, 1, 0, null, null, null, null, null, null],
    to_par_net: [1, 1, 0, null, null, null, null, null, null],
    // no `totals` — live, not finalized
    scorecard_statuses: [{ status: 'partial' }],
  }
}

// 1. partial 9-hole card with 3 scored holes: grossTotal + toParGross derived.
test('live partial card: grossTotal + toParGross derived from scored holes', () => {
  const { scorecards } = normalizeTournament(scope(bellLive()), 'gross')
  const card = scorecards.get('mc-bell')!
  assert.equal(card.holesCompleted, 3)
  assert.equal(card.grossTotal, 12) // 5 + 4 + 3
  assert.equal(card.toParGross, 2) // 1 + 1 + 0
  assert.equal(card.isLive, true)
  assert.equal(card.scorecardStatus, 'partial')
})

// 2. net equivalent: netTotal derived, toParNet = latest cumulative net to-par.
test('live partial card: netTotal + toParNet derived from scored holes', () => {
  const { scorecards } = normalizeTournament(scope(bellLive()), 'net')
  const card = scorecards.get('mc-bell')!
  assert.equal(card.netTotal, 12) // 5 + 4 + 3
  // cumulativeToPar is the running NET to-par: 1, 2, 2 → latest = 2
  assert.equal(card.toParNet, 2)
  assert.equal(card.isLive, true)
})

// 3. unplayed holes do not contribute (18-hole card, 3 scored, 15 trailing nulls).
test('unplayed holes do not contribute to derived totals', () => {
  const agg: GGAggregate = {
    name: 'Partial, Pat',
    position: null,
    points: null,
    purse: null,
    member_cards: [{ member_card_id_str: 'mc-pat' }],
    gross_scores: [5, 4, 3, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    net_scores: [5, 4, 3, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    to_par_gross: [1, 1, 0, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    to_par_net: [1, 1, 0, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    scorecard_statuses: [{ status: 'partial' }],
  }
  const { scorecards } = normalizeTournament(scope(agg), 'gross')
  const card = scorecards.get('mc-pat')!
  assert.equal(card.holesCompleted, 3)
  assert.equal(card.grossTotal, 12) // only the 3 scored holes; 15 nulls add nothing
  assert.equal(card.toParGross, 2)
  assert.equal(card.isLive, true) // 3 > 0 && 3 < 18
})

// 4. finalized GG totals take precedence over derived-from-holes values.
test('finalized a.totals take precedence over holes-derived values', () => {
  const agg: GGAggregate = {
    name: 'Final, Finn',
    position: '1',
    points: '50',
    purse: null,
    member_cards: [{ member_card_id_str: 'mc-finn' }],
    // holes sum to 12 / to-par 2, but the finalized totals say 16 / +5
    gross_scores: [5, 4, 3],
    net_scores: [5, 4, 3],
    to_par_gross: [1, 1, 0],
    to_par_net: [1, 1, 0],
    totals: {
      gross_scores: { out: 16, total: 16 },
      net_scores: { out: 16, total: 16 },
      to_par_gross: { out: 5, total: 5 },
      to_par_net: { out: 5, total: 5 },
    },
    scorecard_statuses: [{ status: 'completed' }],
  }
  const { scorecards } = normalizeTournament(scope(agg), 'gross')
  const card = scorecards.get('mc-finn')!
  assert.equal(card.grossTotal, 16) // totals, NOT 12
  assert.equal(card.toParGross, 5) // totals, NOT 2
  assert.equal(card.netTotal, 16)
  assert.equal(card.toParNet, 5)
})

// 5. zero holes posted does NOT become a fake score of 0 / E.
test('zero scored holes yields null totals, not a fake 0 / E', () => {
  const agg: GGAggregate = {
    name: 'Empty, Eve',
    position: null,
    points: null,
    purse: null,
    member_cards: [{ member_card_id_str: 'mc-eve' }],
    gross_scores: [],
    net_scores: [],
    to_par_gross: [],
    to_par_net: [],
    // no totals
    scorecard_statuses: [{ status: 'not_started' }],
  }
  const { scorecards } = normalizeTournament(scope(agg), 'gross')
  const card = scorecards.get('mc-eve')!
  assert.equal(card.holesCompleted, 0)
  assert.equal(card.grossTotal, null) // NOT 0
  assert.equal(card.netTotal, null) // NOT 0
  assert.equal(card.toParGross, null) // NOT 0 / "E"
  assert.equal(card.toParNet, null) // NOT 0 / "E"
  assert.equal(card.isLive, false)
})

// 6. partial Club Championship aggregate receives the derived live totals.
// Round 1 LIVE (Bell, derived totals), Round 2 NOT STARTED (no aggregates).
// The aggregate must carry Round 1's running totals as the partial aggregate.
test('partial Club Championship aggregate inherits derived live totals', () => {
  const r1 = normalizeTournament(scope(bellLive()), 'gross')
  const round1 = {
    occurrenceId: '101',
    scorecards: [...r1.scorecards.values()],
    entries: [...r1.entriesByFlight.values()].flat(),
  }
  // Round 2 not started — no aggregates, no scorecards for this member.
  const round2 = {
    occurrenceId: '102',
    scorecards: [],
    entries: [],
  }
  const agg = aggregateLeaderboard([round1, round2], 'gross')
  const bell = agg.scorecards.find((s) => s.key === 'mc-bell')!
  assert.ok(bell, 'Bell has an aggregate line from Round 1 alone')
  assert.equal(bell.grossTotal, 12) // Round 1 derived total, Round 2 contributes null
  assert.equal(bell.toParGross, 2)
  assert.equal(bell.holesCompleted, 3)
  assert.equal(bell.isLive, true)
  assert.deepEqual(bell.holes, []) // aggregate invariant: no per-hole array
})

// 7. existing finalized 9-hole behavior remains unchanged.
test('finalized 9-hole card: totals from a.totals, isLive false (unchanged)', () => {
  const agg: GGAggregate = {
    name: 'Nine, Nina',
    position: '1',
    points: '40',
    purse: null,
    member_cards: [{ member_card_id_str: 'mc-nina' }],
    gross_scores: [5, 4, 3, 4, 5, 4, 3, 4, 5],
    net_scores: [5, 4, 3, 4, 5, 4, 3, 4, 5],
    to_par_gross: [1, 1, 0, 0, 1, 0, -1, 0, 1],
    to_par_net: [1, 1, 0, 0, 1, 0, -1, 0, 1],
    // finalized totals differ from the raw hole sum to prove precedence
    totals: {
      gross_scores: { out: 40, total: 40 },
      net_scores: { out: 40, total: 40 },
      to_par_gross: { out: 4, total: 4 },
      to_par_net: { out: 4, total: 4 },
    },
    scorecard_statuses: [{ status: 'completed' }],
  }
  const { scorecards } = normalizeTournament(scope(agg), 'gross')
  const card = scorecards.get('mc-nina')!
  assert.equal(card.holesCompleted, 9)
  assert.equal(card.grossTotal, 40) // totals, not the hole sum (37)
  assert.equal(card.toParGross, 4) // totals, not the hole sum (3)
  assert.equal(card.isLive, false) // 9 holes, 9 < 9 is false → finalized
})

// 8. 18-hole normalization remains unchanged.
test('finalized 18-hole card: totals from a.totals, isLive false (unchanged)', () => {
  const gross = Array.from({ length: 18 }, (_, i) => 4 + (i % 3))
  const tpg = gross.map((g) => g - 4) // par 4 throughout → to-par deltas
  const agg: GGAggregate = {
    name: 'Eighteen, Eli',
    position: '1',
    points: '50',
    purse: null,
    member_cards: [{ member_card_id_str: 'mc-eli' }],
    gross_scores: gross,
    net_scores: gross,
    to_par_gross: tpg,
    to_par_net: tpg,
    totals: {
      gross_scores: { out: 40, in: 38, total: 78 },
      net_scores: { out: 40, in: 38, total: 78 },
      to_par_gross: { out: 4, in: 2, total: 6 },
      to_par_net: { out: 4, in: 2, total: 6 },
    },
    scorecard_statuses: [{ status: 'completed' }],
  }
  const { scorecards } = normalizeTournament(scope(agg), 'gross')
  const card = scorecards.get('mc-eli')!
  assert.equal(card.holesCompleted, 18)
  // totalOut prefers `out` (front-9) over `total` — EXISTING finalized
  // behavior, unchanged by this fix. The point: grossTotal comes from
  // a.totals (40), NOT from the holes-derived sum (90), so the live
  // fallback did not fire for a finalized card.
  assert.equal(card.grossTotal, 40)
  assert.equal(card.toParGross, 4)
  assert.equal(card.isLive, false) // 18 holes, 18 < 18 is false → finalized
})