import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeUrlState } from '../components/competition/url-state.ts'

test('parses view/occurrence/scoring/grouping from search params', () => {
  const s = new URLSearchParams('view=weekly&week=18&scoring=gross&grouping=A')
  const r = normalizeUrlState(s, { occurrenceParam: 'week', allowedViews: ['season', 'weekly'], allowedScoring: ['gross', 'net'] })
  assert.deepEqual(r, { view: 'weekly', occurrenceId: '18', scoring: 'gross', grouping: 'A', placedOnly: false })
})

test('parses the presentation-only placed filter', () => {
  const r = normalizeUrlState(new URLSearchParams('placed=only'), { occurrenceParam: 'week', allowedViews: ['weekly'], allowedScoring: ['gross', 'net'] })
  assert.equal(r.placedOnly, true)
})

test('drops unknown view/scoring values (returns null for them)', () => {
  const s = new URLSearchParams('view=bogus&scoring=stableford')
  const r = normalizeUrlState(s, { occurrenceParam: 'week', allowedViews: ['season', 'weekly'], allowedScoring: ['gross', 'net'] })
  assert.equal(r.view, null)
  assert.equal(r.scoring, null)
})

test('occurrence absent → null', () => {
  const r = normalizeUrlState(new URLSearchParams(''), { occurrenceParam: 'week', allowedViews: ['weekly'], allowedScoring: ['gross', 'net'] })
  assert.equal(r.occurrenceId, null)
})
