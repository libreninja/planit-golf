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
  type HoleScore,
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
    // GG's authoritative cumulative season-points array, computed at scoring
    // time. IGC league rounds never populate event.status, so a non-empty
    // season_points is the reliable "this round is scored/finalized" signal:
    // scored rounds return ~70-150 entries; future/unscored rounds return [].
    season_points?: unknown[] | null
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

// Live-play fallback. GG populates `a.totals` (out/in/total) only at
// finalization — a card in progress has null summary totals even though
// per-hole scores are present in `holes`. Derive the running totals from
// the scored holes so the live leaderboard shows actual Gross/Net and To
// Par mid-round. Finalized `a.totals` always takes precedence: callers
// use `totalOut(...) ?? derivedFromHoles(...)`, so a real finalized total
// is never overwritten. Unplayed holes (null) never contribute, and a
// card with zero scored holes yields null (not a fake 0 / E).
function sumScored(holes: HoleScore[], pick: (h: HoleScore) => number | null): number | null {
  let sum = 0
  let any = false
  for (const h of holes) {
    const v = pick(h)
    if (v !== null) {
      sum += v
      any = true
    }
  }
  return any ? sum : null
}
// `cumulativeToPar` on HoleScore is the running NET to-par through each
// hole (advanced only when the net delta is present). The latest non-null
// value is therefore the live net to-par. There is no stored cumulative
// gross field, so the gross fallback sums the per-hole gross deltas
// (== cumulative gross to-par) — see usage below.
function latestCumulativeToPar(holes: HoleScore[]): number | null {
  let latest: number | null = null
  for (const h of holes) {
    if (h.cumulativeToPar !== null) latest = h.cumulativeToPar
  }
  return latest
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
  // GG's per-card lifecycle status (scorecard_statuses[].status), collected
  // across every scored aggregate. Used as the completed-signal fallback for
  // leagues that never populate event.season_points (e.g. Women's League, which
  // has no points category in GG): a finalized round marks every turned-in card
  // 'completed', so "has scored cards, ≥1 completed, none live" is the same
  // "round is scored" conclusion season_points draws for points-tracking
  // leagues. See the upstreamStatus fallback below.
  const cardStatuses: string[] = []

  for (const scope of scopes) {
    const flightName = scope.name?.trim() || 'Overall'
    for (const a of scope.aggregates ?? []) {
      if (!a.name) continue
      const memberCardId = a.member_cards?.[0]?.member_card_id_str ?? null
      const key = playerKey(memberCardId, a.name)
      const holes = buildHoles(a.gross_scores ?? null, a.net_scores ?? null, a.to_par_net ?? null, a.to_par_gross ?? null)
      const holesCompleted = holes.filter((h) => h.gross !== null || h.net !== null).length
      const totalHoles = holes.length || 18
      const cardStatus = a.scorecard_statuses?.[0]?.status ?? null
      if (cardStatus) cardStatuses.push(cardStatus.toLowerCase())

      if (!scorecards.has(key)) {
        scorecards.set(key, {
          key,
          memberCardId,
          name: a.name,
          netTotal: totalOut(a.totals, 'net_scores') ?? sumScored(holes, (h) => h.net),
          grossTotal: totalOut(a.totals, 'gross_scores') ?? sumScored(holes, (h) => h.gross),
          toParNet: totalOut(a.totals, 'to_par_net') ?? latestCumulativeToPar(holes),
          toParGross: totalOut(a.totals, 'to_par_gross') ?? sumScored(holes, (h) => h.toParGross),
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
  // GG league rounds never expose event.status (it is null on the .json
  // endpoint). The authoritative completion signal for points-tracking leagues
  // is a NON-EMPTY event.season_points array — GG computes the cumulative
  // standings at scoring time, so its presence means the round is
  // scored/finalized. A future or in-progress round returns season_points: []
  // (or no scopes). This unblocks reconcile's `upstreamStatus === 'completed'`
  // import gate and the per-round season-points capture in import.ts.
  else if (Array.isArray(results?.event?.season_points) && (results!.event!.season_points!.length > 0)) {
    upstreamStatus = 'completed'
  }
  // Fallback for leagues that never populate event.season_points because GG has
  // no points category configured for them (Women's League: views is weekly-only,
  // no Season tab, no points). GG still marks every turned-in scorecard
  // `scorecard_statuses[].status = 'completed'` at finalization. A round is
  // finalized when it has scored cards, at least one is 'completed', and NONE is
  // still in progress/live — a not-yet-posted round has no cards, a live round
  // has partial cards, so neither misclassifies. This is the SAME conclusion
  // season_points draws; men's rounds keep the season_points branch above (it
  // fires first), so this fallback only changes leagues without season_points.
  else if (
    cardStatuses.length > 0 &&
    cardStatuses.includes('completed') &&
    !cardStatuses.some((s) => s === 'in_progress' || s === 'live' || s === 'started')
  ) {
    upstreamStatus = 'completed'
  }

  return { competition, entriesByFlight, scorecards, upstreamStatus }
}
