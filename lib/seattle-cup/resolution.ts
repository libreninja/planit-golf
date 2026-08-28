// Pure Seattle Cup OFFICIAL tournament-resolution calculation — the published
// tiebreak rules applied to the same normalized snapshots the race reads.
//
// race.ts answers "who is ahead / what does it take to win outright on
// points" and deliberately leaves a final points tie unresolved. This module
// answers "who officially wins the Cup". Published rules (authoritative):
//
//   Scoring: each match is worth 1 point; a halved match gives 0.5 to each
//   team. The team with the most points over all four days wins the Cup.
//
//   EXACTLY TWO teams tie for the most points:
//     1. The team with the most MATCH WINS in matches played between those two
//        teams wins. A halved match is a win for NEITHER team. No points,
//        holes won, margins, aggregates, or wins against other clubs count.
//     2. If those match-win totals are also tied, two designated players from
//        each team play a sudden-death fourball playoff.
//
//   MORE THAN TWO teams tie: the tied teams go DIRECTLY to the playoff (no
//   pairwise elimination).
//
// DERIVED here (never persisted): final standings, tied leaders, tie
// cardinality, head-to-head match wins, playoff-required. PERSISTED
// out-of-band only: the sudden-death fourball playoff result (see
// seattle_cup_tournament_results + lib/seattle-cup/playoff-store.ts) — the one
// fact the normalized match data cannot tell us. A rules-derived winner can
// never be overridden by a stored record.

import { ROUND_LIST, matchNoFor } from './config.ts'
import type {
  Match,
  SeattleCupPlayoffState,
  SeattleCupTournamentResolution,
  TeamStanding,
  TeamKey,
} from './types.ts'

// The slice of the normalized Match this module needs. SeattleCupRoundSnapshot
// is structurally compatible, so the API route passes real snapshots directly.
export type ResolutionMatch = Pick<
  Match,
  'matchNo' | 'round' | 'teamA' | 'teamB' | 'status' | 'pointsA' | 'pointsB'
>

export interface SeattleCupResolutionInput {
  matches: ResolutionMatch[]
  overallStandings: TeamStanding[]
  fetchedAt: number
}

// The persisted out-of-band playoff resolution (seattle_cup_tournament_results).
export interface SeattleCupPlayoffRecord {
  competitionKey: string
  seasonYear: number
  ggEventId: string
  winnerTeamKey: TeamKey
  tiedTeamKeys: TeamKey[]
  notes: string | null
  resolvedAt: string   // ISO timestamp
  resolvedBy: string | null
}

export type PlayoffResolutionVerdict =
  | { ok: true; winnerTeamKey: TeamKey; tiedTeamKeys: TeamKey[] }
  | { ok: false; error: string }

const EPSILON = 0.001

function validOpponents(
  match: Pick<ResolutionMatch, 'teamA' | 'teamB'>,
): match is ResolutionMatch & { teamA: TeamKey; teamB: TeamKey } {
  return match.teamA != null && match.teamB != null && match.teamA !== match.teamB
}

// Same standings-selection rule as the race: the snapshot with the largest
// total-point mass wins (they should agree; GG cumulative totals), latest
// fetch wins ties.
function resolveStandings(snapshots: SeattleCupResolutionInput[]): TeamStanding[] {
  return [...snapshots]
    .filter((snapshot) => snapshot.overallStandings.length > 0)
    .sort((a, b) => {
      const aTotal = a.overallStandings.reduce((sum, standing) => sum + standing.totalPoints, 0)
      const bTotal = b.overallStandings.reduce((sum, standing) => sum + standing.totalPoints, 0)
      return bTotal - aTotal || b.fetchedAt - a.fetchedAt
    })[0]?.overallStandings ?? []
}

// Tournament is final only when every schedule-stable matchNo exists, is
// final, and carries a real normalized opponent pair. A missing or malformed
// match (GG round not yet posted, shortfall TBD) keeps the competition
// officially active — resolution never runs on a partial graph.
function isTournamentFinal(combined: ResolutionMatch[]): boolean {
  const byMatchNo = new Map<number, ResolutionMatch>()
  for (const match of combined) byMatchNo.set(match.matchNo, match)
  return ROUND_LIST.every((round) =>
    round.matchSlots.every((_slot, index) => {
      const match = byMatchNo.get(matchNoFor(round.round, index))
      return match != null && match.status === 'final' && validOpponents(match)
    }),
  )
}

function leaderTeamKeys(standings: TeamStanding[]): TeamKey[] {
  const played = standings.filter((standing) => Number.isFinite(standing.totalPoints))
  if (played.length === 0) return []
  const lead = Math.max(...played.map((standing) => standing.totalPoints))
  return played
    .filter((standing) => Math.abs(standing.totalPoints - lead) < EPSILON)
    .map((standing) => standing.teamKey)
}

// Head-to-head MATCH WINS between the two tied teams, from the authoritative
// normalized competitive-match graph (all four rounds; R4 Singles are already
// 24 independent 1v1 matches). A halved match counts as a win for NEITHER.
// GG-awarded match points are the winner signal (final points are validated to
// sum to 1); a final match with missing points counts as a win for nobody.
function headToHeadWins(
  combined: ResolutionMatch[],
  a: TeamKey,
  b: TeamKey,
): Partial<Record<TeamKey, number>> {
  const wins: Partial<Record<TeamKey, number>> = { [a]: 0, [b]: 0 }
  for (const match of combined) {
    if (!validOpponents(match) || match.status !== 'final') continue
    const isPair = (match.teamA === a && match.teamB === b) || (match.teamA === b && match.teamB === a)
    if (!isPair) continue
    if (match.pointsA != null && match.pointsB != null) {
      if (match.pointsA > match.pointsB) wins[match.teamA]! += 1
      else if (match.pointsB > match.pointsA) wins[match.teamB]! += 1
      // Equal points (0.5-0.5 halve) → a win for neither.
    }
  }
  return wins
}

function playoffState(
  resolved: boolean,
  record: SeattleCupPlayoffRecord | null,
): SeattleCupPlayoffState {
  return {
    required: true,
    resolved,
    resolvedAt: resolved ? record?.resolvedAt ?? null : null,
    resolvedBy: resolved ? record?.resolvedBy ?? null : null,
    notes: resolved ? record?.notes ?? null : null,
  }
}

export function calculateSeattleCupTournamentResolution(
  snapshots: SeattleCupResolutionInput[],
  playoffRecord: SeattleCupPlayoffRecord | null,
): SeattleCupTournamentResolution {
  const combined = snapshots.flatMap((snapshot) => snapshot.matches)
  const standings = resolveStandings(snapshots)

  // Competition still active → no official winner, stored records are ignored
  // (they are only meaningful for a final tournament).
  if (!isTournamentFinal(combined)) {
    return {
      status: 'active',
      winnerTeamKey: null,
      tiedTeamKeys: [],
      method: null,
      playoff: null,
    }
  }

  const leaders = leaderTeamKeys(standings)
  const base = { winnerTeamKey: null as TeamKey | null, tiedTeamKeys: leaders, method: null as SeattleCupTournamentResolution['method'] }

  let resolution: SeattleCupTournamentResolution
  if (leaders.length === 1) {
    // Final, unique points leader — derived automatically, no tiebreak.
    resolution = { ...base, tiedTeamKeys: [], status: 'points-winner', winnerTeamKey: leaders[0]!, method: 'points', playoff: null }
  } else if (leaders.length === 2) {
    const [a, b] = leaders as [TeamKey, TeamKey]
    const wins = headToHeadWins(combined, a, b)
    if (wins[a] !== wins[b]) {
      const winner = wins[a]! > wins[b]! ? a : b
      resolution = { ...base, status: 'head-to-head-winner', winnerTeamKey: winner, method: 'head-to-head-wins', headToHeadWins: wins, playoff: null }
    } else {
      resolution = { ...base, status: 'playoff-required', headToHeadWins: wins, playoff: playoffState(false, null) }
    }
  } else {
    // 3-4 teams tied → directly to the playoff, never pairwise elimination.
    resolution = { ...base, status: 'playoff-required', playoff: playoffState(false, null) }
  }

  // A stored playoff record resolves a REQUIRED playoff only. It can never
  // override a rules-derived winner (points / head-to-head), and it is only
  // honored if the stored winner is still one of the tied teams.
  if (
    resolution.status === 'playoff-required'
    && playoffRecord
    && leaders.includes(playoffRecord.winnerTeamKey)
  ) {
    return {
      ...resolution,
      status: 'playoff-winner',
      winnerTeamKey: playoffRecord.winnerTeamKey,
      method: 'fourball-playoff',
      playoff: playoffState(true, playoffRecord),
    }
  }

  return resolution
}

// Write-time validation for the manual playoff result. The admin action
// recomputes the resolution WITHOUT any stored record and validates against
// it, so a stale/incorrect stored row can never legitimize a new write.
export function validatePlayoffResolution(
  resolution: SeattleCupTournamentResolution,
  winnerTeamKey: string,
): PlayoffResolutionVerdict {
  if (resolution.status === 'active') {
    return { ok: false, error: 'Tournament is not final yet — the playoff can only be recorded once all matches are final.' }
  }
  if (resolution.status !== 'playoff-required') {
    return { ok: false, error: `No tiebreak is required — the Cup winner is already determined (${resolution.status}).` }
  }
  const tiedTeamKeys = resolution.tiedTeamKeys
  if (!tiedTeamKeys.includes(winnerTeamKey as TeamKey)) {
    return { ok: false, error: `Winner must be one of the tied teams: ${tiedTeamKeys.join(', ')}.` }
  }
  return { ok: true, winnerTeamKey: winnerTeamKey as TeamKey, tiedTeamKeys }
}