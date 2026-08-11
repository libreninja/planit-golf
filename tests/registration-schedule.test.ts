import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveNextActionableEventDate,
  isRegistrationWindowOpenOrUpcoming,
} from '../lib/registration-schedule.ts'

// Men's close offset is 2 days before play day; women's is 3. So a Tue Aug 11
// men's event closes registration on Aug 9, a Mon Aug 17 / Tue Aug 18 Club
// Championship round closes Aug 15 / Aug 16.
const FALLBACK = '2026-08-25'
const mens = (eventDates: string[], latestRun: { event_date: string; status: string | null } | null, today: string) =>
  resolveNextActionableEventDate({ league: 'mens', eventDates, latestRun, today, fallbackDate: FALLBACK })

test('isRegistrationWindowOpenOrUpcoming: Aug 11 closed on Aug 11; Aug 17/18 still actionable', () => {
  assert.equal(isRegistrationWindowOpenOrUpcoming('2026-08-11', 'mens', '2026-08-11'), false)
  assert.equal(isRegistrationWindowOpenOrUpcoming('2026-08-17', 'mens', '2026-08-11'), true)
  assert.equal(isRegistrationWindowOpenOrUpcoming('2026-08-18', 'mens', '2026-08-11'), true)
})

test('isRegistrationWindowOpenOrUpcoming: open on the close day itself (closes end-of-day)', () => {
  // Aug 11 closes Aug 9; on Aug 9 registration is still open.
  assert.equal(isRegistrationWindowOpenOrUpcoming('2026-08-11', 'mens', '2026-08-09'), true)
  // The day after close is closed.
  assert.equal(isRegistrationWindowOpenOrUpcoming('2026-08-11', 'mens', '2026-08-10'), false)
})

test('isRegistrationWindowOpenOrUpcoming: women uses a 3-day close offset', () => {
  // A Wed Aug 12 women's event closes Aug 9; still open Aug 8, closed Aug 10.
  assert.equal(isRegistrationWindowOpenOrUpcoming('2026-08-12', 'womens', '2026-08-08'), true)
  assert.equal(isRegistrationWindowOpenOrUpcoming('2026-08-12', 'womens', '2026-08-10'), false)
})

// Case 1: completed latest run advances normally to the next actionable event.
test('completed latest run advances to the next actionable event', () => {
  const today = '2026-08-06' // Aug 11 reg still open (closes Aug 9)
  const got = mens(['2026-08-04', '2026-08-11', '2026-08-17', '2026-08-18'], { event_date: '2026-08-04', status: 'completed' }, today)
  assert.equal(got, '2026-08-11')
})

// Case 2: failed latest run whose registration cycle is over advances; does NOT stay pinned.
test('failed latest run with a closed window advances past it', () => {
  const today = '2026-08-11' // Aug 11 reg closed (closed Aug 9)
  const got = mens(['2026-08-11', '2026-08-17', '2026-08-18'], { event_date: '2026-08-11', status: 'failed' }, today)
  assert.equal(got, '2026-08-17')
})

// Case 3: missing run for an old registration event does not pin indefinitely.
test('no latest run skips closed/past events to the earliest actionable one', () => {
  const today = '2026-08-11'
  const got = mens(['2026-07-28', '2026-08-04', '2026-08-11', '2026-08-17', '2026-08-18'], null, today)
  assert.equal(got, '2026-08-17')
})

// Case 4: a pending/in-progress run during a genuinely active window may remain current.
test('in-progress run during an open window anchors to its event', () => {
  const today = '2026-08-06' // Aug 11 reg open
  const got = mens(['2026-08-11', '2026-08-17'], { event_date: '2026-08-11', status: 'started' }, today)
  assert.equal(got, '2026-08-11')
})

test('pending (null-status) run during an open window anchors to its event', () => {
  const today = '2026-08-06'
  const got = mens(['2026-08-11', '2026-08-17'], { event_date: '2026-08-11', status: null }, today)
  assert.equal(got, '2026-08-11')
})

// Core regression: a non-completed run whose window has CLOSED does not pin.
test('pending run whose window has closed advances (the Aug 11 pin regression)', () => {
  const today = '2026-08-11'
  const got = mens(['2026-08-11', '2026-08-17', '2026-08-18'], { event_date: '2026-08-11', status: 'started' }, today)
  assert.equal(got, '2026-08-17')
})

// Case 8: both Club Championship rounds surface as actionable from Aug 11.
test('Club Championship Aug 17 and Aug 18 both surface once Aug 11 is closed', () => {
  const today = '2026-08-11'
  const got = mens(['2026-08-11', '2026-08-17', '2026-08-18'], { event_date: '2026-08-11', status: 'failed' }, today)
  // The resolved anchor is Aug 17; the UI then shows all events >= Aug 17,
  // i.e. BOTH Aug 17 and Aug 18. Assert the anchor + that both pass the filter.
  assert.equal(got, '2026-08-17')
  const surfaced = ['2026-08-17', '2026-08-18'].filter((d) => d >= got)
  assert.deepEqual(surfaced, ['2026-08-17', '2026-08-18'])
})

test('falls back to the computed play day when no actionable event exists', () => {
  const today = '2026-08-11'
  const got = mens(['2026-07-28', '2026-08-04'], { event_date: '2026-08-04', status: 'completed' }, today)
  assert.equal(got, FALLBACK)
})