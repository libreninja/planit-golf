import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeTournament, type GGResultsFixture } from '../lib/competition/adapters/golfgenius/normalize.ts'

function fixture(): GGResultsFixture {
  return {
    event: {
      scopes: [
        {
          name: 'Flight 1',
          aggregates: [
            {
              name: 'Hans Olson',
              position: '1',
              points: '50',
              purse: '$55.00',
              member_cards: [{ member_card_id_str: 'mc-1' }],
              net_scores: [4, 5, 4],
              gross_scores: [5, 6, 5],
              to_par_net: [-1, 0, -1],
              to_par_gross: [0, 0, 0],
              totals: { net_scores: { out: 13, total: 13 }, gross_scores: { out: 16, total: 16 } },
              scorecard_statuses: [{ status: 'completed' }],
            },
          ],
        },
      ],
    },
  }
}

test('normalizes one player into a generic ResultEntry + Scorecard', () => {
  const { entriesByFlight, scorecards } = normalizeTournament(fixture(), 'gross')
  assert.equal(entriesByFlight.size, 1)
  const flight = entriesByFlight.get('Flight 1')!
  assert.equal(flight.length, 1)
  assert.equal(flight[0].name, 'Hans Olson')
  assert.equal(flight[0].positionLabel, '1')
  assert.equal(flight[0].points, 50)
  assert.equal(scorecards.size, 1)
  const card = scorecards.get('mc-1')!
  assert.equal(card.holesCompleted, 3)
  assert.equal(card.grossTotal, 16)
})

test('empty scopes → empty result, no crash', () => {
  const { entriesByFlight, scorecards } = normalizeTournament({ event: { scopes: [] } }, 'net')
  assert.equal(entriesByFlight.size, 0)
  assert.equal(scorecards.size, 0)
})
