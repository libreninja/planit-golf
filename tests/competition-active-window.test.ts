import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isOccurrenceActive } from '../lib/competition/active-window.ts'

test('active when now is within the window', () => {
  assert.equal(isOccurrenceActive({ start: '2026-07-28T16:00:00-07:00', end: '2026-07-28T22:00:00-07:00' }, '2026-07-28T18:00:00-07:00', false), true)
})

test('not active before the window', () => {
  assert.equal(isOccurrenceActive({ start: '2026-07-28T16:00:00-07:00', end: '2026-07-28T22:00:00-07:00' }, '2026-07-28T15:00:00-07:00', false), false)
})

test('open-ended window (end null) active from start onward', () => {
  assert.equal(isOccurrenceActive({ start: '2026-07-28T16:00:00-07:00', end: null }, '2026-07-29T10:00:00-07:00', false), true)
})

test('multi-day occurrence stays active across both days', () => {
  const w = { start: '2026-07-28T08:00:00-07:00', end: '2026-07-29T20:00:00-07:00' }
  assert.equal(isOccurrenceActive(w, '2026-07-28T20:00:00-07:00', false), true)
  assert.equal(isOccurrenceActive(w, '2026-07-29T09:00:00-07:00', false), true)
  assert.equal(isOccurrenceActive(w, '2026-07-30T09:00:00-07:00', false), false)
})

test('upstream in-progress scoring keeps active even past window end', () => {
  assert.equal(isOccurrenceActive({ start: '2026-07-28T16:00:00-07:00', end: '2026-07-28T20:00:00-07:00' }, '2026-07-28T21:00:00-07:00', true), true)
})