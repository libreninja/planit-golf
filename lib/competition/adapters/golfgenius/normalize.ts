// Pure normalization of a GG tournament-results payload into generic domain
// types. No network, no Supabase. Reuses the pure parsing helpers extracted
// into the alias-free lib/igc/weekly-results-helpers.ts (buildHoles,
// positionOrder, positionLabelOf, playerKey) so this module loads under
// `node --test`, which has no tsconfig path-alias resolver. weekly-results.ts
// re-exports the same helpers for its own callers. Emits generic ResultEntry
// + Scorecard keyed by flight and by player key. Also reports upstream
// round/tournament status when GG exposes it, so the caller can derive
// ResultStatus.

import {
  buildHoles,
  positionOrder,
  positionLabelOf,
  playerKey,
} from '../../../igc/weekly-results-helpers.ts'
import type { ResultEntry, Scorecard, ScoringMode } from '../../types.ts'

export interface GGAggregate {
  name?: string
  position?: string | number | null
  points?: string | number | null
  purse?: string | null
  member_cards?: { member_card_id_str?: string }[]
  net_scores?: (number | null)[]
  gross_scores?: (number | null)[]
  to_par_net?: (number | null)[]
  to_par_gross?: (number | null)[]
  totals?: {
    net_scores?: { out?: number | null; in?: number | null; total?: number | null }
    gross_scores?: { out?: number | null; in?: number | null; total?: number | null }
    to_par_net?: { out?: number | null; in?: number | null; total?: number | null }
    to_par_gross?: { out?: number | null; in?: number | null; total?: number | null }
  }
  scorecard_statuses?: { status?: string }[]
}
export interface GGScope { name?: string; aggregates?: GGAggregate[] }
export interface GGResultsFixture {
  event?: {
    scopes?: GGScope[]
    // Upstream lifecycle status when GG exposes it on the round/tournament:
    status?: string   // e.g. 'completed' | 'in_progress' | 'not_started'
  }
}

function parseNum(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : parseFloat(String(value))
  return Number.isFinite(n) ? n : null
}
function totalOut(totals: GGAggregate['totals'], key: 'net_scores' | 'gross_scores' | 'to_par_net' | 'to_par_gross'): number | null {
  return totals?.[key]?.out ?? totals?.[key]?.total ?? null
}

export function normalizeTournament(
  results: GGResultsFixture,
  competition: ScoringMode,
): {
  competition: ScoringMode
  entriesByFlight: Map<string, ResultEntry[]>
  scorecards: Map<string, Scorecard>
  upstreamStatus: 'completed' | 'in_progress' | 'not_started' | 'unknown'
} {
  const scopes = results?.event?.scopes ?? []
  const entriesByFlight = new Map<string, ResultEntry[]>()
  const scorecards = new Map<string, Scorecard>()

  for (const scope of scopes) {
    const flightName = scope.name?.trim() || 'Overall'
    for (const a of scope.aggregates ?? []) {
      if (!a.name) continue
      const memberCardId = a.member_cards?.[0]?.member_card_id_str ?? null
      const key = playerKey(memberCardId, a.name)
      const holes = buildHoles(a.gross_scores ?? null, a.net_scores ?? null, a.to_par_net ?? null, a.to_par_gross ?? null)
      const holesCompleted = holes.filter((h) => h.gross !== null || h.net !== null).length
      const totalHoles = holes.length || 18

      if (!scorecards.has(key)) {
        scorecards.set(key, {
          key,
          memberCardId,
          name: a.name,
          netTotal: totalOut(a.totals, 'net_scores'),
          grossTotal: totalOut(a.totals, 'gross_scores'),
          toParNet: totalOut(a.totals, 'to_par_net'),
          toParGross: totalOut(a.totals, 'to_par_gross'),
          holesCompleted,
          scorecardStatus: a.scorecard_statuses?.[0]?.status ?? null,
          isLive: holesCompleted > 0 && holesCompleted < totalHoles,
          holes,
        })
      }

      const entry: ResultEntry = {
        key,
        name: a.name,
        positionLabel: positionLabelOf(a.position),
        positionOrder: positionOrder(a.position),
        points: parseNum(a.points),
        purse: a.purse ?? null,
        flight: flightName,
      }
      if (!entriesByFlight.has(flightName)) entriesByFlight.set(flightName, [])
      entriesByFlight.get(flightName)!.push(entry)
    }
  }

  const rawStatus = results?.event?.status?.toLowerCase() ?? ''
  let upstreamStatus: 'completed' | 'in_progress' | 'not_started' | 'unknown' = 'unknown'
  if (rawStatus === 'completed' || rawStatus === 'final') upstreamStatus = 'completed'
  else if (rawStatus === 'in_progress' || rawStatus === 'live') upstreamStatus = 'in_progress'
  else if (rawStatus === 'not_started' || rawStatus === 'upcoming') upstreamStatus = 'not_started'

  return { competition, entriesByFlight, scorecards, upstreamStatus }
}
