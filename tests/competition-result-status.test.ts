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