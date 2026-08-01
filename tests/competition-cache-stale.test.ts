import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeLiveCacheStore, type CacheRow } from '../lib/competition/cache.ts'

function row(key: string, payload: any, ageMs: number, status = 'live'): CacheRow {
  return { cache_key: key, payload, result_status: status, fetched_at: new Date(Date.now() - ageMs).toISOString(), expires_at: new Date(Date.now() + (ageMs < 60_000 ? 30_000 : -1000)).toISOString() }
}

test('readCachedResult returns fresh payload only when not expired', async () => {
  const store = makeLiveCacheStore(new Map([['results:igc:mens-league:wk18:gross', row('results:igc:mens-league:wk18:gross', { resultStatus: 'live' }, 10_000)]]))
  const r = await store.readCachedResult({ tenantKey: 'igc', competitionKey: 'mens-league', occurrenceId: 'wk18', scoring: 'gross' })
  assert.ok(r, 'fresh hit')
  assert.equal(r!.resultStatus, 'live')
})

test('readCachedResult returns null when expired (fresh miss)', async () => {
  const store = makeLiveCacheStore(new Map([['results:igc:mens-league:wk18:gross', row('results:igc:mens-league:wk18:gross', { resultStatus: 'live' }, 120_000)]]))
  const r = await store.readCachedResult({ tenantKey: 'igc', competitionKey: 'mens-league', occurrenceId: 'wk18', scoring: 'gross' })
  assert.equal(r, null)
})

test('readStaleResult returns most recent row regardless of expiry (stale-while-error)', async () => {
  const store = makeLiveCacheStore(new Map([['results:igc:mens-league:wk18:gross', row('results:igc:mens-league:wk18:gross', { resultStatus: 'live' }, 120_000)]]))
  const r = await store.readStaleResult({ tenantKey: 'igc', competitionKey: 'mens-league', occurrenceId: 'wk18', scoring: 'gross' })
  assert.ok(r, 'stale hit even when expired')
  assert.equal(r!.resultStatus, 'live')
})

test('readStaleResult returns null when no row exists', async () => {
  const store = makeLiveCacheStore(new Map())
  const r = await store.readStaleResult({ tenantKey: 'igc', competitionKey: 'mens-league', occurrenceId: 'wk18', scoring: 'gross' })
  assert.equal(r, null)
})
