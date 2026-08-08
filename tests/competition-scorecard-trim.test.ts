import { test } from 'node:test'
import assert from 'node:assert/strict'

import { normalizeTournament, type GGResultsFixture } from '../lib/competition/adapters/golfgenius/normalize.ts'
import { buildHoles, trimScorecardsToRoundHoles, roundHoleCount, isPartialRound } from '../lib/igc/weekly-results-helpers.ts'

// A 9-hole Interbay league round as GG returns it: 18-slot arrays with the
// back nine padded to null. Holes 1–9 carry real gross/net/to-par; 10–18 are
// empty. holesCompleted=9 on a finished card.
function nineHoleArrays() {
  const real = [4, 5, 4, 6, 5, 4, 5, 4, 5]
  const gross = [...real, ...Array(9).fill(null)]
  const net = [...real, ...Array(9).fill(null)]
  const toParNet = [-1, 0, -1, 1, 0, -1, 0, -1, 0, ...Array(9).fill(null)]
  const toParGross = [0, 0, 0, 1, 0, -1, 0, -1, 0, ...Array(9).fill(null)]
  return { gross, net, toParNet, toParGross, real }
}

function eighteenHoleArrays() {
  const real = Array.from({ length: 18 }, (_, i) => 4 + (i % 3))
  const toPar = Array.from({ length: 18 }, (_, i) => (i % 2 ? 1 : -1))
  return {
    gross: real,
    net: real,
    toParNet: toPar,
    toParGross: toPar,
  }
}

// ---------------------------------------------------------------------------
// Historical read path: buildHoles → trimScorecardsToRoundHoles(false)
// ---------------------------------------------------------------------------

test('9-hole round with 18-slot GG arrays trims to 9 rendered holes', () => {
  const { gross, net, toParNet, toParGross } = nineHoleArrays()
  const holes = buildHoles(gross, net, toParNet, toParGross)
  // Before trim, buildHoles pads to the full 18-slot length.
  assert.equal(holes.length, 18)
  const card = { holes, holesCompleted: 9, isLive: false }
  trimScorecardsToRoundHoles([card], false)
  assert.equal(card.holes.length, 9, 'card carries exactly 9 holes after trim')
})

test('holes 10–18 are REMOVED, not visually hidden (array is shorter)', () => {
  const { gross, net, toParNet, toParGross } = nineHoleArrays()
  const holes = buildHoles(gross, net, toParNet, toParGross)
  const card = { holes, holesCompleted: 9, isLive: false }
  trimScorecardsToRoundHoles([card], false)
  assert.equal(card.holes.length, 9)
  // The surviving holes are 1..9 — no hole numbered >= 10 remains in the array.
  assert.deepEqual(card.holes.map((h) => h.hole), [1, 2, 3, 4, 5, 6, 7, 8, 9])
})

test('real scoring for holes 1–9 is preserved after trimming', () => {
  const { gross, net, toParNet, toParGross, real } = nineHoleArrays()
  const holes = buildHoles(gross, net, toParNet, toParGross)
  const card = { holes, holesCompleted: 9, isLive: false }
  trimScorecardsToRoundHoles([card], false)
  assert.deepEqual(card.holes.map((h) => h.gross), real, 'gross scores 1–9 intact')
  assert.deepEqual(card.holes.map((h) => h.net), real, 'net scores 1–9 intact')
  assert.deepEqual(
    card.holes.map((h) => h.toPar),
    [-1, 0, -1, 1, 0, -1, 0, -1, 0],
    'net to-par 1–9 intact',
  )
})

test('18-hole occurrence still renders all 18 holes', () => {
  const { gross, net, toParNet, toParGross } = eighteenHoleArrays()
  const holes = buildHoles(gross, net, toParNet, toParGross)
  const card = { holes, holesCompleted: 18, isLive: false }
  trimScorecardsToRoundHoles([card], false)
  assert.equal(card.holes.length, 18, 'no holes trimmed for a full 18-hole round')
})

test('Gross and Net arrays remain aligned after trimming', () => {
  const { gross, net, toParNet, toParGross } = nineHoleArrays()
  const holes = buildHoles(gross, net, toParNet, toParGross)
  const card = { holes, holesCompleted: 9, isLive: false }
  trimScorecardsToRoundHoles([card], false)
  for (const h of card.holes) {
    // For a played hole, gross and net sit at the same index. No misalignment
    // introduced by the slice (trim keeps the leading prefix).
    assert.equal(typeof h.gross, typeof h.net)
  }
  assert.equal(card.holes.length, 9)
})

test('to-par arrays remain aligned after trimming', () => {
  const { gross, net, toParNet, toParGross } = nineHoleArrays()
  const holes = buildHoles(gross, net, toParNet, toParGross)
  const card = { holes, holesCompleted: 9, isLive: false }
  trimScorecardsToRoundHoles([card], false)
  // toPar (net) and toParGross stay at the same indices; both present on each
  // played hole.
  assert.deepEqual(
    card.holes.map((h) => h.toPar),
    card.holes.map((h) => h.toPar).slice(0, 9),
  )
  assert.equal(card.holes[0].toParGross, 0)
})

test('trimming does NOT regress scorecard totals (GG-provided, separate from holes)', () => {
  // Totals are stored separately (netTotal/grossTotal/toPar*) and are never
  // derived from the holes array length. Trimming the holes array leaves them.
  const { gross, net, toParNet, toParGross } = nineHoleArrays()
  const holes = buildHoles(gross, net, toParNet, toParGross)
  const card = {
    holes,
    holesCompleted: 9,
    isLive: false,
    netTotal: 41,
    grossTotal: 43,
    toParNet: -4,
    toParGross: -2,
  } as any
  trimScorecardsToRoundHoles([card], false)
  assert.equal((card as any).netTotal, 41)
  assert.equal((card as any).grossTotal, 43)
  assert.equal((card as any).toParNet, -4)
  assert.equal((card as any).toParGross, -2)
})

// ---------------------------------------------------------------------------
// Live recompute: isLive derived against the REAL course length
// ---------------------------------------------------------------------------

test('live recompute: finished 9-hole card is NOT live (reads "F", not "thru 9")', () => {
  const { gross, net, toParNet, toParGross } = nineHoleArrays()
  const holes = buildHoles(gross, net, toParNet, toParGross)
  // Before trim, normalize would flag 9-of-18 as live against the padded 18.
  const card = { holes, holesCompleted: 9, isLive: isPartialRound(9, 18) }
  assert.equal(card.isLive, true, 'pre-trim: 9 < 18 → live (the bug)')
  trimScorecardsToRoundHoles([card], true)
  assert.equal(card.isLive, false, 'post-trim: 9 == 9 → finished → "F"')
})

test('live recompute: in-progress 9-hole card stays live against real course', () => {
  const { gross, net, toParNet, toParGross } = nineHoleArrays()
  const holes = buildHoles(gross, net, toParNet, toParGross)
  // The course length derives from the field's max-completed card, so include
  // a finished leader (9) alongside an in-progress player (5). roundHoles=9,
  // the in-progress card trims to 9 and stays live (5 < 9 → "thru 5").
  const finished = { holes: holes.slice(), holesCompleted: 9, isLive: false }
  const inProgress = { holes: holes.slice(), holesCompleted: 5, isLive: true }
  trimScorecardsToRoundHoles([finished, inProgress], true)
  assert.equal(inProgress.holes.length, 9)
  assert.equal(inProgress.isLive, true, '5 < 9 → still live → "thru 5"')
  assert.equal(finished.isLive, false, '9 == 9 → finished → "F"')
})

test('roundHoleCount = max holesCompleted across the field (course length)', () => {
  const { gross, net, toParNet, toParGross } = nineHoleArrays()
  const holes = buildHoles(gross, net, toParNet, toParGross)
  const field = [
    { holes: holes.slice(), holesCompleted: 9, isLive: false },   // finished
    { holes: holes.slice(), holesCompleted: 7, isLive: true },    // in progress
    { holes: holes.slice(), holesCompleted: 5, isLive: true },     // in progress
  ]
  assert.equal(roundHoleCount(field), 9, 'leader determines the round hole count')
  trimScorecardsToRoundHoles(field, true)
  assert.equal(field[1].holes.length, 9)
  assert.equal(field[1].isLive, true, '7 < 9 → live')
  assert.equal(field[2].isLive, true, '5 < 9 → live')
})

// ---------------------------------------------------------------------------
// Live path integration: normalizeTournament → trimScorecardsToRoundHoles(true)
// ---------------------------------------------------------------------------

function nineHoleFixture(): GGResultsFixture {
  const { gross, net, toParNet, toParGross, real } = nineHoleArrays()
  return {
    event: {
      scopes: [
        {
          name: 'Flight 1',
          aggregates: [
            {
              name: 'Hans Olson',
              position: '1',
              points: '50',
              purse: '$55.00',
              member_cards: [{ member_card_id_str: 'mc-1' }],
              net_scores: net,
              gross_scores: gross,
              to_par_net: toParNet,
              to_par_gross: toParGross,
              totals: { net_scores: { out: real.reduce((a, b) => a + b, 0), total: real.reduce((a, b) => a + b, 0) }, gross_scores: { out: real.reduce((a, b) => a + b, 0), total: real.reduce((a, b) => a + b, 0) } },
              scorecard_statuses: [{ status: 'completed' }],
            },
          ],
        },
      ],
    },
  }
}

test('live path: a 9-hole GG fixture normalizes to 18 slots then trims to 9', () => {
  const norm = normalizeTournament(nineHoleFixture(), 'gross')
  const cards = [...norm.scorecards.values()]
  assert.equal(cards[0].holes.length, 18, 'pre-trim: normalize pads to 18 slots')
  trimScorecardsToRoundHoles(cards, true)
  assert.equal(cards[0].holes.length, 9, 'post-trim: 9 holes only')
  assert.deepEqual(
    cards[0].holes.map((h) => h.hole),
    [1, 2, 3, 4, 5, 6, 7, 8, 9],
    'holes 10–18 removed, 1–9 retained',
  )
  assert.equal(cards[0].isLive, false, 'finished 9-hole card → "F", not "thru 9"')
  // Totals untouched by trim (GG-provided out=42 for the 9 real holes).
  assert.equal(cards[0].grossTotal, 42)
})

// ---------------------------------------------------------------------------
// Club Championship invariant: TWO independent 9-hole occurrences, NOT one
// 18-hole scorecard. Each occurrence trims to 9 on its own. The aggregate is a
// separate derived concept that sums the two — it is never a single 18-hole
// scorecard.
// ---------------------------------------------------------------------------

test('Club Championship invariant: two 9-hole occurrences each trim to 9, never one 18-hole card', () => {
  // Monday occurrence
  const monday = normalizeTournament(nineHoleFixture(), 'gross')
  const mondayCards = [...monday.scorecards.values()]
  trimScorecardsToRoundHoles(mondayCards, true)
  // Tuesday occurrence (separate fixture → separate cards)
  const tuesday = normalizeTournament(nineHoleFixture(), 'gross')
  const tuesdayCards = [...tuesday.scorecards.values()]
  trimScorecardsToRoundHoles(tuesdayCards, true)

  assert.equal(mondayCards[0].holes.length, 9, 'Monday: 9 holes')
  assert.equal(tuesdayCards[0].holes.length, 9, 'Tuesday: 9 holes')
  assert.notEqual(mondayCards[0], tuesdayCards[0], 'distinct card objects per occurrence')

  // The aggregate championship total is a DERIVED sum across the two
  // occurrences (18 holes total), NOT a single 18-hole scorecard. Each
  // underlying expanded scorecard stays 9 holes.
  const aggregateGross = (mondayCards[0].grossTotal ?? 0) + (tuesdayCards[0].grossTotal ?? 0)
  assert.equal(aggregateGross, 84, '18-hole aggregate = Monday 42 + Tuesday 42')
  assert.equal(mondayCards[0].holes.length + tuesdayCards[0].holes.length, 18)
  assert.equal(mondayCards[0].holes.length, 9, 'each expanded card remains 9 holes, not 18')
})

test('an 18-hole occurrence (future format) is not over-trimmed to 9', () => {
  const { gross, net, toParNet, toParGross } = eighteenHoleArrays()
  const holes = buildHoles(gross, net, toParNet, toParGross)
  const card = { holes, holesCompleted: 18, isLive: false }
  trimScorecardsToRoundHoles([card], false)
  assert.equal(card.holes.length, 18, '18-hole round keeps all 18 holes — no 9-hole assumption')
})