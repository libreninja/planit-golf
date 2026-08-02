import { test } from 'node:test'
import assert from 'node:assert/strict'
import { selectReconciliationCandidates, type CandidateEvent } from '../lib/competition/reconcile/candidates.ts'

function ev(over: Partial<CandidateEvent>): CandidateEvent {
  return {
    week_number: 18, event_date: '2026-07-28',
    event_format: 'unknown', discovery_state: 'pending',
    upstream_status: null, durable_imported_at: null,
    ...over,
  }
}

test('active: unresolved + in play window → discovery only', () => {
  const c = selectReconciliationCandidates([ev({ event_format: 'unknown', discovery_state: 'pending', upstream_status: 'in_progress' })], '2026-07-28T18:00:00Z')
  assert.equal(c[0].kind, 'active')
  assert.equal(c[0].action, 'discover')
})

test('played-awaiting-finalization: in_progress but not completed → check status, no points', () => {
  const c = selectReconciliationCandidates([ev({ event_format: 'individual', discovery_state: 'discovered', upstream_status: 'in_progress' })], '2026-07-28T20:00:00Z')
  assert.equal(c[0].kind, 'played-awaiting-finalization')
  assert.equal(c[0].action, 'discover')
})

test('upstream-finalized: completed status → import + rebuild points', () => {
  const c = selectReconciliationCandidates([ev({ event_format: 'individual', discovery_state: 'discovered', upstream_status: 'completed', durable_imported_at: null })], '2026-07-28T22:00:00Z')
  assert.equal(c[0].kind, 'upstream-finalized')
  assert.equal(c[0].action, 'import')
})

test('upstream-finalized already durable: skipped (old-current)', () => {
  const c = selectReconciliationCandidates([ev({ event_format: 'individual', discovery_state: 'discovered', upstream_status: 'completed', durable_imported_at: '2026-07-28T22:05:00Z' })], '2026-07-29T10:00:00Z')
  assert.equal(c[0].kind, 'old-current')
  assert.equal(c[0].action, 'skip')
})

test('unknown-unresolved: stale inconclusive → re-discover', () => {
  const c = selectReconciliationCandidates([ev({ event_format: 'unknown', discovery_state: 'inconclusive', upstream_status: null })], '2026-07-29T10:00:00Z')
  assert.equal(c[0].kind, 'unknown-unresolved')
  assert.equal(c[0].action, 'discover')
})

test('old finalized with no upstream status and already durable: skip', () => {
  const c = selectReconciliationCandidates([ev({ event_format: 'individual', discovery_state: 'discovered', upstream_status: null, durable_imported_at: '2026-07-01T22:00:00Z' })], '2026-07-29T10:00:00Z')
  assert.equal(c[0].kind, 'old-current')
  assert.equal(c[0].action, 'skip')
})
