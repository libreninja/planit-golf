import { test } from 'node:test'
import assert from 'node:assert/strict'
import { playerRoundPresentation } from '../lib/players/player-detail-presentation.ts'
import type { PlayerRound } from '../lib/players/player-detail.ts'

const round: PlayerRound = {
  week: 21,
  eventName: 'Week 23',
  eventDate: '2026-09-01',
  format: 'individual',
  state: 'final',
  grossTotal: 28,
  netTotal: 25,
  toParGrossTotal: 0,
  toParNetTotal: -3,
  holesCompleted: 9,
  grossScores: [4, 3, 3, 3, 3, 3, 3, 3, 3],
  netScores: [4, 3, 3, 3, 3, 3, 3, 3, 3],
  toParGross: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  toParNet: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  grossResult: { week: 21, competition: 'gross', positionLabel: null, flightName: 'Flight 1', points: null },
  netResult: { week: 21, competition: 'net', positionLabel: 'T1', flightName: 'Flight 1', points: 400 },
  flight: 'Flight 1',
  isCompletedComparableNine: true,
}

test('originating Gross and Net contexts foreground only their respective result', () => {
  assert.deepEqual(playerRoundPresentation(round, 'gross'), {
    competition: 'gross', total: 28, toPar: 0, result: null,
  })
  assert.deepEqual(playerRoundPresentation(round, 'net'), {
    competition: 'net', total: 25, toPar: -3, result: round.netResult,
  })
})

test('empty placement rows are not treated as competition finish memberships', () => {
  assert.equal(playerRoundPresentation(round, 'gross').result, null)
  assert.equal(playerRoundPresentation({ ...round, netResult: { ...round.netResult!, positionLabel: '--', points: null } }, 'net').result, null)
})
