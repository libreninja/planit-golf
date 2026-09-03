import { test } from 'node:test'
import assert from 'node:assert/strict'
import { occurrenceContextLabel } from '../components/competition/occurrence-context.ts'

test('FINAL does not add a standalone or occurrence status treatment', () => {
  assert.equal(occurrenceContextLabel('Week 20 · 08/25/2026', 'final'), 'Week 20 · 08/25/2026')
})

test('LIVE and Upcoming are visible in occurrence context', () => {
  assert.equal(occurrenceContextLabel('Week 21 · 09/01/2026', 'live'), 'Week 21 · 09/01/2026 (Live)')
  assert.equal(occurrenceContextLabel('Week 22 · 09/08/2026', 'not_started'), 'Week 22 · 09/08/2026 (Upcoming)')
})

test('unknown occurrence state stays quiet', () => {
  assert.equal(occurrenceContextLabel('Week 23 · 09/15/2026', 'unknown'), 'Week 23 · 09/15/2026')
})
