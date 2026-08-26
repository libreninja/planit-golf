import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveResultStatus, type ResultStatusInput } from '../lib/competition/result-status.ts'

function mk(over: Partial<ResultStatusInput>): ResultStatusInput {
  return {
    upstreamStatus: 'unknown',
    active: false,
    hasResults: false,
    anyPartial: false,
    durableFinalized: false,
    ...over,
  }
}

test('durable-finalized → final (authoritative, regardless of upstream)', () => {
  assert.equal(deriveResultStatus(mk({ durableFinalized: true, upstreamStatus: 'in_progress' })), 'final')
})

test('upstream completed → final only after upstream finalization', () => {
  assert.equal(deriveResultStatus(mk({ upstreamStatus: 'completed', hasResults: true })), 'final')
})

test('upstream in_progress → live even when all cards currently complete (do not infer final from completeness)', () => {
  assert.equal(deriveResultStatus(mk({ upstreamStatus: 'in_progress', active: true, hasResults: true, anyPartial: false })), 'live')
})

test('upstream unknown + active + partial cards → live', () => {
  assert.equal(deriveResultStatus(mk({ upstreamStatus: 'unknown', active: true, hasResults: true, anyPartial: true })), 'live')
})

test('upstream unknown + active + complete cards but no upstream signal → live (completeness alone is not final)', () => {
  assert.equal(deriveResultStatus(mk({ upstreamStatus: 'unknown', active: true, hasResults: true, anyPartial: false })), 'live')
})

test('upstream not_started → not_started', () => {
  assert.equal(deriveResultStatus(mk({ upstreamStatus: 'not_started' })), 'not_started')
})

test('upstream unknown + inactive + no results → unknown/inconclusive (never infer final)', () => {
  assert.equal(deriveResultStatus(mk({ upstreamStatus: 'unknown', active: false, hasResults: false })), 'unknown')
})

test('upstream unknown + inactive + hasResults but not durable → unknown (DB path must set durableFinalized)', () => {
  assert.equal(deriveResultStatus(mk({ upstreamStatus: 'unknown', active: false, hasResults: true })), 'unknown')
})

// REGRESSION 2026-08-25 (Men's League live round). Scores were reported at
// 15:59 PDT — one minute before the configured 16:00 playStartLocal — so the
// active window had NOT opened (active=false). GG league rounds never expose
// event.status and season_points is empty mid-round, so upstreamStatus was
// 'unknown'. With 40 genuine partial scorecards on the course, the round must
// classify as 'live': partial card evidence is authoritative over the clock.
// Before the fix, the `active && …` gate suppressed these as 'unknown' and the
// UI rendered "Results aren't available" for a round with live scores.
test('REGRESSION 2026-08-25: partial scorecards → live even when the active window has NOT opened', () => {
  assert.equal(
    deriveResultStatus(mk({ upstreamStatus: 'unknown', active: false, hasResults: true, anyPartial: true })),
    'live',
  )
})

test('partial cards never override a finalized round (durableFinalized / completed win first)', () => {
  // A finalized round that happens to contain a DNF/partial card stays final —
  // the durable import and the upstream completed signal are authoritative.
  assert.equal(deriveResultStatus(mk({ durableFinalized: true, anyPartial: true, hasResults: true })), 'final')
  assert.equal(deriveResultStatus(mk({ upstreamStatus: 'completed', anyPartial: true, hasResults: true })), 'final')
})