import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  createSeattleCupTimingCollector,
  serverTimingHeaders,
  SEATTLE_CUP_TIMING_METRICS,
} from '../lib/seattle-cup/timing.ts'

test('Seattle Cup response timing header is present and structurally valid', () => {
  const timing = createSeattleCupTimingCollector()
  timing.add('cache-read', 12.345)
  timing.add('golf-genius', 456.78)
  timing.add('normalization', 0.42)
  timing.add('identity', 89.01)
  timing.add('cache-write', 15.5)
  timing.add('total', 600.2)

  const headers = serverTimingHeaders(timing)
  const value = headers['Server-Timing']
  assert.ok(value)
  const entries = value.split(', ')
  assert.equal(entries.length, SEATTLE_CUP_TIMING_METRICS.length)
  assert.deepEqual(entries.map((entry) => entry.split(';')[0]), [...SEATTLE_CUP_TIMING_METRICS])
  for (const entry of entries) {
    assert.match(entry, /^[a-z][a-z-]*;dur=\d+\.\d$/)
  }
  assert.match(value, /cache-read;dur=12\.3/)
  assert.match(value, /total;dur=600\.2/)
})

test('invalid timing values cannot corrupt the Server-Timing header', () => {
  const timing = createSeattleCupTimingCollector()
  timing.add('cache-read', Number.NaN)
  timing.add('identity', -10)
  const value = serverTimingHeaders(timing)['Server-Timing']
  assert.ok(value?.includes('cache-read;dur=0.0'))
  assert.ok(value?.includes('identity;dur=0.0'))
})
