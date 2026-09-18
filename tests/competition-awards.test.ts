import { test } from 'node:test'
import assert from 'node:assert/strict'
import { storedAwardsAreComplete, type AwardResult } from '../lib/competition/reconcile/awards.ts'
import { mensLeagueConfig } from '../lib/competition/configs/mens-league.ts'
import { selectReconciliationCandidates } from '../lib/competition/reconcile/candidates.ts'

const at = '2026-09-18T12:00:00Z'
const awards: AwardResult[] = ['gross', 'net'].flatMap((competition) => [1, 2, 3].flatMap((flight) => [
  { competition, flight_name: `Flight ${flight}`, member_card_id: `${competition}-${flight}`, points: 500, purse: '$50.00', synced_at: at },
  { competition, flight_name: `Flight ${flight}`, member_card_id: `nonwinner-${flight}`, points: null, purse: null, synced_at: at },
]))
const season = new Set(awards.filter((x) => x.points !== null).map((x) => x.member_card_id!))

test('awards require both scoring modes, each flight, and every points recipient in the season snapshot', () => {
  assert.equal(storedAwardsAreComplete(awards, season, at, { purse: true }), true)
  assert.equal(storedAwardsAreComplete(awards, new Set(), at, { purse: true }), false)
  const incompleteSeason = new Set(season)
  incompleteSeason.delete('net-3')
  assert.equal(storedAwardsAreComplete(awards, incompleteSeason, at, { purse: true }), false)
  assert.equal(storedAwardsAreComplete(awards.filter((x) => x.competition !== 'net'), season, at, { purse: true }), false)
  const partial = awards.map((x) => x.competition === 'net' && x.flight_name === 'Flight 3' ? { ...x, points: null } : x)
  assert.equal(storedAwardsAreComplete(partial, season, at, { purse: true }), false)
})

test('no money is configured explicitly; missing or zero cash keeps cash rounds pending', () => {
  const noCash = awards.map((x) => ({ ...x, purse: null }))
  const monday = mensLeagueConfig.adapterConfig.specialOccurrences!.find((x) => x.weekNumber === 101)!
  assert.equal(storedAwardsAreComplete(noCash, season, at, monday.awards!), true)
  assert.equal(storedAwardsAreComplete(noCash, season, at, mensLeagueConfig.adapterConfig.awards!), false)
  const partialCash = awards.map((x) => x.competition === 'net' ? { ...x, purse: '$0.00' } : x)
  assert.equal(storedAwardsAreComplete(partialCash, season, at, { purse: true }), false)
})

test('empty snapshots and writes after the durable stamp cannot close awards reconciliation', () => {
  assert.equal(storedAwardsAreComplete([], season, at, { purse: true }), false)
  assert.equal(storedAwardsAreComplete(awards, season, null, { purse: true }), false)
  assert.equal(storedAwardsAreComplete(awards, season, '2026-09-17T12:00:00Z', { purse: true }), false)
})

test('official flights do not close pending awards; staleness still bounds discovery', () => {
  const event = { week_number: 22, event_date: '2026-09-08', event_format: 'individual' as const,
    discovery_state: 'discovered' as const, upstream_status: 'completed' as const,
    durable_imported_at: at, awaiting_official_flights: false, awaiting_awards: true }
  assert.equal(selectReconciliationCandidates([event], at)[0].kind, 'awaiting-awards')
  assert.equal(selectReconciliationCandidates([{ ...event, discovered_at: at }], at)[0].kind, 'stale')
  assert.equal(selectReconciliationCandidates([{ ...event, awaiting_awards: false }], at)[0].kind, 'old-current')
})
