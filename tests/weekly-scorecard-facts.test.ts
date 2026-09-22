import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { withWeeklyScorecardFacts, readWeeklyScorecardFacts } from '../lib/competition/weekly-scorecard-facts.ts'
import { buildScorecardContext } from '../components/competition/scorecard-context.ts'
import { buildHoles, trimScorecardsToRoundHoles } from '../lib/igc/weekly-results-helpers.ts'
import { authoritativeScorecard } from '../lib/competition/authoritative-scorecard.ts'
import { getLiveResults } from '../lib/competition/live.ts'
import { makeLiveCacheStore } from '../lib/competition/cache.ts'
import { weeklyScorecardFixtures } from './fixtures/weekly-scorecard-context.ts'
import type { Scorecard } from '../lib/competition/types.ts'

const sources = JSON.parse(readFileSync(new URL('./fixtures/weekly-player-rounds.json', import.meta.url), 'utf8'))
const fixture = weeklyScorecardFixtures[0]
function card(f: typeof weeklyScorecardFixtures[number] = fixture): Scorecard {
  return { key: f.memberCardId, memberCardId: f.memberCardId, name: f.name,
    grossTotal: f.grossTotal, netTotal: f.netTotal, toParGross: f.grossPar, toParNet: f.netPar,
    holesCompleted: 9, isLive: false, scorecardStatus: 'completed',
    holes: buildHoles([...f.gross], [...f.net], [...f.netToPar], [...f.grossToPar]) }
}
function sheet(league = 'mens', week = 23) {
  return [{ pairing_group: { players: sources.filter((s: any) => s.league === league && s.week === week).map((s: any) => ({ ...s.player, tee: s.tee })) } }]
}

test('Tim: direct allocation is seven strokes; hole 3 actual 2, zero dots, birdie in both modes', () => {
  const before = card()
  const [enriched] = withWeeklyScorecardFacts([before], sheet())
  assert.deepEqual(enriched.holes.map(h => h.handicapStrokes), [1,1,0,0,1,1,1,1,1])
  const views = ['gross', 'net', 'gross'].map(mode => buildScorecardContext(enriched, mode as 'gross' | 'net'))
  for (const view of views) {
    assert.deepEqual(view.holes.map(h => h.strokes), [...fixture.gross])
    assert.equal(view.holes[2].strokes, 2)
    assert.equal(view.holes[2].handicapStrokes, 0)
    assert.equal(view.holes[2].mark, 'circle')
  }
  assert.deepEqual(views[0].holes.map(h => h.mark), ['square','plain','circle','plain','plain','square','double-square','square','plain'])
  assert.deepEqual(views[1].holes.map(h => h.mark), ['plain','circle','circle','plain','circle','plain','square','plain','circle'])
  assert.equal(views[0].total, 32); assert.equal(views[0].toPar, 4)
  assert.equal(views[1].total, 25); assert.equal(views[1].toPar, -3)
  assert.deepEqual(before, card(), 'imported facts untouched')
})

test('Jeff: historical and current explicit nine-hole allocations total four on 1,5,6,7', () => {
  for (const week of [23,24]) {
    const c = { ...card(), key: 'jeff', memberCardId: '2925267424527804043' }
    const [result] = withWeeklyScorecardFacts([c], sheet('mens', week))
    const strokes = result.holes.map(h => h.handicapStrokes!)
    assert.deepEqual(strokes, [1,0,0,0,1,1,1,0,0])
    assert.equal(strokes.reduce((sum, x) => sum + x, 0), 4)
  }
})

test('Women: multiple strokes and double circles preserve actual scores', () => {
  const f = weeklyScorecardFixtures[1]
  const [result] = withWeeklyScorecardFacts([card(f)], sheet('womens', 17))
  const view = buildScorecardContext(result, 'net')
  assert.deepEqual(result.holes.map(h => h.handicapStrokes), [...f.handicapStrokes])
  assert.deepEqual(view.holes.map(h => h.strokes), [...f.gross])
  assert.equal(view.holes[0].mark, 'double-circle')
})

test('missing, malformed, ambiguous and unsafe identities never fabricate zero allocation', () => {
  for (const raw of [null, [], [{ pairing_group: { players: [{ name: fixture.name, member_card_id: Number(fixture.memberCardId), handicap_dots_by_hole: [1] }] } }]]) {
    assert.ok(withWeeklyScorecardFacts([card()], raw)[0].holes.every(h => h.handicapStrokes === null))
  }
  const raw = sheet()
  raw[0].pairing_group.players[0].handicap_dots_by_hole = [0, null, 2, -1, '1', 1.5]
  assert.deepEqual(withWeeklyScorecardFacts([card()], raw)[0].holes.map(h => h.handicapStrokes), [0,null,2,null,null,null,null,null,null])
  raw[0].pairing_group.players.push(raw[0].pairing_group.players[0])
  assert.ok(withWeeklyScorecardFacts([card()], raw)[0].holes.every(h => h.handicapStrokes === null))
})

test('partial and Net-only cards use actual strokes without adding future play or changing THRU', () => {
  const c = authoritativeScorecard(null, card())!
  c.holes = c.holes.slice(0, 4); c.holesCompleted = 4
  trimScorecardsToRoundHoles([c], true)
  const [result] = withWeeklyScorecardFacts([c], sheet())
  const view = buildScorecardContext(result, 'net')
  assert.equal(result.holesCompleted, 4); assert.equal(result.isLive, true)
  assert.equal(view.holes.length, 9)
  assert.deepEqual(view.holes.map(h => h.strokes), [5,3,2,3,null,null,null,null,null])
  assert.ok(view.holes.slice(4).every(h => h.mark === 'plain' && h.toPar === null))
  assert.equal(view.holes[4].handicapStrokes, 1, 'authoritative future-hole allocation survives')
  assert.equal(result.grossTotal, null, 'no Gross aggregate is imported into Net-only response')
})

test('supplemental read isolates round IDs, shares modes, and degrades without hiding results', async () => {
  const calls: string[] = []
  const cacheStore = makeLiveCacheStore(new Map())
  const input = { cards: [card()], tenantKey: 'igc', competitionKey: 'mens-league', occurrenceId: '23', ggEventId: 'E', ggRoundId: 'R', cacheStore,
    ggClient: async (path: string) => { calls.push(path); return sheet() } }
  await readWeeklyScorecardFacts(input); await readWeeklyScorecardFacts(input)
  await readWeeklyScorecardFacts({ ...input, ggRoundId: 'R2' })
  assert.deepEqual(calls, ['/events/E/rounds/R/tee_sheet', '/events/E/rounds/R2/tee_sheet'])
  const [unknown] = await readWeeklyScorecardFacts({ ...input, ggRoundId: 'failed', ggClient: async () => { throw Error('unavailable') } })
  assert.equal(unknown.netTotal, 25); assert.equal(unknown.holes[0].handicapStrokes, null)
})

for (const f of weeklyScorecardFixtures) {
  test(`${f.league}: full live discovery to rendering preserves actual strokes across Gross→Net→Gross`, async () => {
    const aggregate = (mode: 'gross' | 'net') => ({ name: f.name, member_cards: [{ member_card_id_str: f.memberCardId }],
      // Embedded opposite-mode values are intentionally wrong: only the
      // chosen competition plus independent tee-sheet facts are authoritative.
      gross_scores: mode === 'gross' ? [...f.gross] : Array(9).fill(99),
      net_scores: mode === 'net' ? [...f.net] : Array(9).fill(99),
      to_par_gross: [...f.grossToPar], to_par_net: [...f.netToPar],
      totals: { gross_scores: { out: f.grossTotal }, net_scores: { out: f.netTotal },
        to_par_gross: { out: f.grossPar }, to_par_net: { out: f.netPar } } })
    const deps = { adapterConfig: { seasonId: 'S', categoryId: 'C', eventFilter: f.league, tenantKey: 'igc', roundResolution: 'pointsRoundIndex' as const },
      cacheStore: makeLiveCacheStore(new Map()), readEvent: async () => null,
      ggClient: async (path: string) => {
        if (path.includes('/events?')) return [{ id: 'E', name: f.league, category_id: 'C' }]
        if (path.endsWith('/rounds')) return [{ id: 'R', is_points_round: true, position: f.week }]
        if (path.endsWith('/tournaments')) return [{ event: { id: 'g', name: 'Gross Regular Season' } }, { event: { id: 'n', name: 'Net Regular Season' } }]
        if (path.endsWith('/tee_sheet')) return sheet(f.league, f.week)
        return { event: { scopes: [{ name: 'Overall', aggregates: [aggregate(path.endsWith('/g.json') ? 'gross' : 'net')] }] } }
      } }
    for (const mode of ['gross','net','gross'] as const) {
      const response = await getLiveResults({ competitionKey: `${f.league}-league`, occurrenceId: String(f.week), scoring: mode, nowIso: '2026-09-22T12:00:00Z', deps })
      const result = response.leaderboard!.scorecards[0]
      const view = buildScorecardContext(result, mode)
      assert.deepEqual(view.holes.map(h => h.strokes), [...f.gross])
      assert.deepEqual(view.holes.map(h => h.handicapStrokes), [...f.handicapStrokes])
      assert.equal(view.total, f[`${mode}Total`]); assert.equal(view.toPar, f[`${mode}Par`])
    }
  })
}
