// Server-side reader that builds a multi-occurrence championship aggregate
// (the Club Championship: Monday Round 1 + Tuesday Round 2). It reuses the
// per-occurrence live/durable read (getLiveResults) for each configured round,
// then sums them with the pure aggregateLeaderboard arithmetic. The aggregate
// updates as Tuesday's live scores arrive: Monday (final or live) + Tuesday
// (live) → live aggregate; once both are final → final aggregate. Aggregate
// inputs identify occurrences by their configured championship identity
// (championshipKey), NOT user-visible week labels — week_number 101/102 are
// storage ids and never reach the UI.
//
// The per-occurrence reader is injected so this is unit-testable without the
// Supabase/GG import graph; production passes the real getLiveResults (dynamic
// import below so the static graph stays clean for node --test).
//
// Relative imports (no @/ alias) so node --test can load this module directly.

import { aggregateLeaderboard, type OccurrenceLeaderboard } from './aggregate.ts'
import { getCompetitionConfig } from './registry.ts'
import type { Leaderboard, LiveResponse, ScoringMode, EventFormat, DiscoveryState, ResultStatus } from './types.ts'
import { unavailableFlightMembership } from './projected-flights.ts'

export interface ReadOccurrenceFn {
  (input: { competitionKey: string; occurrenceId: string; scoring: ScoringMode; nowIso: string }): Promise<LiveResponse | null>
}

export interface ChampionshipAggregateDeps {
  readOccurrence?: ReadOccurrenceFn
}

export interface ChampionshipAggregate extends LiveResponse {
  championshipKey: string
  roundCount: number
  // How many constituent rounds have posted golf and reached 'final', and how
  // many are currently 'live'. Lets the UI show "Round 1 of 2 complete" and a
  // live indicator per round without re-deriving from the summed leaderboard.
  roundsComplete: number
  roundsLive: number
}

// Gather the configured rounds for one championship (e.g. 'club-championship'),
// ordered by championshipRound. Returns [] when the competition has no such
// championship configured.
export function championshipRounds(competitionKey: string, championshipKey: string) {
  const config = getCompetitionConfig(competitionKey)
  const specs = (config?.adapterConfig.specialOccurrences ?? [])
    .filter((s) => s.championshipKey === championshipKey)
    .sort((a, b) => (a.championshipRound ?? 0) - (b.championshipRound ?? 0))
  return { config, specs }
}

// Derive the championship's display label from its configured round labels —
// e.g. "Club Championship - Round 1" → "Club Championship". Falls back to the
// competition label, then the championship key. Never uses a week number.
function championshipLabel(specs: { label: string }[], fallback: string): string {
  for (const s of specs) {
    const stripped = s.label.replace(/\s*-\s*Round\s*\d+.*$/i, '').trim()
    if (stripped) return stripped
  }
  return fallback
}

// Build the aggregate leaderboard for a championship by reading each round's
// current leaderboard (durable-then-live via getLiveResults) and summing. A
// round with no posted scores yet contributes nothing; the aggregate is live
// while ANY constituent round is live, final when all are final, and
// not_started when no round has scores yet. The aggregate card carries no
// per-hole array (holes: []) — the championship is two 9-hole rounds, never
// one 18-hole card (see aggregate.ts invariant).
export async function getChampionshipAggregate(
  competitionKey: string,
  championshipKey: string,
  scoring: ScoringMode,
  nowIso: string,
  deps?: ChampionshipAggregateDeps,
): Promise<ChampionshipAggregate> {
  const { config, specs } = championshipRounds(competitionKey, championshipKey)
  const readOccurrence = deps?.readOccurrence ?? (async (input) => {
    const { getLiveResults } = await import('./live.ts')
    return getLiveResults(input)
  })

  const label = championshipLabel(specs, config?.label ?? championshipKey)
  const occurrence: LiveResponse['occurrence'] = {
    id: championshipKey,
    number: null,
    label,
    date: null,
    activeWindow: { start: '', end: null },
    format: 'individual',
    discoveryState: 'discovered',
    resultStatus: 'unknown',
  }

  if (specs.length === 0) {
    return {
      championshipKey, roundCount: 0, roundsComplete: 0, roundsLive: 0,
      occurrence, leaderboard: null, flightMembership: unavailableFlightMembership(), resultStatus: 'unknown',
      eventFormat: 'unknown', discoveryState: 'pending',
      durableCurrent: false, showingLastKnown: false,
    }
  }

  const constituents: OccurrenceLeaderboard[] = []
  let anyLive = false
  let anyData = false
  let allFinal = true
  let roundsComplete = 0
  let roundsLive = 0
  let eventFormat: EventFormat = 'individual'
  let discoveryState: DiscoveryState = 'discovered'

  for (const spec of specs) {
    const r = await readOccurrence({
      competitionKey, occurrenceId: String(spec.weekNumber), scoring, nowIso,
    })
    if (!r) continue
    if (r.eventFormat && r.eventFormat !== 'unknown') eventFormat = r.eventFormat
    if (r.discoveryState === 'pending' || r.discoveryState === 'inconclusive') discoveryState = r.discoveryState
    if (!r.leaderboard || r.leaderboard.scorecards.length === 0) {
      // No posted golf for this round yet. If it's still live/in-window it may
      // still contribute later; for now it adds nothing to the aggregate. A
      // round that hasn't teed off shouldn't make the aggregate read "final".
      if (r.resultStatus !== 'final') allFinal = false
      continue
    }
    anyData = true
    constituents.push({
      occurrenceId: String(spec.weekNumber),
      scorecards: r.leaderboard.scorecards,
      entries: r.leaderboard.entries,
    })
    if (r.resultStatus === 'live') { anyLive = true; allFinal = false; roundsLive++ }
    else if (r.resultStatus === 'final') { roundsComplete++ }
    else allFinal = false
  }

  if (!anyData) {
    return {
      championshipKey, roundCount: specs.length, roundsComplete: 0, roundsLive: 0,
      occurrence, leaderboard: null, flightMembership: unavailableFlightMembership(), resultStatus: 'not_started',
      eventFormat, discoveryState, durableCurrent: false, showingLastKnown: false,
    }
  }

  const agg = aggregateLeaderboard(constituents, scoring)
  const resultStatus: ResultStatus = anyLive ? 'live' : allFinal ? 'final' : 'live'
  const leaderboard: Leaderboard = {
    occurrenceId: championshipKey,
    scoringMode: scoring,
    grouping: null,
    entries: agg.entries,
    scorecards: agg.scorecards,
    resultStatus,
    durableCurrent: !anyLive && allFinal,
  }
  return {
    championshipKey, roundCount: specs.length, roundsComplete, roundsLive,
    occurrence: { ...occurrence, resultStatus },
    leaderboard, flightMembership: unavailableFlightMembership(), resultStatus, eventFormat, discoveryState,
    durableCurrent: !anyLive && allFinal, showingLastKnown: false,
  }
}
