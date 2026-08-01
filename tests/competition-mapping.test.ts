import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildLeagueActiveWindow, leagueOccurrenceLabel, mapLeagueEventToOccurrence } from '../lib/competition/adapters/golfgenius/mapping.ts'

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
