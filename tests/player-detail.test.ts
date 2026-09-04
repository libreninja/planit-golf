import { test } from 'node:test'
import assert from 'node:assert/strict'
import { derivePlayerDetail, type PlayerPerformanceFact } from '../lib/players/player-detail.ts'

const completed = (week: number, gross: number, net: number, grossDeltas = [0, 1, 2, -1, 0, 1, 2, 0, 1]): PlayerPerformanceFact => ({
  week,
  playerName: 'Player One',
  grossScores: grossDeltas.map((delta) => 4 + delta),
  netScores: grossDeltas.map(() => 4),
  toParGross: grossDeltas,
  toParNet: grossDeltas.map(() => 0),
  grossTotal: gross,
  netTotal: net,
  toParGrossTotal: gross - 36,
  toParNetTotal: net - 36,
  holesCompleted: 9,
  scorecardStatus: 'completed',
})

const events = [
  { week: 1, eventName: 'Week 1', eventDate: '2026-03-31', format: 'individual' as const },
  { week: 2, eventName: 'Week 2', eventDate: '2026-04-07', format: 'individual' as const },
  { week: 3, eventName: 'Week 3', eventDate: '2026-04-14', format: 'individual' as const },
  { week: 4, eventName: 'Scheduled only', eventDate: '2026-04-21', format: 'individual' as const },
  { week: 5, eventName: 'Team week', eventDate: '2026-04-28', format: 'team' as const },
]

test('source week is selected even when a newer completed result exists', () => {
  const model = derivePlayerDetail({ events, performances: [completed(1, 40, 35), completed(2, 38, 34)], results: [], season: null, selectedWeek: 1 })
  assert.equal(model.selectedRound?.week, 1)
})

test('an explicit source week with no player evidence does not fall through to another result', () => {
  const model = derivePlayerDetail({ events, performances: [completed(1, 40, 35)], results: [], season: null, selectedWeek: 4 })
  assert.equal(model.selectedRound, null)
  assert.equal(model.rounds[0].week, 1)
})

test('completed-round form excludes live/incomplete rounds and scheduled-only events', () => {
  const partial: PlayerPerformanceFact = {
    ...completed(3, 24, 20),
    grossScores: [4, 5, 4, 6, 5],
    netScores: [4, 4, 4, 5, 3],
    toParGross: [0, 1, 0, 2, 1],
    toParNet: [0, 0, 0, 1, -1],
    holesCompleted: 5,
    scorecardStatus: 'in_progress',
    state: 'live',
  }
  const model = derivePlayerDetail({ events, performances: [completed(1, 40, 35), completed(2, 38, 34), partial], results: [], season: null })
  assert.deepEqual(model.form.recentGross.map((item) => item.gross), [38, 40])
  assert.equal(model.form.seasonAverageGross, 39)
  assert.equal(model.form.seasonLowGross, 38)
  assert.equal(model.season.starts, 3)
  assert.equal(model.rounds.some((round) => round.week === 4), false, 'scheduled-only event is not a start or round')
})

test('an evidenced team appearance counts as a start without inventing an individual score', () => {
  const teamAppearance: PlayerPerformanceFact = {
    week: 5,
    playerName: 'Player One',
    grossScores: [], netScores: [], toParGross: [], toParNet: [],
    grossTotal: null, netTotal: null, toParGrossTotal: null, toParNetTotal: null,
    holesCompleted: 0,
    scorecardStatus: null,
  }
  const model = derivePlayerDetail({ events, performances: [completed(1, 40, 35), teamAppearance], results: [], season: null, selectedWeek: 5 })
  assert.equal(model.season.starts, 2)
  assert.equal(model.selectedRound?.state, 'participation')
  assert.equal(model.selectedRound?.grossTotal, null)
  assert.deepEqual(model.form.recentGross.map((round) => round.gross), [40])
})

test('gross and net facts and finishes remain distinct', () => {
  const model = derivePlayerDetail({
    events,
    performances: [completed(1, 42, 34)],
    results: [
      { week: 1, competition: 'gross', positionLabel: 'T2', flightName: 'Flight 1', points: 40 },
      { week: 1, competition: 'net', positionLabel: '7', flightName: 'Flight 1', points: 12.5 },
    ],
    season: null,
    selectedWeek: 1,
  })
  assert.equal(model.selectedRound?.grossTotal, 42)
  assert.equal(model.selectedRound?.netTotal, 34)
  assert.equal(model.selectedRound?.grossResult?.positionLabel, 'T2')
  assert.equal(model.selectedRound?.netResult?.positionLabel, '7')
  assert.equal(model.selectedRound?.grossResult?.points, 40)
  assert.equal(model.selectedRound?.netResult?.points, 12.5)
})

test('scoring distribution uses completed persisted gross and gross-to-par hole facts', () => {
  const model = derivePlayerDetail({ events, performances: [completed(1, 42, 18, [-2, -1, 0, 1, 2, 3, 0, 1, 2])], results: [], season: null })
  assert.deepEqual(model.scoringDistribution, {
    birdieOrBetter: 2,
    par: 2,
    bogey: 2,
    doubleOrWorse: 3,
    totalHoles: 9,
  })
})
