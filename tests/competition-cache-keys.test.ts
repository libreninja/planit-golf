import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resultsCacheKey, discoveryCacheKey } from '../lib/competition/cache-keys.ts'

test('results key includes tenant, competition, occurrence, scoring', () => {
  assert.equal(resultsCacheKey({ tenantKey: 'igc', competitionKey: 'mens-league', occurrenceId: 'wk18', scoring: 'gross' }), 'results:igc:mens-league:wk18:gross')
})

test('discovery key includes tenant + competition + occurrence, no scoring', () => {
  assert.equal(discoveryCacheKey({ tenantKey: 'igc', competitionKey: 'mens-league', occurrenceId: 'wk18' }), 'discovery:igc:mens-league:wk18')
})

test('keys differ by tenant (no cross-tenant read)', () => {
  assert.notEqual(
    resultsCacheKey({ tenantKey: 'igc', competitionKey: 'mens-league', occurrenceId: 'wk18', scoring: 'gross' }),
    resultsCacheKey({ tenantKey: 'other-org', competitionKey: 'mens-league', occurrenceId: 'wk18', scoring: 'gross' }),
  )
})

test('keys differ by competition (no cross-competition read)', () => {
  assert.notEqual(
    resultsCacheKey({ tenantKey: 'igc', competitionKey: 'mens-league', occurrenceId: 'wk18', scoring: 'gross' }),
    resultsCacheKey({ tenantKey: 'igc', competitionKey: 'womens-league', occurrenceId: 'wk18', scoring: 'gross' }),
  )
})