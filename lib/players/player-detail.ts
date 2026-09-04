export interface PlayerEventFact {
  week: number
  eventName: string
  eventDate: string | null
  format: 'individual' | 'team' | 'unknown'
}

export interface PlayerPerformanceFact {
  week: number
  playerName: string
  grossScores: (number | null)[]
  netScores: (number | null)[]
  toParGross: (number | null)[]
  toParNet: (number | null)[]
  grossTotal: number | null
  netTotal: number | null
  toParGrossTotal: number | null
  toParNetTotal: number | null
  holesCompleted: number
  scorecardStatus: string | null
  state?: 'final' | 'live' | 'incomplete' | 'participation'
}

export interface PlayerResultFact {
  week: number
  competition: 'gross' | 'net'
  positionLabel: string | null
  flightName: string | null
  points: number | null
}

export interface PlayerSeasonFact {
  rank: number | null
  points: number | null
  gapToLeader: number | null
}

export interface ScoringDistribution {
  birdieOrBetter: number
  par: number
  bogey: number
  doubleOrWorse: number
  totalHoles: number
}

export interface PlayerRound {
  week: number
  eventName: string
  eventDate: string | null
  format: PlayerEventFact['format']
  state: 'final' | 'live' | 'incomplete' | 'participation'
  grossTotal: number | null
  netTotal: number | null
  toParGrossTotal: number | null
  toParNetTotal: number | null
  holesCompleted: number
  grossScores: (number | null)[]
  netScores: (number | null)[]
  toParGross: (number | null)[]
  toParNet: (number | null)[]
  grossResult: PlayerResultFact | null
  netResult: PlayerResultFact | null
  flight: string | null
  isCompletedComparableNine: boolean
}

export interface PlayerDetailModel {
  selectedRound: PlayerRound | null
  rounds: PlayerRound[]
  completedComparableRounds: PlayerRound[]
  season: PlayerSeasonFact & { starts: number }
  form: {
    recentGross: Array<{ week: number; eventDate: string | null; gross: number }>
    seasonAverageGross: number | null
    seasonLowGross: number | null
  }
  scoringDistribution: ScoringDistribution | null
}

function stateOf(performance: PlayerPerformanceFact | undefined, event: PlayerEventFact): PlayerRound['state'] {
  if (performance?.state) return performance.state
  if (event.format === 'team') return 'participation'
  const status = performance?.scorecardStatus?.toLowerCase() ?? ''
  if (status === 'in_progress' || status === 'live' || status === 'started') return 'live'
  if (status === 'completed' && performance?.holesCompleted === 9) return 'final'
  return performance && performance.holesCompleted > 0 ? 'incomplete' : 'participation'
}

function completeGrossHoleFacts(performance: PlayerPerformanceFact): boolean {
  const gross = performance.grossScores.slice(0, 9)
  const toPar = performance.toParGross.slice(0, 9)
  return gross.length === 9
    && toPar.length === 9
    && gross.every((score) => score !== null)
    && toPar.every((delta) => delta !== null)
}

export function isCompletedComparableNine(performance: PlayerPerformanceFact, event: PlayerEventFact): boolean {
  return event.format === 'individual'
    && stateOf(performance, event) === 'final'
    && performance.holesCompleted === 9
    && performance.grossTotal !== null
    && performance.grossScores.slice(0, 9).filter((score) => score !== null).length === 9
}

export function derivePlayerDetail(input: {
  events: PlayerEventFact[]
  performances: PlayerPerformanceFact[]
  results: PlayerResultFact[]
  season: PlayerSeasonFact | null
  selectedWeek?: number | null
}): PlayerDetailModel {
  const eventByWeek = new Map(input.events.map((event) => [event.week, event]))
  const resultByWeekCompetition = new Map(
    input.results.map((result) => [`${result.week}:${result.competition}`, result]),
  )

  const rounds = input.performances.flatMap((performance): PlayerRound[] => {
    const event = eventByWeek.get(performance.week)
    if (!event) return []
    const grossResult = resultByWeekCompetition.get(`${performance.week}:gross`) ?? null
    const netResult = resultByWeekCompetition.get(`${performance.week}:net`) ?? null
    return [{
      week: performance.week,
      eventName: event.eventName,
      eventDate: event.eventDate,
      format: event.format,
      state: stateOf(performance, event),
      grossTotal: performance.grossTotal,
      netTotal: performance.netTotal,
      toParGrossTotal: performance.toParGrossTotal,
      toParNetTotal: performance.toParNetTotal,
      holesCompleted: performance.holesCompleted,
      grossScores: performance.grossScores,
      netScores: performance.netScores,
      toParGross: performance.toParGross,
      toParNet: performance.toParNet,
      grossResult,
      netResult,
      flight: grossResult?.flightName ?? netResult?.flightName ?? null,
      isCompletedComparableNine: isCompletedComparableNine(performance, event),
    }]
  }).sort((a, b) => {
    if (a.eventDate && b.eventDate) return b.eventDate.localeCompare(a.eventDate)
    return b.week - a.week
  })

  const completedComparableRounds = rounds.filter((round) => round.isCompletedComparableNine)
  const grossTotals = completedComparableRounds
    .map((round) => round.grossTotal)
    .filter((gross): gross is number => gross !== null)
  const starts = new Set(
    input.performances
      .filter((performance) => {
        const event = eventByWeek.get(performance.week)
        return performance.holesCompleted > 0
          || performance.state === 'participation'
          || event?.format === 'team'
      })
      .map((performance) => performance.week),
  ).size

  const scoringDistribution: ScoringDistribution = {
    birdieOrBetter: 0,
    par: 0,
    bogey: 0,
    doubleOrWorse: 0,
    totalHoles: 0,
  }
  for (const round of completedComparableRounds) {
    const performance = input.performances.find((item) => item.week === round.week)
    if (!performance || !completeGrossHoleFacts(performance)) continue
    for (let hole = 0; hole < 9; hole += 1) {
      const gross = performance.grossScores[hole]
      const delta = performance.toParGross[hole]
      // Both persisted gross and gross-to-par must exist. This lets us derive
      // the exact par (gross - delta) and avoids the legacy net birdie fields.
      if (gross === null || delta === null) continue
      const par = gross - delta
      if (![3, 4, 5].includes(par)) continue
      scoringDistribution.totalHoles += 1
      if (delta <= -1) scoringDistribution.birdieOrBetter += 1
      else if (delta === 0) scoringDistribution.par += 1
      else if (delta === 1) scoringDistribution.bogey += 1
      else scoringDistribution.doubleOrWorse += 1
    }
  }

  const requestedRound = input.selectedWeek == null
    ? null
    : rounds.find((round) => round.week === input.selectedWeek) ?? null

  return {
    // An explicit source week never silently falls through to a newer round.
    // If that selected occurrence has no player evidence, render an honest
    // empty selected-result state while retaining the rest of the record.
    selectedRound: input.selectedWeek == null ? (rounds[0] ?? null) : requestedRound,
    rounds,
    completedComparableRounds,
    season: {
      rank: input.season?.rank ?? null,
      points: input.season?.points ?? null,
      gapToLeader: input.season?.gapToLeader ?? null,
      starts,
    },
    form: {
      recentGross: completedComparableRounds.slice(0, 5).map((round) => ({
        week: round.week,
        eventDate: round.eventDate,
        gross: round.grossTotal!,
      })),
      seasonAverageGross: grossTotals.length
        ? Math.round((grossTotals.reduce((sum, gross) => sum + gross, 0) / grossTotals.length) * 10) / 10
        : null,
      seasonLowGross: grossTotals.length ? Math.min(...grossTotals) : null,
    },
    scoringDistribution: scoringDistribution.totalHoles > 0 ? scoringDistribution : null,
  }
}
