import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildMobileStats,
  formatToPar,
  formatThru,
  formatPoints,
  toParClass,
} from '../components/competition/leaderboard-format.ts'
import type { ResultEntry, Scorecard } from '../lib/competition/types.ts'

function entry(over: Partial<ResultEntry> = {}): ResultEntry {
  return {
    key: 'k1',
    name: 'Hanson, Roger',
    positionLabel: 'T1',
    positionOrder: 1,
    points: 281.25,
    purse: null,
    flight: null,
    ...over,
  }
}

function card(over: Partial<Scorecard> = {}): Scorecard {
  return {
    key: 'k1',
    memberCardId: null,
    name: 'Hanson, Roger',
    netTotal: 31,
    grossTotal: 27,
    toParNet: 3,
    toParGross: -1,
    holesCompleted: 9,
    scorecardStatus: null,
    isLive: false,
    holes: [],
    ...over,
  }
}

test('buildMobileStats: gross mode labels the score Gross and uses grossTotal', () => {
  const stats = buildMobileStats(entry(), card(), 'gross', false)
  assert.equal(stats[2].label, 'Gross')
  assert.equal(stats[2].value, '27')
  // to-par mirrors gross selection
  assert.equal(stats[1].value, '-1')
})

test('buildMobileStats: net mode labels the score Net and uses netTotal', () => {
  const stats = buildMobileStats(entry(), card(), 'net', false)
  assert.equal(stats[2].label, 'Net')
  assert.equal(stats[2].value, '31')
  assert.equal(stats[1].value, '+3')
})

test('buildMobileStats: strip order is Pos, To Par, score, Thru, Points', () => {
  const stats = buildMobileStats(entry(), card(), 'gross', false)
  assert.deepEqual(stats.map((s) => s.label), ['Pos', 'To Par', 'Gross', 'Thru', 'Points'])
})

test('buildMobileStats: finalized card shows Thru = F', () => {
  const stats = buildMobileStats(entry(), card({ isLive: false }), 'gross', false)
  assert.equal(stats[3].value, 'F')
})

test('buildMobileStats: live card shows Thru = thru N', () => {
  const stats = buildMobileStats(entry(), card({ holesCompleted: 7, isLive: true }), 'gross', true)
  assert.equal(stats[3].value, 'thru 7')
})

test('buildMobileStats: unflighted/women\'s entry (null flight) still produces a full strip', () => {
  const stats = buildMobileStats(entry({ flight: null }), card(), 'gross', false)
  assert.equal(stats.length, 5)
  assert.equal(stats[0].value, 'T1')
})

test('buildMobileStats: missing card still renders placeholders, not crashes', () => {
  const stats = buildMobileStats(entry(), null, 'gross', false)
  assert.equal(stats[1].value, '—') // to par
  assert.equal(stats[2].value, '—') // total
  assert.equal(stats[3].value, '—') // thru (no holes completed)
})

test('buildMobileStats: position label falls back to — when null', () => {
  const stats = buildMobileStats(entry({ positionLabel: null }), card(), 'gross', false)
  assert.equal(stats[0].value, '—')
})

test('formatToPar: E at 0, +n positive, -n negative, — null', () => {
  assert.equal(formatToPar(0), 'E')
  assert.equal(formatToPar(3), '+3')
  assert.equal(formatToPar(-2), '-2')
  assert.equal(formatToPar(null), '—')
})

test('formatThru: live uses thru N; finalized with holes shows F; finalized no holes shows —', () => {
  assert.equal(formatThru(3, true), 'thru 3')
  assert.equal(formatThru(9, false), 'F')
  assert.equal(formatThru(0, false), '—')
})

test('formatPoints: integer plain, decimal trimmed, — null', () => {
  assert.equal(formatPoints(10), '10')
  assert.equal(formatPoints(281.25), '281.25')
  assert.equal(formatPoints(281.0), '281')
  assert.equal(formatPoints(null), '—')
})

test('toParClass: neutral at null/0, emerald under par, rose over par', () => {
  assert.equal(toParClass(null), 'text-muted-foreground')
  assert.equal(toParClass(0), 'text-muted-foreground')
  assert.equal(toParClass(-1), 'text-emerald-600 dark:text-emerald-400')
  assert.equal(toParClass(3), 'text-rose-600 dark:text-rose-400')
})