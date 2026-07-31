import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isDurableCurrent } from '../lib/competition/durable-current.ts'

// DurableCurrentSource = {
//   sourceFinalizedAt, sourceVersion, durableSourceVersion, durableImportedAt
// }

test('false when no durable import recorded', () => {
  assert.equal(isDurableCurrent({ sourceFinalizedAt: '2026-07-28T22:00:00Z', sourceVersion: null, durableSourceVersion: null, durableImportedAt: null }), false)
})

test('false when source not yet finalized (still live/pending)', () => {
  assert.equal(isDurableCurrent({ sourceFinalizedAt: null, sourceVersion: null, durableSourceVersion: null, durableImportedAt: '2026-07-28T20:00:00Z' }), false)
})

test('true when durable import captured the finalized source (imported at/after finalization, no versions)', () => {
  assert.equal(isDurableCurrent({ sourceFinalizedAt: '2026-07-28T22:00:00Z', sourceVersion: null, durableSourceVersion: null, durableImportedAt: '2026-07-28T22:05:00Z' }), true)
})

test('false when durable import predates source finalization (stale import, no versions)', () => {
  assert.equal(isDurableCurrent({ sourceFinalizedAt: '2026-07-28T22:00:00Z', sourceVersion: null, durableSourceVersion: null, durableImportedAt: '2026-07-28T20:00:00Z' }), false)
})

test('version equality wins: sourceVersion == durableSourceVersion → current even if timestamps skew', () => {
  assert.equal(isDurableCurrent({ sourceFinalizedAt: '2026-07-28T22:00:00Z', sourceVersion: 'v9', durableSourceVersion: 'v9', durableImportedAt: '2026-07-28T19:00:00Z' }), true)
})

test('version mismatch → NOT current, even with a recent import (the durable path captured a different finalized state)', () => {
  assert.equal(isDurableCurrent({ sourceFinalizedAt: '2026-07-28T22:00:00Z', sourceVersion: 'v10', durableSourceVersion: 'v9', durableImportedAt: '2026-07-29T00:00:00Z' }), false)
})

test('sourceVersion present but durableSourceVersion absent → fall back to timestamp comparison', () => {
  // no durable version recorded; timestamp says stale
  assert.equal(isDurableCurrent({ sourceFinalizedAt: '2026-07-28T22:00:00Z', sourceVersion: 'v9', durableSourceVersion: null, durableImportedAt: '2026-07-28T20:00:00Z' }), false)
  // no durable version recorded; timestamp says current
  assert.equal(isDurableCurrent({ sourceFinalizedAt: '2026-07-28T22:00:00Z', sourceVersion: 'v9', durableSourceVersion: null, durableImportedAt: '2026-07-28T22:05:00Z' }), true)
})