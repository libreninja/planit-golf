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
  selectedRoundComparison: {
    grossVsSeasonAverage: number | null
    isSeasonLow: boolean
  }
  rounds: PlayerRound[]
  completedComparableRounds: PlayerRound[]
  season: PlayerSeasonFact & { starts: number }
  form: {
    recentGross: Array<{ week: number; eventDate: string | null; gross: number }>
    recentAverageGross: number | null
    recentVsSeasonAverage: number | null
    seasonAverageGross: number | null
    seasonLowGross: number | null
    seasonLowRound: { week: number; eventDate: string | null; gross: number } | null
  }
}

function stateOf(performance: PlayerPerformanceFact | undefined, event: PlayerEventFact): PlayerRound['state'] {
  if (performance?.state) return performance.state
  if (event.format === 'team') return 'participation'
  const status = performance?.scorecardStatus?.toLowerCase() ?? ''
  if (status === 'in_progress' || status === 'live' || status === 'started') return 'live'
  if (status === 'completed' && performance?.holesCompleted === 9) return 'final'
  return performance && performance.holesCompleted > 0 ? 'incomplete' : 'participation'
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
  const roundToTenth = (value: number) => Math.round(value * 10) / 10
  const seasonAverageGross = grossTotals.length
    ? roundToTenth(grossTotals.reduce((sum, gross) => sum + gross, 0) / grossTotals.length)
    : null
  const seasonLowGross = grossTotals.length ? Math.min(...grossTotals) : null
  const seasonLowRound = seasonLowGross === null
    ? null
    : completedComparableRounds.find((round) => round.grossTotal === seasonLowGross) ?? null
  const recentGrossRounds = completedComparableRounds.slice(0, 5)
  const recentAverageGross = recentGrossRounds.length
    ? roundToTenth(recentGrossRounds.reduce((sum, round) => sum + round.grossTotal!, 0) / recentGrossRounds.length)
    : null
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

  const requestedRound = input.selectedWeek == null
    ? null
    : rounds.find((round) => round.week === input.selectedWeek) ?? null
  const selectedRound = input.selectedWeek == null ? (rounds[0] ?? null) : requestedRound
  const selectedComparableGross = selectedRound?.isCompletedComparableNine ? selectedRound.grossTotal : null

  return {
    // An explicit source week never silently falls through to a newer round.
    // If that selected occurrence has no player evidence, render an honest
    // empty selected-result state while retaining the rest of the record.
    selectedRound,
    selectedRoundComparison: {
      grossVsSeasonAverage: selectedComparableGross !== null && seasonAverageGross !== null
        ? roundToTenth(selectedComparableGross - seasonAverageGross)
        : null,
      isSeasonLow: selectedComparableGross !== null
        && seasonLowGross !== null
        && selectedComparableGross === seasonLowGross,
    },
    rounds,
    completedComparableRounds,
    season: {
      rank: input.season?.rank ?? null,
      points: input.season?.points ?? null,
      starts,
    },
    form: {
      recentGross: recentGrossRounds.map((round) => ({
        week: round.week,
        eventDate: round.eventDate,
        gross: round.grossTotal!,
      })),
      recentAverageGross,
      recentVsSeasonAverage: recentAverageGross !== null && seasonAverageGross !== null
        ? roundToTenth(recentAverageGross - seasonAverageGross)
        : null,
      seasonAverageGross,
      seasonLowGross,
      seasonLowRound: seasonLowRound ? {
        week: seasonLowRound.week,
        eventDate: seasonLowRound.eventDate,
        gross: seasonLowRound.grossTotal!,
      } : null,
    },
  }
}
