// This is an intentionally narrow, fail-closed comparison contract for the
// 2026 IGC Men's League. Each occurrence below was verified against its Golf
// Genius tee sheet: every listed player used the same Interbay tee, started on
// hole 1, and received the same nine-hole par/yardage definition. A new round
// must be audited and added here before its hole-array ordinals are comparable.

export const IGC_MENS_2026_INTERBAY_CONTRACT = {
  key: 'igc-mens-2026-interbay-back-2023-front-nine',
  ggEventId: '12263651301715371717',
  ggCourseId: '10275121452864792250',
  ggCourseCatalogTeeId: '10275121691336140357',
  ggAssignedTeeId: '10275121691537466950',
  courseName: 'The Links at Interbay',
  teeName: 'Back 2023 - Men',
  startingHole: 1,
  pars: [4, 3, 3, 3, 3, 3, 3, 3, 3],
  yardages: [288, 153, 95, 102, 130, 186, 164, 124, 130],
  occurrences: [
    { week: 1, date: '2026-03-31', ggRoundId: '12263654880094217735' },
    { week: 2, date: '2026-04-07', ggRoundId: '12263654884154304008' },
    { week: 3, date: '2026-04-14', ggRoundId: '12263654888214390281' },
    { week: 4, date: '2026-04-21', ggRoundId: '12263654892140258826' },
    { week: 5, date: '2026-05-05', ggRoundId: '12263654900562421260' },
    { week: 6, date: '2026-05-12', ggRoundId: '12263654904656061965' },
    { week: 7, date: '2026-05-19', ggRoundId: '12263654908581930510' },
    { week: 8, date: '2026-05-26', ggRoundId: '12263654912507799055' },
    { week: 9, date: '2026-06-02', ggRoundId: '12263654916567885328' },
    { week: 10, date: '2026-06-09', ggRoundId: '12263654920393090577' },
    { week: 11, date: '2026-06-16', ggRoundId: '12263654924419622418' },
    { week: 12, date: '2026-06-23', ggRoundId: '12263654928513263123' },
    { week: 13, date: '2026-06-30', ggRoundId: '12263654932405577236' },
    { week: 14, date: '2026-07-07', ggRoundId: '12263654936264336917' },
    { week: 15, date: '2026-07-14', ggRoundId: '12263654946599101974' },
    { week: 16, date: '2026-07-21', ggRoundId: '12263654951800038935' },
    { week: 17, date: '2026-07-28', ggRoundId: '12263654955826570776' },
    { week: 18, date: '2026-08-04', ggRoundId: '12263654960121538073' },
    { week: 19, date: '2026-08-11', ggRoundId: '12263654964718495258' },
    { week: 20, date: '2026-08-25', ggRoundId: '12263654973341984284' },
    { week: 21, date: '2026-09-01', ggRoundId: '12263654979885098525' },
  ],
} as const

export interface HoleComparisonEventFact {
  week: number
  eventName: string
  eventDate: string | null
  format: 'individual' | 'team' | 'unknown'
  status: string | null
  ggEventId: string | null
  ggRoundId: string | null
}

export interface GrossHoleCardFact {
  week: number
  memberCardId: string | null
  playerName: string
  grossScores: (number | null)[]
  toParGross: (number | null)[]
  holesCompleted: number
  scorecardStatus: string | null
}

export interface OfficialFlightResultFact {
  week: number
  memberCardId: string
  playerName: string
  competition: 'gross' | 'net'
  flightName: string | null
}

export type PlayerPerformanceComparator = 'flight' | 'field'

export interface PlayerHoleComparison {
  hole: number
  par: number
  yardage: number
  playerAverage: number
  comparatorAverage: number
  differentialPerPlay: number
  cumulativeDifferential: number
  timesPlayed: number
  comparisonCards: number
}

export interface PlayerHoleComparisonLens {
  comparator: PlayerPerformanceComparator
  roundsCompared: number
  comparisonCards: number
  holes: PlayerHoleComparison[]
  relativeStrengths: PlayerHoleComparison[]
  largestGaps: PlayerHoleComparison[]
}

export interface PlayerHolePerformance {
  contractKey: string
  courseName: string
  teeName: string
  comparableRounds: number
  flight: PlayerHoleComparisonLens | null
  field: PlayerHoleComparisonLens | null
  preferredComparator: PlayerPerformanceComparator | null
}

export interface ResolvedPlayerPerformanceComparator {
  comparator: PlayerPerformanceComparator
  lens: PlayerHoleComparisonLens
  fellBackFromFlight: boolean
}

const occurrenceByWeek = new Map<number, (typeof IGC_MENS_2026_INTERBAY_CONTRACT.occurrences)[number]>(
  IGC_MENS_2026_INTERBAY_CONTRACT.occurrences.map((occurrence) => [occurrence.week, occurrence]),
)

export function isAuditedIgcMens2026InterbayOccurrence(event: HoleComparisonEventFact): boolean {
  const occurrence = occurrenceByWeek.get(event.week)
  return !!occurrence
    && event.ggEventId === IGC_MENS_2026_INTERBAY_CONTRACT.ggEventId
    && event.ggRoundId === occurrence.ggRoundId
    && event.eventDate === occurrence.date
    && event.format === 'individual'
    && event.status === 'finalized'
    && /^Points Season\s*-\s*Week\b/i.test(event.eventName)
}

function isComparableCompletedCard(card: GrossHoleCardFact): boolean {
  if (card.holesCompleted !== 9 || card.scorecardStatus?.toLowerCase() !== 'completed') return false
  const gross = card.grossScores.slice(0, 9)
  const toPar = card.toParGross.slice(0, 9)
  if (gross.length !== 9 || toPar.length !== 9) return false
  return gross.every((score, index) => {
    const delta = toPar[index]
    return typeof score === 'number'
      && Number.isFinite(score)
      && typeof delta === 'number'
      && Number.isFinite(delta)
      && score - delta === IGC_MENS_2026_INTERBAY_CONTRACT.pars[index]
  })
}

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length

function canonicalOfficialFlight(value: string | null): string | null {
  const match = value?.trim().match(/^flight\s*([123])$/i)
  return match ? `Flight ${match[1]}` : null
}

function cardKey(card: Pick<GrossHoleCardFact, 'week' | 'memberCardId' | 'playerName'>): string | null {
  return card.memberCardId ? `${card.week}\u0000${card.memberCardId}\u0000${card.playerName}` : null
}

function resolveOfficialFlights(results: OfficialFlightResultFact[]): Map<string, string> {
  const evidence = new Map<string, { gross: string[]; net: string[] }>()
  for (const result of results) {
    const key = cardKey(result)
    if (!key) continue
    const flight = canonicalOfficialFlight(result.flightName)
    if (!flight) continue
    const item = evidence.get(key) ?? { gross: [], net: [] }
    item[result.competition].push(flight)
    evidence.set(key, item)
  }

  const resolved = new Map<string, string>()
  for (const [key, item] of evidence) {
    const gross = [...new Set(item.gross)]
    const net = [...new Set(item.net)]
    if (gross.length === 1 && net.length === 1 && gross[0] === net[0]) resolved.set(key, gross[0])
  }
  return resolved
}

function deriveLens(input: {
  comparator: PlayerPerformanceComparator
  memberCardId: string
  eligibleWeeks: Set<number>
  cardsByWeek: Map<number, GrossHoleCardFact[]>
  officialFlights: Map<string, string>
}): PlayerHoleComparisonLens | null {
  const observations = Array.from({ length: 9 }, () => [] as Array<{
    playerScore: number
    comparatorAverage: number
    peerCount: number
  }>)

  for (const week of input.eligibleWeeks) {
    const weekCards = input.cardsByWeek.get(week) ?? []
    const targetCards = weekCards.filter((card) => card.memberCardId === input.memberCardId)
    // A shared identifier or duplicate target card is ambiguous within the
    // occurrence. Never choose a card by display name or row order.
    if (targetCards.length !== 1) continue
    const target = targetCards[0]
    const targetKey = cardKey(target)
    const targetFlight = targetKey ? input.officialFlights.get(targetKey) : null
    if (input.comparator === 'flight' && !targetFlight) continue

    const peers = weekCards.filter((card) => {
      if (card === target) return false
      if (input.comparator === 'field') return true
      const key = cardKey(card)
      return !!key && input.officialFlights.get(key) === targetFlight
    })
    if (peers.length === 0) continue

    for (let index = 0; index < 9; index += 1) {
      observations[index].push({
        playerScore: target.grossScores[index] as number,
        comparatorAverage: mean(peers.map((card) => card.grossScores[index] as number)),
        peerCount: peers.length,
      })
    }
  }

  const holes = observations.flatMap((holeObservations, index): PlayerHoleComparison[] => {
    if (holeObservations.length === 0) return []
    const playerAverage = mean(holeObservations.map((observation) => observation.playerScore))
    // Each target start contributes one benchmark observation, preventing a
    // large weekly cohort from silently outweighing a smaller one.
    const comparatorAverage = mean(holeObservations.map((observation) => observation.comparatorAverage))
    const differentials = holeObservations.map((observation) => observation.playerScore - observation.comparatorAverage)
    return [{
      hole: index + 1,
      par: IGC_MENS_2026_INTERBAY_CONTRACT.pars[index],
      yardage: IGC_MENS_2026_INTERBAY_CONTRACT.yardages[index],
      playerAverage,
      comparatorAverage,
      differentialPerPlay: mean(differentials),
      cumulativeDifferential: differentials.reduce((sum, value) => sum + value, 0),
      timesPlayed: holeObservations.length,
      comparisonCards: holeObservations.reduce((sum, observation) => sum + observation.peerCount, 0),
    }]
  })

  if (holes.length !== 9) return null
  return {
    comparator: input.comparator,
    roundsCompared: holes[0].timesPlayed,
    comparisonCards: holes[0].comparisonCards,
    holes,
    // "Relative strengths" is deliberately relative: these are the two best
    // differentials even when neither beats the selected comparator.
    relativeStrengths: [...holes]
      .sort((a, b) => a.differentialPerPlay - b.differentialPerPlay)
      .slice(0, 2),
    largestGaps: [...holes]
      .sort((a, b) => b.differentialPerPlay - a.differentialPerPlay)
      .slice(0, 2),
  }
}

export function deriveIgcMens2026HolePerformance(input: {
  memberCardId: string
  events: HoleComparisonEventFact[]
  cards: GrossHoleCardFact[]
  officialFlightResults?: OfficialFlightResultFact[]
}): PlayerHolePerformance | null {
  const eligibleWeeks = new Set(
    input.events.filter(isAuditedIgcMens2026InterbayOccurrence).map((event) => event.week),
  )
  const cardsByWeek = new Map<number, GrossHoleCardFact[]>()
  for (const card of input.cards) {
    if (!eligibleWeeks.has(card.week) || !isComparableCompletedCard(card)) continue
    const weekCards = cardsByWeek.get(card.week) ?? []
    weekCards.push(card)
    cardsByWeek.set(card.week, weekCards)
  }

  const officialFlights = resolveOfficialFlights(input.officialFlightResults ?? [])
  const field = deriveLens({ comparator: 'field', memberCardId: input.memberCardId, eligibleWeeks, cardsByWeek, officialFlights })
  const flight = deriveLens({ comparator: 'flight', memberCardId: input.memberCardId, eligibleWeeks, cardsByWeek, officialFlights })
  if (!field && !flight) return null
  return {
    contractKey: IGC_MENS_2026_INTERBAY_CONTRACT.key,
    courseName: IGC_MENS_2026_INTERBAY_CONTRACT.courseName,
    teeName: IGC_MENS_2026_INTERBAY_CONTRACT.teeName,
    comparableRounds: field?.roundsCompared ?? flight?.roundsCompared ?? 0,
    flight,
    field,
    preferredComparator: flight ? 'flight' : field ? 'field' : null,
  }
}

export function resolvePlayerPerformanceComparator(
  performance: PlayerHolePerformance,
  requested: PlayerPerformanceComparator | null,
): ResolvedPlayerPerformanceComparator | null {
  if (requested === 'field' && performance.field) {
    return { comparator: 'field', lens: performance.field, fellBackFromFlight: false }
  }
  if (requested === 'flight' && performance.flight) {
    return { comparator: 'flight', lens: performance.flight, fellBackFromFlight: false }
  }
  if (performance.flight) {
    return { comparator: 'flight', lens: performance.flight, fellBackFromFlight: false }
  }
  if (performance.field) {
    return { comparator: 'field', lens: performance.field, fellBackFromFlight: requested === 'flight' }
  }
  return null
}
