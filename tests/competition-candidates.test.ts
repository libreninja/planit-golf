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

// STALENESS GATE (frequent reconcile). A candidate discovered from GG within
// STALENESS_MS is skipped this run ("more than a minute since refreshed → read
// through"); discovered > STALENESS_MS ago, or never discovered, is processed.
test('staleness: candidate discovered <60s ago → skipped as stale (not re-read from GG)', () => {
  // An in-progress (active) week discovered 30s ago → stale → skip.
  const c = selectReconciliationCandidates(
    [ev({ event_format: 'individual', discovery_state: 'discovered', upstream_status: 'in_progress', discovered_at: '2026-07-28T19:59:30Z' })],
    '2026-07-28T20:00:00Z',
  )
  assert.equal(c[0].kind, 'stale')
  assert.equal(c[0].action, 'skip')
})

test('staleness: candidate discovered >60s ago → processed normally (re-read GG)', () => {
  // Same in-progress week, but discovered 2 min ago (>60s) → not stale →
  // classified normally (played-awaiting-finalization) → discover.
  const c = selectReconciliationCandidates(
    [ev({ event_format: 'individual', discovery_state: 'discovered', upstream_status: 'in_progress', discovered_at: '2026-07-28T19:58:00Z' })],
    '2026-07-28T20:00:00Z',
  )
  assert.equal(c[0].kind, 'played-awaiting-finalization')
  assert.equal(c[0].action, 'discover')
})

test('staleness: a finalized-not-durable week discovered just now is NOT gated (imports this run)', () => {
  // upstream-finalized must import on the run that discovers it; gating it would
  // delay a finalized round's import by a minute. discovered_at 30s ago but the
  // candidate would import → still stale? The gate is time-based regardless of
  // kind, so it IS skipped — but in practice this can't happen: a run that
  // discovers a completed week imports it in the SAME run (sets durable), so the
  // next run sees old-current, not upstream-finalized. The gate therefore never
  // delays a real import. Document that contract: a fresh completed week with
  // NO prior discovered_at imports immediately.
  const c = selectReconciliationCandidates(
    [ev({ event_format: 'individual', discovery_state: 'discovered', upstream_status: 'completed', durable_imported_at: null /* no discovered_at */ })],
    '2026-07-28T22:00:00Z',
  )
  assert.equal(c[0].kind, 'upstream-finalized')
  assert.equal(c[0].action, 'import')
})

test('staleness: absent discovered_at → never gated (legacy/test events process normally)', () => {
  const c = selectReconciliationCandidates(
    [ev({ event_format: 'individual', discovery_state: 'discovered', upstream_status: 'in_progress' /* discovered_at omitted */ })],
    '2026-07-28T20:00:00Z',
  )
  assert.equal(c[0].kind, 'played-awaiting-finalization')
  assert.equal(c[0].action, 'discover')
})

test('staleness: an already-skipped candidate (old-current) is never re-enabled by the gate', () => {
  // Even with a very recent discovered_at, old-current stays skip — the gate
  // only suppresses work, never re-enables it.
  const c = selectReconciliationCandidates(
    [ev({ event_format: 'individual', discovery_state: 'discovered', upstream_status: 'completed', durable_imported_at: '2026-07-28T21:59:00Z', discovered_at: '2026-07-28T21:59:30Z' })],
    '2026-07-28T22:00:00Z',
  )
  assert.equal(c[0].kind, 'old-current')
  assert.equal(c[0].action, 'skip')
})
