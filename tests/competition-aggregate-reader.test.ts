import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getChampionshipAggregate, championshipRounds } from '../lib/competition/aggregate-reader.ts'
import type { LiveResponse, Scorecard, ResultEntry, ScoringMode } from '../lib/competition/types.ts'

function card(opts: Partial<Scorecard> & { key: string }): Scorecard {
  return {
    key: opts.key, memberCardId: opts.memberCardId ?? null, name: opts.name ?? opts.key,
    netTotal: opts.netTotal ?? null, grossTotal: opts.grossTotal ?? null,
    toParNet: opts.toParNet ?? null, toParGross: opts.toParGross ?? null,
    holesCompleted: opts.holesCompleted ?? 9, scorecardStatus: opts.scorecardStatus ?? null,
    isLive: opts.isLive ?? false, holes: opts.holes ?? [],
  }
}
function entry(opts: Partial<ResultEntry> & { key: string }): ResultEntry {
  return {
    key: opts.key, name: opts.name ?? opts.key, positionLabel: opts.positionLabel ?? null,
    positionOrder: opts.positionOrder ?? 0, points: opts.points ?? null,
    purse: opts.purse ?? null, flight: opts.flight ?? null,
  }
}

// Build a LiveResponse for one occurrence with a leaderboard (scorecards+entries)
// and a result status. occurrenceId is the storage week number as a string.
function occ(id: string, status: 'live' | 'final' | 'not_started', scorecards: Scorecard[], entries: ResultEntry[] = []): LiveResponse {
  return {
    occurrence: {
      id, number: Number(id), label: `Round ${id}`, date: null,
      activeWindow: { start: '', end: null }, format: 'individual',
      discoveryState: 'discovered', resultStatus: status,
    },
    leaderboard: status === 'not_started' ? null : {
      occurrenceId: id, scoringMode: 'gross', grouping: null,
      entries, scorecards, resultStatus: status, durableCurrent: status === 'final',
    },
    flightMembership: { status: 'unavailable', groupings: [] },
    resultStatus: status, eventFormat: 'individual', discoveryState: 'discovered',
    durableCurrent: status === 'final', showingLastKnown: false,
  }
}

// Mock readOccurrence: serves a canned LiveResponse per occurrenceId.
function mockReader(responses: Record<string, LiveResponse>) {
  return async (input: { occurrenceId: string }) => responses[input.occurrenceId] ?? null
}

const GROSS = 'gross' as ScoringMode

test('championshipRounds finds the configured Club Championship rounds (101/102) ordered by championshipRound', () => {
  const { specs } = championshipRounds('mens-league', 'club-championship')
  assert.equal(specs.length, 2)
  assert.equal(specs[0].weekNumber, 101, 'Round 1 (championshipRound 1) first')
  assert.equal(specs[1].weekNumber, 102, 'Round 2 (championshipRound 2) second')
})

test('Monday final + Tuesday live → live aggregate summing both rounds', async () => {
  const reader = mockReader({
    '101': occ('101', 'final', [
      card({ key: 'a', grossTotal: 42, toParGross: 2, holesCompleted: 9, isLive: false }),
    ], [entry({ key: 'a', points: 10 })]),
    '102': occ('102', 'live', [
      card({ key: 'a', grossTotal: 25, toParGross: 1, holesCompleted: 5, isLive: true }),
    ], [entry({ key: 'a', points: 0 })]),
  })
  const r = await getChampionshipAggregate('mens-league', 'club-championship', GROSS, '2026-08-18T18:00:00-07:00', { readOccurrence: reader })
  assert.equal(r.roundCount, 2)
  assert.equal(r.resultStatus, 'live', 'Tuesday in progress → aggregate is live')
  assert.ok(r.leaderboard, 'aggregate leaderboard produced')
  const a = r.leaderboard!.scorecards.find((c) => c.key === 'a')!
  assert.equal(a.grossTotal, 67, '42 + 25 running total')
  assert.equal(a.holesCompleted, 14, '9 + 5')
  assert.equal(a.isLive, true, 'rolls up live from Tuesday')
  const ae = r.leaderboard!.entries.find((e) => e.key === 'a')!
  assert.equal(ae.points, 10, 'points summed across rounds')
  assert.equal(ae.purse, null, 'aggregate purse null → column auto-hides')
})

test('both rounds final → final aggregate, durableCurrent', async () => {
  const reader = mockReader({
    '101': occ('101', 'final', [card({ key: 'a', grossTotal: 42, toParGross: 2, holesCompleted: 9 })], [entry({ key: 'a', points: 10 })]),
    '102': occ('102', 'final', [card({ key: 'a', grossTotal: 44, toParGross: 4, holesCompleted: 9 })], [entry({ key: 'a', points: 8 })]),
  })
  const r = await getChampionshipAggregate('mens-league', 'club-championship', GROSS, '2026-08-19T12:00:00-07:00', { readOccurrence: reader })
  assert.equal(r.resultStatus, 'final')
  assert.equal(r.durableCurrent, true)
  const a = r.leaderboard!.scorecards.find((c) => c.key === 'a')!
  assert.equal(a.grossTotal, 86)
  assert.equal(a.holesCompleted, 18)
  assert.equal(a.isLive, false)
  assert.equal(r.leaderboard!.entries.find((e) => e.key === 'a')!.points, 18)
})

test('Monday final + Tuesday not yet started → aggregate shows Monday only, still live (Tuesday pending)', async () => {
  const reader = mockReader({
    '101': occ('101', 'final', [card({ key: 'a', grossTotal: 42, toParGross: 2, holesCompleted: 9 })], [entry({ key: 'a', points: 10 })]),
    '102': occ('102', 'not_started', []),
  })
  const r = await getChampionshipAggregate('mens-league', 'club-championship', GROSS, '2026-08-17T20:00:00-07:00', { readOccurrence: reader })
  assert.ok(r.leaderboard, 'Monday data carries the aggregate')
  assert.notEqual(r.resultStatus, 'final', 'not final — Tuesday still to play')
  const a = r.leaderboard!.scorecards.find((c) => c.key === 'a')!
  assert.equal(a.grossTotal, 42, 'Monday only')
  assert.equal(a.holesCompleted, 9)
})

test('no rounds have scores yet → not_started, no leaderboard', async () => {
  const reader = mockReader({
    '101': occ('101', 'not_started', []),
    '102': occ('102', 'not_started', []),
  })
  const r = await getChampionshipAggregate('mens-league', 'club-championship', GROSS, '2026-08-10T12:00:00-07:00', { readOccurrence: reader })
  assert.equal(r.leaderboard, null)
  assert.equal(r.resultStatus, 'not_started')
  assert.equal(r.roundCount, 2)
})

test('aggregate card carries no per-hole array (never one 18-hole card)', async () => {
  const reader = mockReader({
    '101': occ('101', 'final', [card({ key: 'a', holes: [{ hole: 1 } as any] })]),
    '102': occ('102', 'final', [card({ key: 'a', holes: [{ hole: 1 } as any] })]),
  })
  const r = await getChampionshipAggregate('mens-league', 'club-championship', GROSS, '2026-08-19T12:00:00-07:00', { readOccurrence: reader })
  assert.deepEqual(r.leaderboard!.scorecards[0].holes, [], 'aggregate holes always empty')
})

test('aggregate occurrence label is the competition label, never a week number', async () => {
  const reader = mockReader({
    '101': occ('101', 'final', [card({ key: 'a', grossTotal: 42, toParGross: 2, holesCompleted: 9 })]),
    '102': occ('102', 'final', [card({ key: 'a', grossTotal: 44, toParGross: 4, holesCompleted: 9 })]),
  })
  const r = await getChampionshipAggregate('mens-league', 'club-championship', GROSS, '2026-08-19T12:00:00-07:00', { readOccurrence: reader })
  assert.equal(r.occurrence.id, 'club-championship')
  assert.equal(r.occurrence.number, null, 'no week number on the aggregate occurrence')
  assert.ok(!/Week 10[12]/.test(r.occurrence.label), 'storage id never in the label')
})
