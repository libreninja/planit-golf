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

test('upstreamStatus derived from event.status when present', () => {
  const { upstreamStatus } = normalizeTournament({ event: { scopes: [], status: 'completed' } }, 'gross')
  assert.equal(upstreamStatus, 'completed')
})

test('non-empty event.season_points → completed (GG league rounds expose no event.status)', () => {
  // IGC league .json never populates event.status; a non-empty season_points is
  // the authoritative "scored/finalized" signal. This is what unblocks the
  // reconcile import gate.
  const fx = fixture()
  fx.event!.status = undefined
  fx.event!.season_points = [{ member_card_id: 'mc-1', total_points: 50 }]
  const { upstreamStatus } = normalizeTournament(fx, 'net')
  assert.equal(upstreamStatus, 'completed')
})

test('no scored cards + empty season_points (not-yet-posted round) → unknown, not completed', () => {
  // A real future/not-yet-posted round has empty scopes (no aggregates). The
  // completed-fallback below requires at least one 'completed' card, so this
  // stays unknown — the reconcile import gate stays closed.
  const { upstreamStatus } = normalizeTournament({ event: { scopes: [], season_points: [] } }, 'net')
  assert.equal(upstreamStatus, 'unknown')
})

test('empty season_points + all-completed cards → completed (Women\'s League: no points category in GG)', () => {
  // Women's league rounds never populate event.season_points (GG has no points
  // category for them), but GG marks every turned-in card 'completed' at
  // finalization. That scorecard-status signal is the completed fallback so
  // women's rounds import + finalize through the same pipeline as men's.
  const fx = fixture()   // one 'completed' card, season_points unset
  fx.event!.status = undefined
  fx.event!.season_points = []
  const { upstreamStatus } = normalizeTournament(fx, 'net')
  assert.equal(upstreamStatus, 'completed')
})

test('empty season_points + an in_progress card → not completed (live round mid-play)', () => {
  // A live round has at least one card still in progress; the fallback must NOT
  // fire (would import an unfinished round). status 'in_progress' / 'live' /
  // 'started' all block it.
  const fx = fixture()
  fx.event!.status = undefined
  fx.event!.season_points = []
  fx.event!.scopes![0].aggregates![0].scorecard_statuses = [{ status: 'in_progress' }]
  const { upstreamStatus } = normalizeTournament(fx, 'net')
  assert.notEqual(upstreamStatus, 'completed')
})

test('season_points takes precedence over the scorecard fallback (men\'s path unchanged)', () => {
  // Men's league rounds populate season_points; that branch fires first, so the
  // fallback never changes men's behavior even if cards were somehow mixed.
  const fx = fixture()
  fx.event!.status = undefined
  fx.event!.season_points = [{ member_card_id: 'mc-1', total_points: 50 }]
  fx.event!.scopes![0].aggregates![0].scorecard_statuses = [{ status: 'in_progress' }]
  const { upstreamStatus } = normalizeTournament(fx, 'gross')
  assert.equal(upstreamStatus, 'completed')
})
