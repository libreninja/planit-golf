import { test } from 'node:test'
import assert from 'node:assert/strict'
import { flightColor } from '../components/competition/flight-color.ts'

test('numeric flight labels map to a color bundle (non-null)', () => {
  assert.notEqual(flightColor('Flight 1'), null)
  assert.notEqual(flightColor('Flight 2'), null)
  assert.notEqual(flightColor('Flight 3'), null)
})

test('same label always maps to the same palette entry (filter tab matches row)', () => {
  assert.deepEqual(flightColor('Flight 2'), flightColor('Flight 2'))
})

test('Flight 1, 2, 3 map to distinct palette entries', () => {
  const c1 = flightColor('Flight 1')!
  const c2 = flightColor('Flight 2')!
  const c3 = flightColor('Flight 3')!
  assert.notDeepEqual(c1, c2)
  assert.notDeepEqual(c2, c3)
  assert.notDeepEqual(c1, c3)
})

test('flight numbers past the palette size cycle (Flight 6 → same as Flight 1)', () => {
  // palette length is 5 → Flight 6 wraps to index 0 (same as Flight 1).
  assert.deepEqual(flightColor('Flight 6'), flightColor('Flight 1'))
  assert.deepEqual(flightColor('Flight 10'), flightColor('Flight 5'))
})

test('null / empty / non-numeric labels → null (neutral, uncolored)', () => {
  assert.equal(flightColor(null), null)
  assert.equal(flightColor(''), null)
  assert.equal(flightColor('Championship'), null)
  assert.equal(flightColor('Overall'), null)
})

test('every palette entry exposes row, rowHover, tabIdle, tabActive, badge strings', () => {
  const c = flightColor('Flight 1')!
  for (const key of ['row', 'rowHover', 'tabIdle', 'tabActive', 'badge'] as const) {
    assert.equal(typeof c[key], 'string', `${key} is a string`)
    assert.ok((c[key] as string).length > 0, `${key} is non-empty`)
  }
})