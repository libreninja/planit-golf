import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aggregateLeaderboard, type OccurrenceLeaderboard } from '../lib/competition/aggregate.ts'
import type { Scorecard, ResultEntry } from '../lib/competition/types.ts'

function card(opts: Partial<Scorecard> & { key: string }): Scorecard {
  return {
    key: opts.key,
    memberCardId: opts.memberCardId ?? null,
    name: opts.name ?? opts.key,
    netTotal: opts.netTotal ?? null,
    grossTotal: opts.grossTotal ?? null,
    toParNet: opts.toParNet ?? null,
    toParGross: opts.toParGross ?? null,
    holesCompleted: opts.holesCompleted ?? 9,
    scorecardStatus: opts.scorecardStatus ?? null,
    isLive: opts.isLive ?? false,
    holes: opts.holes ?? [],
  }
}

function entry(opts: Partial<ResultEntry> & { key: string }): ResultEntry {
  return {
    key: opts.key,
    name: opts.name ?? opts.key,
    positionLabel: opts.positionLabel ?? null,
    positionOrder: opts.positionOrder ?? 0,
    points: opts.points ?? null,
    purse: opts.purse ?? null,
    flight: opts.flight ?? null,
  }
}

function occ(id: string, scorecards: Scorecard[], entries: ResultEntry[] = []): OccurrenceLeaderboard {
  return { occurrenceId: id, scorecards, entries }
}

// ---------------------------------------------------------------------------
// Totals: the aggregate sums per-member totals across the two occurrences.
// ---------------------------------------------------------------------------

test('sums gross/net totals + to-par across two final 9-hole occurrences', () => {
  const monday = occ('mon', [
    card({ key: 'a', name: 'A', grossTotal: 42, netTotal: 41, toParGross: 2, toParNet: 1, holesCompleted: 9 }),
    card({ key: 'b', name: 'B', grossTotal: 45, netTotal: 44, toParGross: 5, toParNet: 4, holesCompleted: 9 }),
  ])
  const tuesday = occ('tue', [
    card({ key: 'a', name: 'A', grossTotal: 44, netTotal: 43, toParGross: 4, toParNet: 3, holesCompleted: 9 }),
    card({ key: 'b', name: 'B', grossTotal: 43, netTotal: 42, toParGross: 3, toParNet: 2, holesCompleted: 9 }),
  ])
  const agg = aggregateLeaderboard([monday, tuesday], 'gross')
  const byKey = new Map(agg.scorecards.map((c) => [c.key, c]))
  assert.equal(byKey.get('a')!.grossTotal, 86, 'A aggregate gross = 42 + 44')
  assert.equal(byKey.get('a')!.netTotal, 84, 'A aggregate net = 41 + 43')
  assert.equal(byKey.get('a')!.toParGross, 6, 'A aggregate gross to-par = 2 + 4')
  assert.equal(byKey.get('a')!.toParNet, 4)
  assert.equal(byKey.get('b')!.grossTotal, 88, 'B aggregate gross = 45 + 43')
  assert.equal(byKey.get('a')!.holesCompleted, 18, 'A completed both rounds = 18 holes')
})

test('lowest aggregate to-par wins (sort), positions assigned', () => {
  const monday = occ('mon', [
    card({ key: 'a', toParGross: 2, grossTotal: 42, holesCompleted: 9 }),
    card({ key: 'b', toParGross: 5, grossTotal: 45, holesCompleted: 9 }),
  ])
  const tuesday = occ('tue', [
    card({ key: 'a', toParGross: 4, grossTotal: 44, holesCompleted: 9 }),
    card({ key: 'b', toParGross: 3, grossTotal: 43, holesCompleted: 9 }),
  ])
  const agg = aggregateLeaderboard([monday, tuesday], 'gross')
  // A: 2+4=6, B: 5+3=8 → A first
  assert.equal(agg.entries[0].key, 'a')
  assert.equal(agg.entries[0].positionLabel, '1')
  assert.equal(agg.entries[1].key, 'b')
  assert.equal(agg.entries[1].positionLabel, '2')
  assert.equal(agg.entries[0].positionOrder, 1)
  assert.equal(agg.entries[1].positionOrder, 2)
})

test('net scoring mode sorts by aggregate net to-par, not gross', () => {
  const monday = occ('mon', [
    card({ key: 'a', toParGross: 2, toParNet: -3, grossTotal: 42, holesCompleted: 9 }),
    card({ key: 'b', toParGross: 5, toParNet: -1, grossTotal: 45, holesCompleted: 9 }),
  ])
  const tuesday = occ('tue', [
    card({ key: 'a', toParGross: 4, toParNet: 0, grossTotal: 44, holesCompleted: 9 }),
    card({ key: 'b', toParGross: 3, toParNet: -4, grossTotal: 43, holesCompleted: 9 }),
  ])
  const agg = aggregateLeaderboard([monday, tuesday], 'net')
  // A net: -3+0=-3, B net: -1+-4=-5 → B first (lower net wins)
  assert.equal(agg.entries[0].key, 'b', 'B has lower aggregate net to-par')
  assert.equal(agg.entries[0].positionLabel, '1')
  assert.equal(agg.entries[1].key, 'a')
  assert.equal(agg.entries[1].positionLabel, '2')
})

test('ties share a "T" label; next rank skips the tied count (1, T2, T2, 4)', () => {
  const monday = occ('mon', [
    card({ key: 'a', toParGross: 2, grossTotal: 42, holesCompleted: 9 }),
    card({ key: 'b', toParGross: 3, grossTotal: 43, holesCompleted: 9 }),
    card({ key: 'c', toParGross: 3, grossTotal: 43, holesCompleted: 9 }),
    card({ key: 'd', toParGross: 5, grossTotal: 45, holesCompleted: 9 }),
  ])
  const tuesday = occ('tue', [
    card({ key: 'a', toParGross: 2, grossTotal: 42, holesCompleted: 9 }),
    card({ key: 'b', toParGross: 3, grossTotal: 43, holesCompleted: 9 }),
    card({ key: 'c', toParGross: 3, grossTotal: 43, holesCompleted: 9 }),
    card({ key: 'd', toParGross: 5, grossTotal: 45, holesCompleted: 9 }),
  ])
  // aggregates: a=4, b=6, c=6, d=10 → 1, T2, T2, 4
  const agg = aggregateLeaderboard([monday, tuesday], 'gross')
  assert.equal(agg.entries.map((e) => e.positionLabel).join(','), '1,T2,T2,4')
  assert.equal(agg.entries[3].positionOrder, 4)
})

// ---------------------------------------------------------------------------
// Partial-live: Monday final + Tuesday live. isLive rolls up; holesCompleted
// sums; the aggregate updates as Tuesday scores arrive.
// ---------------------------------------------------------------------------

test('partial-live: Monday final + Tuesday in-progress → aggregate isLive, thru 14', () => {
  const monday = occ('mon', [
    card({ key: 'a', grossTotal: 42, toParGross: 2, holesCompleted: 9, isLive: false }),
  ])
  // Tuesday live: A has played 5 of 9.
  const tuesday = occ('tue', [
    card({ key: 'a', grossTotal: 25, toParGross: 1, holesCompleted: 5, isLive: true }),
  ])
  const agg = aggregateLeaderboard([monday, tuesday], 'gross')
  const a = agg.scorecards[0]
  assert.equal(a.isLive, true, 'aggregate is live while Tuesday is in progress')
  assert.equal(a.holesCompleted, 14, '9 + 5 = 14 holes completed')
  assert.equal(a.grossTotal, 67, '42 + 25 running total')
})

test('partial-live: a member not yet started on Tuesday rolls up live (caller injects a 0-hole live card)', () => {
  const monday = occ('mon', [
    card({ key: 'a', grossTotal: 42, toParGross: 2, holesCompleted: 9, isLive: false }),
  ])
  // Tuesday live but A hasn't teed off: caller injects a 0-hole live placeholder
  // so the aggregate stays live (A may still play) instead of reading "F".
  const tuesday = occ('tue', [
    card({ key: 'a', grossTotal: null, toParGross: null, holesCompleted: 0, isLive: true }),
  ])
  const agg = aggregateLeaderboard([monday, tuesday], 'gross')
  const a = agg.scorecards[0]
  assert.equal(a.isLive, true, 'still live — Tuesday ongoing for A')
  assert.equal(a.holesCompleted, 9, 'only Monday counted so far')
  assert.equal(a.grossTotal, 42, 'Monday total carries; Tuesday null contributes nothing')
})

test('when both occurrences are final the aggregate is NOT live ("F")', () => {
  const monday = occ('mon', [card({ key: 'a', grossTotal: 42, toParGross: 2, holesCompleted: 9, isLive: false })])
  const tuesday = occ('tue', [card({ key: 'a', grossTotal: 44, toParGross: 4, holesCompleted: 9, isLive: false })])
  const agg = aggregateLeaderboard([monday, tuesday], 'gross')
  assert.equal(agg.scorecards[0].isLive, false, 'both final → aggregate finished → "F"')
  assert.equal(agg.scorecards[0].holesCompleted, 18)
})

// ---------------------------------------------------------------------------
// Club Championship invariants
// ---------------------------------------------------------------------------

test('aggregate card carries NO per-hole array (never one 18-hole scorecard)', () => {
  const monday = occ('mon', [card({ key: 'a', holes: [{ hole: 1 } as any] })])
  const tuesday = occ('tue', [card({ key: 'a', holes: [{ hole: 1 } as any] })])
  const agg = aggregateLeaderboard([monday, tuesday], 'gross')
  assert.deepEqual(agg.scorecards[0].holes, [], 'aggregate holes always empty — per-hole lives on each occurrence')
})

test('aggregate entries have no purse → Purse column auto-hides (shouldShowPurse)', () => {
  const monday = occ('mon', [
    card({ key: 'a', grossTotal: 42, toParGross: 2, holesCompleted: 9 }),
  ], [entry({ key: 'a', points: 5 })])
  const tuesday = occ('tue', [
    card({ key: 'a', grossTotal: 44, toParGross: 4, holesCompleted: 9 }),
  ], [entry({ key: 'a', points: 5, purse: '$10.00' })])
  const agg = aggregateLeaderboard([monday, tuesday], 'gross')
  assert.ok(agg.entries.every((e) => e.purse === null), 'aggregate purse always null — column hides')
})

test('points are summed across occurrences; entries without a card are ignored', () => {
  const monday = occ('mon', [
    card({ key: 'a', grossTotal: 42, toParGross: 2, holesCompleted: 9 }),
  ], [entry({ key: 'a', points: 5 })])
  const tuesday = occ('tue', [
    card({ key: 'a', grossTotal: 44, toParGross: 4, holesCompleted: 9 }),
  ], [entry({ key: 'a', points: 8 }), entry({ key: 'ghost', points: 99 })]) // ghost has no card
  const agg = aggregateLeaderboard([monday, tuesday], 'gross')
  const a = agg.entries.find((e) => e.key === 'a')!
  assert.equal(a.points, 13, 'points summed across both occurrences')
  assert.ok(!agg.entries.some((e) => e.key === 'ghost'), 'no-card entry ignored')
})

test('a member who played only one occurrence still appears (union of cards)', () => {
  const monday = occ('mon', [
    card({ key: 'a', grossTotal: 42, toParGross: 2, holesCompleted: 9 }),
    card({ key: 'b', grossTotal: 50, toParGross: 10, holesCompleted: 9 }),
  ])
  // Tuesday: only A played.
  const tuesday = occ('tue', [
    card({ key: 'a', grossTotal: 44, toParGross: 4, holesCompleted: 9 }),
  ])
  const agg = aggregateLeaderboard([monday, tuesday], 'gross')
  const byKey = new Map(agg.scorecards.map((c) => [c.key, c]))
  assert.ok(byKey.has('a') && byKey.has('b'), 'both members present (union)')
  assert.equal(byKey.get('a')!.grossTotal, 86, 'A = both rounds')
  assert.equal(byKey.get('b')!.grossTotal, 50, 'B = Monday only')
  assert.equal(byKey.get('b')!.holesCompleted, 9)
})

test('members with no aggregate to-par are unplaced (positionLabel null, sorted last)', () => {
  const monday = occ('mon', [
    card({ key: 'a', grossTotal: 42, toParGross: 2, holesCompleted: 9 }),
    card({ key: 'noscore', grossTotal: null, toParGross: null, holesCompleted: 0, isLive: true }),
  ])
  const tuesday = occ('tue', [
    card({ key: 'a', grossTotal: 44, toParGross: 4, holesCompleted: 9 }),
    card({ key: 'noscore', grossTotal: null, toParGross: null, holesCompleted: 0, isLive: true }),
  ])
  const agg = aggregateLeaderboard([monday, tuesday], 'gross')
  assert.equal(agg.entries[0].key, 'a', 'scored member first')
  assert.equal(agg.entries[0].positionLabel, '1')
  assert.equal(agg.entries[1].key, 'noscore', 'no-score member last')
  assert.equal(agg.entries[1].positionLabel, null, 'unplaced → no label')
})