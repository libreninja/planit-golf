import { test } from 'node:test'
import assert from 'node:assert/strict'
import { authoritativeScorecard } from '../lib/competition/authoritative-scorecard.ts'
import { normalizeTournament, type GGAggregate } from '../lib/competition/adapters/golfgenius/normalize.ts'
import { importOccurrence, type ImportDb } from '../lib/competition/reconcile/import.ts'

const aggregate: GGAggregate = {
  name: 'Werlinger, Kevin', member_cards: [{ member_card_id_str: 'kevin' }],
  gross_scores: [2, 3, 3, 4, 2, 3, 4, 4, 2],
  net_scores: [2, 3, 3, 4, 2, 3, 4, 4, 2],
  to_par_gross: [-2, 0, 0, 1, -1, 0, 1, 1, -1],
  to_par_net: [-2, 0, 0, 1, -1, 0, 1, 1, -1],
  totals: { gross_scores: { out: 27 }, net_scores: { out: 27 }, to_par_gross: { out: -1 }, to_par_net: { out: -1 } },
  position: '--', points: '', purse: '', scorecard_statuses: [{ status: 'completed' }],
}
const netAggregate: GGAggregate = {
  ...aggregate, net_scores: [1, 3, 3, 4, 2, 2, 3, 4, 2],
  to_par_net: [-3, 0, 0, 1, -1, -1, 0, 1, -1],
  totals: { ...aggregate.totals, net_scores: { out: 24 }, to_par_net: { out: -4 } },
  position: '1', points: '500', purse: '$45.00',
}
const payload = (a: GGAggregate, points = 0) => ({ event: {
  scopes: [{ name: 'Flight 1', aggregates: [a] }],
  season_points: [{ member_card_id: 'kevin', total_points: points }],
} })
const card = (a: GGAggregate) => [...normalizeTournament(payload(a), 'net').scorecards.values()][0]
const resolved = {
  weekNumber: 22, ggEventId: 'event', ggRoundId: 'round', grossTournamentId: 'gross', netTournamentId: 'net',
  upstreamStatus: 'completed' as const, roundDate: '2026-09-08', eventName: 'Week 22', sourceFinalizedAt: null, sourceVersion: 'v1',
}
const adapterConfig = { seasonId: 's', categoryId: 'c', eventFilter: 'mens', tenantKey: 'igc', roundResolution: 'pointsRoundIndex' as const }
async function imported(gross = aggregate, net = netAggregate, competitionKey = 'mens-league') {
  let performances: Record<string, unknown>[] = [], results: Record<string, unknown>[] = [], season: Record<string, unknown>[] = []
  const db: ImportDb = {
    upsertEvent: async () => ({ ok: true, id: 'ev' }),
    upsertPerformances: async (rows) => { performances = rows; return { ok: true } },
    upsertResults: async (rows) => { results = rows; return { ok: true } },
    upsertSeasonPointEntries: async (rows) => { season = rows; return { ok: true } },
    setDurableImported: async () => ({ ok: true }),
  }
  await importOccurrence({ competitionKey, resolved, adapterConfig, nowIso: '2026-09-21T00:00:00Z', db,
    ggClient: async (path) => path.endsWith('/courses')
      ? { courses: [{ tees: [{ hole_data: { par: [4, 3, 3, 3, 3, 3, 3, 3, 3] } }] }] }
      : path.endsWith('/gross.json') ? payload(gross, 25) : payload(net, 500),
  })
  return { performances, results, season }
}

for (const league of ['mens-league', 'womens-league']) test(`${league}: complete persisted Gross/Net facts use their own authoritative payload`, async () => {
  const actual = await imported(aggregate, netAggregate, league)
  assert.deepEqual(actual.performances, [{
    league_key: league === 'mens-league' ? 'mens' : 'womens', week_number: 22, event_id: 'ev',
    player_name: 'Werlinger, Kevin', member_card_id: 'kevin', flight_name: 'Flight 1',
    position_label: '1', flight_position: 1, weekly_position: 1, points: 500, purse: '$45.00',
    event_name: 'Week 22', event_date: '2026-09-08',
    gross_scores: [2, 3, 3, 4, 2, 3, 4, 4, 2], gross_total: 27,
    to_par_gross: [-2, 0, 0, 1, -1, 0, 1, 1, -1], to_par_gross_total: -1,
    net_scores: [1, 3, 3, 4, 2, 2, 3, 4, 2], net_total: 24,
    to_par_net: [-3, 0, 0, 1, -1, -1, 0, 1, -1], to_par_net_total: -4,
    holes_completed: 9, scorecard_status: 'completed', birdies: 3, double_bogeys: 0,
  }])
  const common = { league_key: league === 'mens-league' ? 'mens' : 'womens', week_number: 22, event_id: 'ev', member_card_id: 'kevin', player_name: 'Werlinger, Kevin', flight_name: 'Flight 1', synced_at: '2026-09-21T00:00:00Z' }
  assert.deepEqual(actual.results, [
    { ...common, competition: 'gross', position_label: null, flight_position: null, points: null, purse: '' },
    { ...common, competition: 'net', position_label: '1', flight_position: 1, points: 500, purse: '$45.00' },
  ])
  assert.equal(actual.season[0].total_points, 525)
  assert.deepEqual(await imported(aggregate, netAggregate, league), actual, 'repeat import is substantively idempotent')
})

test('live combined card preserves Gross authority even when Net embeds different Gross facts', () => {
  const gross = card(aggregate)
  const net = card({ ...netAggregate, gross_scores: [9], to_par_gross: [5], totals: { ...netAggregate.totals, gross_scores: { out: 9 }, to_par_gross: { out: 5 } } })
  const merged = authoritativeScorecard(gross, net)!
  assert.equal(merged.grossTotal, 27)
  assert.equal(merged.toParGross, -1)
  assert.deepEqual(merged.holes.map((h) => h.gross), aggregate.gross_scores)
  assert.equal(merged.netTotal, 24)
  assert.equal(merged.toParNet, -4)
  assert.deepEqual(merged.holes.map((h) => h.net), netAggregate.net_scores)
  assert.equal(merged.holes.at(-1)?.cumulativeToPar, -4)
  assert.deepEqual(gross, card(aggregate), 'input unchanged')
})

test('missing authoritative mode stays unknown; zero and partial Net values survive', () => {
  const gross = card(aggregate)
  const grossOnly = authoritativeScorecard(gross, null)!
  assert.equal(grossOnly.netTotal, null)
  assert.ok(grossOnly.holes.every((h) => h.net === null && h.toPar === null))
  const partial = card({ ...netAggregate, net_scores: [0, null], to_par_net: [-4, null], totals: {}, scorecard_statuses: [{ status: 'in_progress' }] })
  const netOnly = authoritativeScorecard(null, partial)!
  assert.equal(netOnly.grossTotal, null)
  assert.equal(netOnly.netTotal, 0)
  assert.equal(netOnly.toParNet, -4)
  assert.equal(netOnly.holes[0].par, 4)
  assert.equal(netOnly.scorecardStatus, 'in_progress')
  assert.ok(netOnly.holes.every((h) => h.gross === null && h.toParGross === null))
  assert.equal(authoritativeScorecard(null, null), null)
})

test('distinct identities cannot be merged under the same player name', async () => {
  await assert.rejects(imported(aggregate, { ...netAggregate, member_cards: [{ member_card_id_str: 'someone-else' }] }), /different identities/)
})

test('already-authoritative early-week style scorecards are unchanged and ties survive', async () => {
  const actual = await imported(netAggregate, { ...netAggregate, position: 'T1' })
  assert.equal(actual.performances[0].net_total, 24)
  assert.equal(actual.performances[0].gross_total, 27)
  assert.equal(actual.performances[0].position_label, 'T1')
  assert.equal(actual.results[1].position_label, 'T1')
})


test('persisted Gross facts survive a Net payload with different embedded Gross facts', async () => {
  const actual = await imported(aggregate, { ...netAggregate,
    gross_scores: [9], to_par_gross: [5],
    totals: { ...netAggregate.totals, gross_scores: { out: 9 }, to_par_gross: { out: 5 } },
  })
  assert.deepEqual(actual.performances[0].gross_scores, aggregate.gross_scores)
  assert.deepEqual(actual.performances[0].to_par_gross, aggregate.to_par_gross)
  assert.equal(actual.performances[0].gross_total, 27)
  assert.equal(actual.performances[0].to_par_gross_total, -1)
  assert.equal(actual.performances[0].net_total, 24)
})
