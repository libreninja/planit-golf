import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  deriveIgcMens2026HolePerformance,
  isAuditedIgcMens2026InterbayOccurrence,
  resolvePlayerPerformanceComparator,
  type GrossHoleCardFact,
  type HoleComparisonEventFact,
  type OfficialFlightResultFact,
} from '../lib/players/igc-mens-2026-hole-performance.ts'

const pars = [4, 3, 3, 3, 3, 3, 3, 3, 3]
const baseline = [4, 3, 3, 3, 3, 3, 3, 3, 3]

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

function card(week: number, memberCardId: string, grossScores: number[], playerName = memberCardId): GrossHoleCardFact {
  return {
    week,
    memberCardId,
    playerName,
    grossScores,
    toParGross: grossScores.map((score, index) => score - pars[index]),
    holesCompleted: 9,
    scorecardStatus: 'completed',
  }
}

function officialFlight(
  week: number,
  memberCardId: string,
  flightName: string,
  playerName = memberCardId,
): OfficialFlightResultFact[] {
  return [
    { week, memberCardId, playerName, competition: 'gross', flightName },
    { week, memberCardId, playerName, competition: 'net', flightName },
  ]
}

test('only exact audited event and round provenance qualifies hole ordinals for comparison', () => {
  assert.equal(isAuditedIgcMens2026InterbayOccurrence(event(1)), true)
  assert.equal(isAuditedIgcMens2026InterbayOccurrence({ ...event(1), ggRoundId: 'different-round' }), false)
  assert.equal(isAuditedIgcMens2026InterbayOccurrence({ ...event(1), ggEventId: 'different-event' }), false)
  assert.equal(isAuditedIgcMens2026InterbayOccurrence({ ...event(1), eventDate: '2026-04-01' }), false)
  assert.equal(isAuditedIgcMens2026InterbayOccurrence({ ...event(1), status: 'live' }), false)
  assert.equal(isAuditedIgcMens2026InterbayOccurrence({ ...event(1), format: 'team' }), false)
})

test('derives unchanged occurrence-matched field comparison and defaults to flight when available', () => {
  const cards = [
    card(1, 'target', [5, 4, 4, 3, 3, 3, 3, 3, 3]),
    card(1, 'peer-a', baseline),
    card(1, 'peer-b', [6, 3, 3, 3, 3, 3, 3, 3, 3]),
    card(2, 'target', [4, 3, 4, 3, 3, 3, 3, 3, 3]),
    card(2, 'peer-a', [6, 4, 3, 3, 3, 3, 3, 3, 3]),
    card(2, 'peer-b', [6, 4, 3, 3, 3, 3, 3, 3, 3]),
  ]
  const officialFlightResults = cards.flatMap((item) => officialFlight(item.week, item.memberCardId as string, 'Flight 2'))
  const result = deriveIgcMens2026HolePerformance({
    memberCardId: 'target', events: [event(1), event(2)], cards, officialFlightResults,
  })

  assert.ok(result?.field)
  assert.ok(result.flight)
  assert.equal(result.preferredComparator, 'flight')
  assert.equal(resolvePlayerPerformanceComparator(result, null)?.comparator, 'flight')
  assert.deepEqual(result.field.holes[0], {
    hole: 1,
    par: 4,
    yardage: 288,
    playerAverage: 4.5,
    comparatorAverage: 5.5,
    differentialPerPlay: -1,
    cumulativeDifferential: -2,
    timesPlayed: 2,
    comparisonCards: 4,
  })
  assert.equal(result.field.holes[2].differentialPerPlay, 1)
  assert.equal(result.field.relativeStrengths[0].hole, 1)
  assert.equal(result.field.largestGaps[0].hole, 3)
})

test('resolves the target flight independently each occurrence and uses that weekly cohort', () => {
  const cards = [
    card(1, 'target', [5, ...baseline.slice(1)]),
    card(1, 'flight-one', [4, ...baseline.slice(1)]),
    card(1, 'flight-two', [9, ...baseline.slice(1)]),
    card(2, 'target', [5, ...baseline.slice(1)]),
    card(2, 'flight-one', [9, ...baseline.slice(1)]),
    card(2, 'flight-two', [6, ...baseline.slice(1)]),
  ]
  const officialFlightResults = [
    ...officialFlight(1, 'target', 'Flight 1'),
    ...officialFlight(1, 'flight-one', 'Flight 1'),
    ...officialFlight(1, 'flight-two', 'Flight 2'),
    ...officialFlight(2, 'target', 'Flight 2'),
    ...officialFlight(2, 'flight-one', 'Flight 1'),
    ...officialFlight(2, 'flight-two', 'Flight 2'),
  ]
  const result = deriveIgcMens2026HolePerformance({
    memberCardId: 'target', events: [event(1), event(2)], cards, officialFlightResults,
  })

  assert.ok(result?.flight)
  assert.equal(result.flight.roundsCompared, 2)
  assert.equal(result.flight.comparisonCards, 2)
  assert.equal(result.flight.holes[0].comparatorAverage, 5)
  assert.equal(result.flight.holes[0].differentialPerPlay, 0)
  assert.equal(result.field?.holes[0].comparatorAverage, 7)
})

test('projected, ambiguous, missing, or gross/net-disagreeing flight evidence fails closed', () => {
  const cards = [card(1, 'target', [5, ...baseline.slice(1)]), card(1, 'peer', baseline)]
  const cases: OfficialFlightResultFact[][] = [
    [
      { week: 1, memberCardId: 'target', playerName: 'target', competition: 'gross', flightName: 'Projected Flight 1' },
      { week: 1, memberCardId: 'target', playerName: 'target', competition: 'net', flightName: 'Projected Flight 1' },
      ...officialFlight(1, 'peer', 'Flight 1'),
    ],
    [
      { week: 1, memberCardId: 'target', playerName: 'target', competition: 'gross', flightName: 'Flight 1' },
      { week: 1, memberCardId: 'target', playerName: 'target', competition: 'net', flightName: 'Flight 2' },
      ...officialFlight(1, 'peer', 'Flight 1'),
    ],
    [
      ...officialFlight(1, 'target', 'Flight 1'),
      ...officialFlight(1, 'peer', 'Flight 1', 'different-name'),
    ],
  ]

  for (const officialFlightResults of cases) {
    const result = deriveIgcMens2026HolePerformance({ memberCardId: 'target', events: [event(1)], cards, officialFlightResults })
    assert.ok(result?.field)
    assert.equal(result.flight, null)
    assert.equal(result.preferredComparator, 'field')
  }
})

test('flight comparison excludes unresolved peers while field still includes them', () => {
  const cards = [
    card(1, 'target', [5, ...baseline.slice(1)]),
    card(1, 'resolved-peer', [4, ...baseline.slice(1)]),
    card(1, 'shared-card', [10, ...baseline.slice(1)], 'Smith, Scott M.'),
  ]
  const result = deriveIgcMens2026HolePerformance({
    memberCardId: 'target',
    events: [event(1)],
    cards,
    officialFlightResults: [
      ...officialFlight(1, 'target', 'Flight 1'),
      ...officialFlight(1, 'resolved-peer', 'Flight 1'),
      ...officialFlight(1, 'shared-card', 'Flight 1', 'Smith, Scott'),
    ],
  })

  assert.ok(result?.flight)
  assert.equal(result.flight.comparisonCards, 1)
  assert.equal(result.flight.holes[0].comparatorAverage, 4)
  assert.equal(result.field?.comparisonCards, 2)
  assert.equal(result.field?.holes[0].comparatorAverage, 7)
})

test('field remains useful and explicit when authoritative flight comparison is unavailable', () => {
  const result = deriveIgcMens2026HolePerformance({
    memberCardId: 'target',
    events: [event(1)],
    cards: [card(1, 'target', [10, ...baseline.slice(1)]), card(1, 'peer', baseline)],
    officialFlightResults: [],
  })
  assert.ok(result?.field)
  assert.equal(result.flight, null)
  assert.equal(result.field.holes[0].playerAverage, 10)
  assert.equal(result.field.holes[0].comparatorAverage, 4)
  assert.equal(resolvePlayerPerformanceComparator(result, null)?.comparator, 'field')
  assert.deepEqual(resolvePlayerPerformanceComparator(result, 'flight'), {
    comparator: 'field', lens: result.field, fellBackFromFlight: true,
  })
})

test('incomplete, wrong-par, unaudited, and ambiguous target occurrences fail closed', () => {
  const incomplete = { ...card(1, 'target', baseline), holesCompleted: 8, scorecardStatus: 'in_progress' }
  const wrongPar = { ...card(1, 'peer', baseline), toParGross: [1, 0, 0, 0, 0, 0, 0, 0, 0] }
  const unauditedEvent = { ...event(1), ggRoundId: 'same-hole-numbers-different-round' }

  assert.equal(deriveIgcMens2026HolePerformance({
    memberCardId: 'target', events: [event(1)], cards: [incomplete, card(1, 'peer', baseline)],
  }), null)
  assert.equal(deriveIgcMens2026HolePerformance({
    memberCardId: 'target', events: [event(1)], cards: [card(1, 'target', baseline), wrongPar],
  }), null)
  assert.equal(deriveIgcMens2026HolePerformance({
    memberCardId: 'target', events: [unauditedEvent], cards: [card(1, 'target', baseline), card(1, 'peer', baseline)],
  }), null)
  assert.equal(deriveIgcMens2026HolePerformance({
    memberCardId: 'target', events: [event(1)], cards: [
      card(1, 'target', baseline), card(1, 'target', baseline), card(1, 'peer', baseline),
    ],
  }), null)
})
