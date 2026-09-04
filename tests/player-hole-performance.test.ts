import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  deriveIgcMens2026HolePerformance,
  isAuditedIgcMens2026InterbayOccurrence,
  type GrossHoleCardFact,
  type HoleComparisonEventFact,
} from '../lib/players/igc-mens-2026-hole-performance.ts'

const pars = [4, 3, 3, 3, 3, 3, 3, 3, 3]

function event(week: 1 | 2): HoleComparisonEventFact {
  return week === 1 ? {
    week: 1,
    eventName: 'Points Season - Week 1',
    eventDate: '2026-03-31',
    format: 'individual',
    status: 'finalized',
    ggEventId: '12263651301715371717',
    ggRoundId: '12263654880094217735',
  } : {
    week: 2,
    eventName: 'Points Season - Week 2 - IGC Masters',
    eventDate: '2026-04-07',
    format: 'individual',
    status: 'finalized',
    ggEventId: '12263651301715371717',
    ggRoundId: '12263654884154304008',
  }
}

function card(week: number, memberCardId: string, grossScores: number[]): GrossHoleCardFact {
  return {
    week,
    memberCardId,
    grossScores,
    toParGross: grossScores.map((score, index) => score - pars[index]),
    holesCompleted: 9,
    scorecardStatus: 'completed',
  }
}

const threes = [4, 3, 3, 3, 3, 3, 3, 3, 3]

test('only exact audited event and round provenance qualifies hole ordinals for comparison', () => {
  assert.equal(isAuditedIgcMens2026InterbayOccurrence(event(1)), true)
  assert.equal(isAuditedIgcMens2026InterbayOccurrence({ ...event(1), ggRoundId: 'different-round' }), false)
  assert.equal(isAuditedIgcMens2026InterbayOccurrence({ ...event(1), ggEventId: 'different-event' }), false)
  assert.equal(isAuditedIgcMens2026InterbayOccurrence({ ...event(1), eventDate: '2026-04-01' }), false)
  assert.equal(isAuditedIgcMens2026InterbayOccurrence({ ...event(1), status: 'live' }), false)
  assert.equal(isAuditedIgcMens2026InterbayOccurrence({ ...event(1), format: 'team' }), false)
})

test('derives occurrence-matched per-play and cumulative gross comparisons', () => {
  const result = deriveIgcMens2026HolePerformance({
    memberCardId: 'target',
    events: [event(1), event(2)],
    cards: [
      card(1, 'target', [5, 4, 4, 3, 3, 3, 3, 3, 3]),
      card(1, 'peer-a', [4, 3, 3, 3, 3, 3, 3, 3, 3]),
      card(1, 'peer-b', [6, 3, 3, 3, 3, 3, 3, 3, 3]),
      card(2, 'target', [4, 3, 4, 3, 3, 3, 3, 3, 3]),
      card(2, 'peer-a', [6, 4, 3, 3, 3, 3, 3, 3, 3]),
      card(2, 'peer-b', [6, 4, 3, 3, 3, 3, 3, 3, 3]),
    ],
  })

  assert.ok(result)
  assert.equal(result.roundsCompared, 2)
  assert.equal(result.comparisonCards, 4)
  assert.deepEqual(result.holes[0], {
    hole: 1,
    par: 4,
    yardage: 288,
    playerAverage: 4.5,
    leagueAverage: 5.5,
    differentialPerPlay: -1,
    cumulativeDifferential: -2,
    timesPlayed: 2,
    comparisonCards: 4,
  })
  assert.equal(result.holes[2].differentialPerPlay, 1)
  assert.equal(result.holes[2].cumulativeDifferential, 2)
  assert.equal(result.bestRelativeHoles[0].hole, 1)
  assert.equal(result.givesBackMostHoles[0].hole, 3)
})

test('league benchmark excludes the target card from each occurrence field', () => {
  const result = deriveIgcMens2026HolePerformance({
    memberCardId: 'target',
    events: [event(1)],
    cards: [
      card(1, 'target', [10, ...threes.slice(1)]),
      card(1, 'peer', threes),
    ],
  })
  assert.ok(result)
  assert.equal(result.holes[0].playerAverage, 10)
  assert.equal(result.holes[0].leagueAverage, 4)
  assert.equal(result.holes[0].differentialPerPlay, 6)
})

test('incomplete, wrong-par, unaudited, and ambiguous target occurrences fail closed', () => {
  const incomplete = { ...card(1, 'target', threes), holesCompleted: 8, scorecardStatus: 'in_progress' }
  const wrongPar = { ...card(1, 'peer', threes), toParGross: [1, 0, 0, 0, 0, 0, 0, 0, 0] }
  const unauditedEvent = { ...event(1), ggRoundId: 'same-hole-numbers-different-round' }

  assert.equal(deriveIgcMens2026HolePerformance({
    memberCardId: 'target', events: [event(1)], cards: [incomplete, card(1, 'peer', threes)],
  }), null)
  assert.equal(deriveIgcMens2026HolePerformance({
    memberCardId: 'target', events: [event(1)], cards: [card(1, 'target', threes), wrongPar],
  }), null)
  assert.equal(deriveIgcMens2026HolePerformance({
    memberCardId: 'target', events: [unauditedEvent], cards: [card(1, 'target', threes), card(1, 'peer', threes)],
  }), null)
  assert.equal(deriveIgcMens2026HolePerformance({
    memberCardId: 'target', events: [event(1)], cards: [
      card(1, 'target', threes), card(1, 'target', threes), card(1, 'peer', threes),
    ],
  }), null)
})
