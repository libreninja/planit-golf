import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildScorecardContext } from '../components/competition/scorecard-context.ts'
import { buildMobileStats, formatThru, formatToPar } from '../components/competition/leaderboard-format.ts'
import { buildHoles, trimScorecardsToRoundHoles } from '../lib/igc/weekly-results-helpers.ts'
import type { Scorecard, ResultEntry } from '../lib/competition/types.ts'
import { weeklyScorecardFixtures } from './fixtures/weekly-scorecard-context.ts'

function fixtureCard(f = weeklyScorecardFixtures[0] as typeof weeklyScorecardFixtures[number]): Scorecard {
  return {
    key: f.name, name: f.name, memberCardId: null,
    grossTotal: f.grossTotal, netTotal: f.netTotal,
    toParGross: f.grossPar, toParNet: f.netPar,
    holesCompleted: 9, scorecardStatus: 'completed', isLive: false,
    holes: buildHoles([...f.gross], [...f.net], [...f.netToPar], [...f.grossToPar]),
  }
}
const entry: ResultEntry = { key: 'player', name: 'Player', positionLabel: '1', positionOrder: 1, points: null, purse: null, flight: null }

for (const fixture of weeklyScorecardFixtures) {
  for (const mode of ['gross', 'net'] as const) {
    test(`${fixture.league}: ${mode} holes reconcile with the selected aggregate and mobile result`, () => {
      const card = fixtureCard(fixture)
      const before = structuredClone(card)
      const view = buildScorecardContext(card, mode)
      assert.equal(view.label, mode === 'gross' ? 'Gross' : 'Net')
      assert.equal(view.total, fixture[`${mode}Total`])
      assert.equal(view.toPar, fixture[`${mode}Par`])
      assert.deepEqual(view.holes.map(h => h.strokes), fixture[mode])
      assert.deepEqual(view.holes.map(h => h.toPar), fixture[`${mode}ToPar`])
      assert.equal(view.holes.reduce((sum, h) => sum + h.toPar!, 0), view.toPar)
      assert.equal(view.holes.reduce((sum, h) => sum + h.strokes!, 0), view.total)
      assert.equal(view.total! - 28, view.toPar)
      assert.equal(view.holes.at(-1)?.cumulativeToPar, view.toPar)
      const mobile = buildMobileStats(entry, card, mode)
      assert.equal(mobile.find(s => s.label === view.label)?.value, String(view.total))
      assert.equal(mobile.find(s => s.label === 'To Par')?.value, formatToPar(view.toPar))
      assert.equal(mobile.find(s => s.label === 'Thru')?.value, 'F')
      assert.deepEqual(card, before, 'presentation must not mutate scoring or progress facts')
      assert.ok(!('grossTotal' in view) && !('netTotal' in view), 'renderer gets only the selected result')
    })
  }
}

test('Tim Gross annotations are exactly +1, E, -1, E, E, +1, +2, +1, E', () => {
  const view = buildScorecardContext(fixtureCard(), 'gross')
  assert.deepEqual(view.holes.map(h => formatToPar(h.toPar)), ['+1', 'E', '-1', 'E', 'E', '+1', '+2', '+1', 'E'])
  assert.equal(view.holes.reduce((sum, h) => sum + h.toPar!, 0), 4)
})

test('Gross hole annotations use strokes versus par, never Net or its running score', () => {
  const card = fixtureCard()
  card.holes[0] = { ...card.holes[0], toPar: -99, cumulativeToPar: -99, toParGross: null }
  assert.equal(buildScorecardContext(card, 'gross').holes[0].toPar, 1)
})

for (const mode of ['gross', 'net'] as const) {
  test(`${mode}: unavailable selected scores never fall back to the alternate mode`, () => {
    const card = fixtureCard()
    card[`${mode}Total`] = null
    card[mode === 'gross' ? 'toParGross' : 'toParNet'] = null
    card.holes = card.holes.map(h => ({ ...h, [mode]: null }))
    const view = buildScorecardContext(card, mode)
    assert.equal(view.total, null)
    assert.equal(view.toPar, null)
    assert.ok(view.holes.every(h => h.strokes === null && h.toPar === null))
  })

  test(`${mode}: partial card retains nine holes, unplayed blanks, and #42 THRU`, () => {
    const card = fixtureCard()
    card.holes = card.holes.slice(0, 4)
    card.holesCompleted = 4
    card.grossTotal = 13; card.toParGross = 0
    card.netTotal = 11; card.toParNet = -2
    trimScorecardsToRoundHoles([card], false)
    const before = structuredClone(card)
    const view = buildScorecardContext(card, mode)
    assert.equal(view.holes.length, 9)
    assert.ok(view.holes.slice(4).every(h => h.strokes === null && h.toPar === null))
    assert.equal(view.holes.reduce((sum, h) => sum + (h.toPar ?? 0), 0), view.toPar)
    assert.equal(formatThru(card.holesCompleted, card.holes.length), 'thru 4')
    assert.equal(buildMobileStats(entry, card, mode).find(s => s.label === 'Thru')?.value, 'thru 4')
    assert.equal(card.isLive, true)
    assert.deepEqual(card, before)
  })
}

test('Net zero is a score; missing Net delta stays unknown even with Gross facts', () => {
  const card = fixtureCard()
  card.holes[0] = { ...card.holes[0], net: 0, toPar: -4 }
  assert.equal(buildScorecardContext(card, 'net').holes[0].strokes, 0)
  assert.equal(buildScorecardContext(card, 'net').holes[0].toPar, -4)
  card.holes[0].toPar = null
  assert.equal(buildScorecardContext(card, 'net').holes[0].toPar, null)
  assert.ok(buildScorecardContext(card, 'net').holes.every(h => h.cumulativeToPar === null))
})
