import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildLeagueActiveWindow, leagueOccurrenceLabel, mapLeagueEventToOccurrence,
  formatDateUS, defaultOccurrenceId, latestNonFutureWeeks,
} from '../lib/competition/adapters/golfgenius/mapping.ts'
import type { Occurrence } from '../lib/competition/types.ts'

test('buildLeagueActiveWindow: valid ISO with offset from date + config', () => {
  const w = buildLeagueActiveWindow({ date: '2026-07-28', tz: 'America/Los_Angeles', playStartLocal: '16:00', windowHours: 8 })
  assert.ok(w)
  // July 28 2026 in America/Los_Angeles is PDT (-07:00). Start must carry an offset.
  assert.equal(w!.start, '2026-07-28T16:00:00-07:00')
  assert.equal(w!.end, '2026-07-29T00:00:00-07:00')
})

test('buildLeagueActiveWindow: null date → null window', () => {
  assert.equal(buildLeagueActiveWindow({ date: null, tz: 'America/Los_Angeles', playStartLocal: '16:00', windowHours: 8 }), null)
})

test('buildLeagueActiveWindow: open-ended when windowHours absent', () => {
  const w = buildLeagueActiveWindow({ date: '2026-07-28', tz: 'America/Los_Angeles', playStartLocal: '16:00' })
  assert.equal(w!.end, null)
})

test('leagueOccurrenceLabel: composite with event name', () => {
  assert.equal(leagueOccurrenceLabel({ kind: 'composite', noun: 'Week', separator: ' – ' }, 18, 'Open Championship'), 'Week 18 – Open Championship')
})

test('leagueOccurrenceLabel: composite without event name falls back to prefix', () => {
  assert.equal(leagueOccurrenceLabel({ kind: 'composite', noun: 'Week', separator: ' – ' }, 18, null), 'Week 18')
})

test('mapLeagueEventToOccurrence: maps row to generic Occurrence', () => {
  const occ = mapLeagueEventToOccurrence({
    week_number: 18, event_name: 'Open', event_date: '2026-07-28',
    event_format: 'individual', discovery_state: 'discovered',
  }, 'Week 18 – Open', { start: '2026-07-28T16:00:00-07:00', end: '2026-07-29T00:00:00-07:00' }, 'final')
  assert.equal(occ.id, '18')
  assert.equal(occ.number, 18)
  assert.equal(occ.format, 'individual')
  assert.equal(occ.resultStatus, 'final')
})

// ---- P4: date-driven week labels (no GG source-string leak) ----

test('leagueOccurrenceLabel: weekDate formats date as MM/DD/YYYY', () => {
  assert.equal(leagueOccurrenceLabel({ kind: 'weekDate', noun: 'Week', separator: ' - ' }, 18, null, '2026-07-28'), 'Week 18 - 07/28/2026')
})

test('leagueOccurrenceLabel: weekDate without date falls back to prefix', () => {
  assert.equal(leagueOccurrenceLabel({ kind: 'weekDate', noun: 'Week', separator: ' - ' }, 18, null, null), 'Week 18')
})

test('leagueOccurrenceLabel: weekDate ignores GG event_name (no Points Season / Season Points Finale leak)', () => {
  assert.equal(
    leagueOccurrenceLabel({ kind: 'weekDate', noun: 'Week', separator: ' - ' }, 24, 'Points Season - Week 26 - Season Points Finale', '2026-07-22'),
    'Week 24 - 07/22/2026',
  )
})

test('formatDateUS: ISO date → MM/DD/YYYY; full timestamp → date-only; bad/empty → ""', () => {
  assert.equal(formatDateUS('2026-07-28'), '07/28/2026')
  assert.equal(formatDateUS('2026-07-28T16:00:00-07:00'), '07/28/2026')
  assert.equal(formatDateUS(null), '')
  assert.equal(formatDateUS('garbage'), '')
})

// ---- P3/P5: default occurrence selection ----

const occ = (id: string, status: 'final' | 'live' | 'unknown' | 'not_started', start: string, end: string | null): Occurrence => ({
  id, number: Number(id.replace(/\D/g, '')) || null, label: id, date: null,
  activeWindow: { start, end }, format: 'individual', discoveryState: 'discovered', resultStatus: status,
})

test('defaultOccurrenceId: Tuesday + posted golf → today (the current event)', () => {
  const occs = [
    occ('w1', 'final', '2026-07-07T16:00:00-07:00', '2026-07-08T00:00:00-07:00'),
    occ('w2', 'final', '2026-07-14T16:00:00-07:00', '2026-07-15T00:00:00-07:00'),
    occ('w3', 'unknown', '2026-08-04T16:00:00-07:00', '2026-08-05T00:00:00-07:00'), // today, golf happening
  ]
  assert.equal(defaultOccurrenceId(occs, { todayId: 'w3', todayHasPostedGolf: true, hasResults: new Set(['w1', 'w2']) }), 'w3')
})

test('defaultOccurrenceId: Tuesday + today has NO posted golf → most recent prior occurrence with results', () => {
  const occs = [
    occ('w1', 'final', '2026-07-07T16:00:00-07:00', '2026-07-08T00:00:00-07:00'),
    occ('w2', 'final', '2026-07-14T16:00:00-07:00', '2026-07-15T00:00:00-07:00'),
    occ('w3', 'unknown', '2026-08-04T16:00:00-07:00', '2026-08-05T00:00:00-07:00'), // today, nobody has posted yet
  ]
  assert.equal(defaultOccurrenceId(occs, { todayId: 'w3', todayHasPostedGolf: false, hasResults: new Set(['w1', 'w2']) }), 'w2')
})

test('defaultOccurrenceId: Wednesday–Monday → newest occurrence WITH results', () => {
  const occs = [
    occ('w1', 'final', '2026-07-07T16:00:00-07:00', '2026-07-08T00:00:00-07:00'),
    occ('w2', 'final', '2026-07-14T16:00:00-07:00', '2026-07-15T00:00:00-07:00'),
    occ('w3', 'unknown', '2026-08-04T16:00:00-07:00', '2026-08-05T00:00:00-07:00'), // future empty
  ]
  // No todayId (not a play day) → newest with results is w2; the future empty w3 never wins.
  assert.equal(defaultOccurrenceId(occs, { todayId: null, todayHasPostedGolf: false, hasResults: new Set(['w1', 'w2']) }), 'w2')
})

test('defaultOccurrenceId: a newer EMPTY occurrence does not replace the last useful results', () => {
  const occs = [
    occ('w15', 'final', '2026-07-14T16:00:00-07:00', '2026-07-15T00:00:00-07:00'),
    occ('w16', 'final', '2026-07-21T16:00:00-07:00', '2026-07-22T00:00:00-07:00'), // newest with results
    occ('w17', 'unknown', '2026-07-28T16:00:00-07:00', '2026-07-29T00:00:00-07:00'), // newer but empty (no play)
    occ('w18', 'unknown', '2026-08-04T16:00:00-07:00', '2026-08-05T00:00:00-07:00'), // future empty
  ]
  // Monday: todayId null. hasResults only w15/w16. w18 (newest overall) must NOT be chosen.
  assert.equal(defaultOccurrenceId(occs, { todayId: null, todayHasPostedGolf: false, hasResults: new Set(['w15', 'w16']) }), 'w16')
})

test('defaultOccurrenceId: no results anywhere + today exists → today (nothing else to show)', () => {
  const occs = [
    occ('w1', 'not_started', '2026-08-04T16:00:00-07:00', '2026-08-05T00:00:00-07:00'),
  ]
  assert.equal(defaultOccurrenceId(occs, { todayId: 'w1', todayHasPostedGolf: false, hasResults: new Set() }), 'w1')
})

test('defaultOccurrenceId: no results anywhere + no today → latest occurrence overall', () => {
  const occs = [
    occ('w1', 'not_started', '2026-08-11T16:00:00-07:00', '2026-08-12T00:00:00-07:00'),
    occ('w2', 'not_started', '2026-08-18T16:00:00-07:00', '2026-08-19T00:00:00-07:00'),
  ]
  assert.equal(defaultOccurrenceId(occs, { todayId: null, todayHasPostedGolf: false, hasResults: new Set() }), 'w2')
})

test('defaultOccurrenceId: empty → null', () => {
  assert.equal(defaultOccurrenceId([], { todayId: null, todayHasPostedGolf: false, hasResults: new Set() }), null)
})

// ---- latestNonFutureWeeks: ordered targets for the on-view read-through ----
// Occurrences arrive ascending by date from resolveOccurrences; the helper
// returns newest-first non-future week numbers (bounded) so the read-through
// walks back from today to the latest PLAYED (completed) round — covering the
// Women's League gap where today's round is unposted but a finalized round sits
// behind it. Null/future dates and non-numeric ids (men's Club Championship
// 101/102 specials) are skipped.
const dated = (id: string, date: string | null): Occurrence => ({
  id, number: Number(id.replace(/\D/g, '')) || null, label: id, date,
  activeWindow: { start: '2026-01-01T00:00:00Z', end: null }, format: 'individual',
  discoveryState: 'discovered', resultStatus: 'unknown',
})

test('latestNonFutureWeeks: newest non-future first, bounded', () => {
  const occs = [
    dated('17', '2026-07-29'), dated('18', '2026-08-19'), dated('19', '2026-08-26'),
    dated('20', '2026-09-02'),
  ]
  // today 2026-08-26: 19 is non-future (== today), 20 is future → [19, 18, 17]
  assert.deepEqual(latestNonFutureWeeks(occs, '2026-08-26'), [19, 18, 17])
})

test('latestNonFutureWeeks: bounds to the latest N (no unbounded GG walk-back)', () => {
  const occs = Array.from({ length: 8 }, (_, i) => dated(String(15 + i), `2026-07-${10 + i}`))
  // All non-future relative to 2026-08-26; bound 4 → only the newest four.
  assert.deepEqual(latestNonFutureWeeks(occs, '2026-08-26', 4), [22, 21, 20, 19])
})

test('latestNonFutureWeeks: skips null/future dates and non-numeric ids', () => {
  const occs = [
    dated('special', '2026-08-17'), // non-numeric id — skipped (finite guard)
    dated('19', '2026-08-26'),     // today
    dated('20', '2026-09-02'),     // future — skipped
    dated('21', null),             // null date — skipped
  ]
  assert.deepEqual(latestNonFutureWeeks(occs, '2026-08-26'), [19])
})

test('latestNonFutureWeeks: exclude set drops special occurrences (Club Championship 101/102)', () => {
  const occs = [
    dated('101', '2026-08-17'),  // Club Championship R1 — excluded by caller
    dated('102', '2026-08-18'),  // Club Championship R2 — excluded by caller
    dated('19', '2026-08-11'),   // a normal prior week
    dated('20', '2026-08-25'),   // latest non-future
  ]
  assert.deepEqual(latestNonFutureWeeks(occs, '2026-08-26', 4, new Set([101, 102])), [20, 19])
})

test('latestNonFutureWeeks: empty when nothing is non-future', () => {
  const occs = [dated('20', '2026-09-02'), dated('21', null)]
  assert.deepEqual(latestNonFutureWeeks(occs, '2026-08-26'), [])
})
