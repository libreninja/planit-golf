// Direct unit tests for the default event-selection rule. Pure logic, no
// network/db/auth — run with: `node --test tests/event-selection.test.ts`.
// Node 24 strips TS types natively, so no compiler or extra test dependency is
// required. The import uses a relative path (no `@/` alias) for the same
// reason.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  eligibleWeeks,
  resolveStandingsEvent,
  selectDefaultEvent,
  toDateKey,
  type SelectableEvent,
} from '../lib/igc/event-selection.ts'

interface Ev extends SelectableEvent {
  week_number: number
  event_date: string | null
}

function ev(week: number, date: string): Ev {
  return { week_number: week, event_date: date }
}

const TODAY = '2026-07-24'

test('toDateKey strips a timestamp to YYYY-MM-DD', () => {
  assert.equal(toDateKey('2026-07-27T18:30:00Z'), '2026-07-27')
  assert.equal(toDateKey('2026-07-27'), '2026-07-27')
  assert.equal(toDateKey(null), null)
  assert.equal(toDateKey(undefined), null)
})

test('active event wins when present (priority 1)', () => {
  const events = [
    ev(17, '2026-07-17'), // completed, has results
    ev(18, '2026-07-24'), // active today
    ev(19, '2026-07-31'), // upcoming
  ]
  const weeksWithResults = new Set([17])
  const selected = selectDefaultEvent(events, weeksWithResults, TODAY)
  assert.equal(selected?.week_number, 18)
})

test('active detection works when event_date carries a timestamp', () => {
  const events = [
    ev(17, '2026-07-17'),
    ev(18, '2026-07-24T12:00:00Z'), // active today, timestamped
    ev(19, '2026-07-31'),
  ]
  const selected = selectDefaultEvent(events, new Set([17]), TODAY)
  assert.equal(selected?.week_number, 18)
})

test('no active + completed event with results -> latest completed (priority 2)', () => {
  const events = [
    ev(15, '2026-07-03'),
    ev(16, '2026-07-10'),
    ev(17, '2026-07-17'), // most recent completed
    ev(18, '2026-07-31'), // upcoming (future)
  ]
  const weeksWithResults = new Set([15, 16, 17])
  const selected = selectDefaultEvent(events, weeksWithResults, TODAY)
  assert.equal(selected?.week_number, 17)
})

test('a more recent completed event WITHOUT results is skipped in favor of the most recent valid one', () => {
  // Week 17 is the latest before today but has no results (sync hasn't scored
  // it yet); week 16 is the most recent one that actually has results.
  const events = [
    ev(16, '2026-07-10'),
    ev(17, '2026-07-17'), // no results yet
    ev(18, '2026-07-31'), // upcoming
  ]
  const weeksWithResults = new Set([16])
  const selected = selectDefaultEvent(events, weeksWithResults, TODAY)
  assert.equal(selected?.week_number, 16)
})

test('future empty event is NOT the default when recent results exist', () => {
  // This is the regression the user reported: previously a future Week 18 with
  // no scoring became the default. With a recent completed week present, the
  // completed week must win.
  const events = [
    ev(17, '2026-07-17'), // completed with results
    ev(18, '2026-07-27'), // upcoming, no results
  ]
  const weeksWithResults = new Set([17])
  const selected = selectDefaultEvent(events, weeksWithResults, TODAY)
  assert.equal(selected?.week_number, 17)
})

test('only future events -> null (upcoming is NOT a results default)', () => {
  // Upcoming/unplayed rounds are schedule, not results. With no active or
  // completed-with-results round, there is no result to show — return null so
  // the caller renders an honest empty state rather than a future empty week.
  const events = [
    ev(18, '2026-07-31'),
    ev(19, '2026-08-07'),
  ]
  const selected = selectDefaultEvent(events, new Set(), TODAY)
  assert.equal(selected, null)
})

test('no events at all -> null (caller shows honest empty state)', () => {
  const selected = selectDefaultEvent([], new Set(), TODAY)
  assert.equal(selected, null)
})

test('completed events exist but none have results -> null (no upcoming fallback)', () => {
  const events = [
    ev(16, '2026-07-10'), // completed but no results
    ev(18, '2026-07-31'), // upcoming
  ]
  const selected = selectDefaultEvent(events, new Set(), TODAY)
  assert.equal(selected, null)
})

test('explicit future selection is retained even with no results (no silent substitution)', () => {
  const events = [
    ev(17, '2026-07-17'), // completed with results (would be the default)
    ev(18, '2026-07-27'), // upcoming, no results
  ]
  const weeksWithResults = new Set([17])
  const selected = resolveStandingsEvent(18, events, weeksWithResults, TODAY)
  assert.equal(selected?.week_number, 18)
})

test('explicit selection of an unknown week falls back to the default rule', () => {
  const events = [
    ev(17, '2026-07-17'),
    ev(18, '2026-07-27'),
  ]
  const weeksWithResults = new Set([17])
  const selected = resolveStandingsEvent(999, events, weeksWithResults, TODAY)
  assert.equal(selected?.week_number, 17)
})

test('no explicit week -> uses the default rule', () => {
  const events = [
    ev(17, '2026-07-17'),
    ev(18, '2026-07-27'),
  ]
  const weeksWithResults = new Set([17])
  const selected = resolveStandingsEvent(undefined, events, weeksWithResults, TODAY)
  assert.equal(selected?.week_number, 17)
})

test('multiple completed events -> most recent valid one selected', () => {
  const events = [
    ev(10, '2026-05-29'),
    ev(11, '2026-06-05'),
    ev(12, '2026-06-12'),
    ev(13, '2026-06-19'), // most recent with results
    ev(14, '2026-06-26'), // completed but no results yet
  ]
  const weeksWithResults = new Set([10, 11, 12, 13])
  const selected = selectDefaultEvent(events, weeksWithResults, TODAY)
  assert.equal(selected?.week_number, 13)
})

// eligibleWeeks: the weekly-results selector must list only an active scoring
// round (today) plus completed rounds that have result data. Future/unplayed
// rounds are excluded entirely.
test('eligibleWeeks includes completed-with-results and active, excludes future', () => {
  const events = [
    ev(14, '2026-06-26'), // completed but no results -> excluded
    ev(15, '2026-07-03'), // completed with results
    ev(16, '2026-07-10'), // completed with results
    ev(17, '2026-07-24'), // active today (no results yet)
    ev(18, '2026-07-31'), // upcoming -> excluded
  ]
  const weeksWithResults = new Set([15, 16])
  const weeks = eligibleWeeks(events, weeksWithResults, TODAY)
  assert.deepEqual(weeks, [17, 16, 15]) // most-recent first
})

test('eligibleWeeks excludes future weeks even when none have results', () => {
  const events = [
    ev(18, '2026-07-31'),
    ev(19, '2026-08-07'),
  ]
  const weeks = eligibleWeeks(events, new Set(), TODAY)
  assert.deepEqual(weeks, [])
})

test('eligibleWeeks includes the active round even with no scored results', () => {
  const events = [
    ev(16, '2026-07-10'), // completed with results
    ev(17, '2026-07-24'), // active today, no results yet
  ]
  const weeks = eligibleWeeks(events, new Set([16]), TODAY)
  assert.deepEqual(weeks, [17, 16])
})