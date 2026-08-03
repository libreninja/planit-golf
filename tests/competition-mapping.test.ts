import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildLeagueActiveWindow, leagueOccurrenceLabel, mapLeagueEventToOccurrence,
  formatDateUS, defaultOccurrenceId,
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

test('defaultOccurrenceId: active (in-window) occurrence wins', () => {
  const occs = [
    occ('w1', 'final', '2026-07-14T16:00:00-07:00', '2026-07-15T00:00:00-07:00'),
    occ('w2', 'live', '2026-07-28T16:00:00-07:00', '2026-07-29T00:00:00-07:00'), // active now
    occ('w3', 'final', '2026-07-21T16:00:00-07:00', '2026-07-22T00:00:00-07:00'),
  ]
  assert.equal(defaultOccurrenceId(occs, '2026-07-28T17:00:00-07:00'), 'w2')
})

test('defaultOccurrenceId: no active → most recent finalized (last final in chronological order)', () => {
  const occs = [
    occ('w1', 'final', '2026-07-07T16:00:00-07:00', '2026-07-08T00:00:00-07:00'),
    occ('w2', 'final', '2026-07-14T16:00:00-07:00', '2026-07-15T00:00:00-07:00'),
    occ('w3', 'unknown', '2026-08-04T16:00:00-07:00', '2026-08-05T00:00:00-07:00'), // future, not final
  ]
  // Monday between weeks — no active window; latest final is w2.
  assert.equal(defaultOccurrenceId(occs, '2026-08-03T12:00:00-07:00'), 'w2')
})

test('defaultOccurrenceId: no final/live → latest occurrence overall', () => {
  const occs = [
    occ('w1', 'not_started', '2026-08-11T16:00:00-07:00', '2026-08-12T00:00:00-07:00'),
    occ('w2', 'not_started', '2026-08-18T16:00:00-07:00', '2026-08-19T00:00:00-07:00'),
  ]
  assert.equal(defaultOccurrenceId(occs, '2026-08-03T12:00:00-07:00'), 'w2')
})

test('defaultOccurrenceId: empty → null', () => {
  assert.equal(defaultOccurrenceId([], '2026-08-03T12:00:00-07:00'), null)
})
