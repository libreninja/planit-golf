import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scoringKey, resolveScoring, writeScoringPref } from '../lib/competition/scoring-prefs.ts'

function makeStore() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v) },
  }
}

test('key is competition-scoped, not global', () => {
  assert.equal(scoringKey('mens-league'), 'standings:mens-league:scoring')
  assert.equal(scoringKey('womens-league'), 'standings:womens-league:scoring')
})

test('URL value wins and is validated against available modes', () => {
  const store = makeStore(); store.setItem(scoringKey('mens-league'), 'net')
  const r = resolveScoring({ competitionKey: 'mens-league', urlValue: 'gross', available: ['gross', 'net'], defaultMode: 'net', store })
  assert.equal(r, 'gross')
})

test('falls back to stored pref when URL absent, validated against available', () => {
  const store = makeStore(); store.setItem(scoringKey('mens-league'), 'net')
  const r = resolveScoring({ competitionKey: 'mens-league', urlValue: null, available: ['gross', 'net'], defaultMode: 'gross', store })
  assert.equal(r, 'net')
})

test('stored pref from another competition does not leak', () => {
  const store = makeStore(); store.setItem(scoringKey('womens-league'), 'net')
  const r = resolveScoring({ competitionKey: 'mens-league', urlValue: null, available: ['gross', 'net'], defaultMode: 'gross', store })
  assert.equal(r, 'gross', 'womens-league pref must not select a mode for mens-league')
})

test('stale stored value not in available modes is ignored for default', () => {
  const store = makeStore(); store.setItem(scoringKey('mens-league'), 'stableford')
  const r = resolveScoring({ competitionKey: 'mens-league', urlValue: null, available: ['gross', 'net'], defaultMode: 'gross', store })
  assert.equal(r, 'gross')
})

test('writeScoringPref persists under the namespaced key', () => {
  const store = makeStore()
  writeScoringPref('mens-league', 'net', store)
  assert.equal(store.getItem(scoringKey('mens-league')), 'net')
})