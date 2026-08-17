// Evidence helpers for the Seattle Cup Matchup Room.
//
// The guardrail: evidence is CONTEXT, not fake prediction. We surface real
// Men's League + Seattle Cup history that already exists in the scouting
// backend, ALWAYS show the sample size, and rate evidence strength from the
// sample size alone (LIMITED / MODERATE / STRONG). We never invent win
// probabilities or fabricate history. A player with no linked league record
// shows "no linked history" — that is an honest gap, not a zero.
//
// Pure + I/O-free so the strength + shaping logic is trivially auditable.

import type { ScoutingBoardRow } from '@/lib/planit-ai/client'

export type EvidenceStrength = 'LIMITED' | 'MODERATE' | 'STRONG'

export interface PlayerEvidence {
  /** True when the roster player resolved to a planit-ai player that appears on
   *  the scouting board (i.e. we have real linked history). False → every other
   *  field is null and the UI shows "no linked history". */
  linked: boolean
  events: number | null
  wins: number | null
  topTen: number | null
  points: number | null
  rank: number | null
  pointsBehindLeader: number | null
  /** wins / events, rounded to 3 dp. Null when events is null or zero. */
  winRate: number | null
  seattleCupCount: number | null
  seattleCupYears: string[] | null
  /** Sample-size-driven strength. Null when not linked. */
  strength: EvidenceStrength | null
}

export const NO_EVIDENCE: PlayerEvidence = {
  linked: false,
  events: null,
  wins: null,
  topTen: null,
  points: null,
  rank: null,
  pointsBehindLeader: null,
  winRate: null,
  seattleCupCount: null,
  seattleCupYears: null,
  strength: null,
}

/** Rate evidence strength from the number of league events on record. This is a
 *  sample-size signal only — it says how much history we have, not how good the
 *  player is. <5 LIMITED, 5–14 MODERATE, ≥15 STRONG. */
export function evidenceStrength(events: number | null): EvidenceStrength | null {
  if (events == null || !Number.isFinite(events)) return null
  if (events < 5) return 'LIMITED'
  if (events < 15) return 'MODERATE'
  return 'STRONG'
}

function winRate(wins: number | null, events: number | null): number | null {
  if (wins == null || events == null || events === 0) return null
  return Math.round((wins / events) * 1000) / 1000
}

/** Build an evidence lookup keyed by planit-ai playerId, from the scouting
 *  board rows. Roster players join via their resolvedPlayerId. Returns a plain
 *  record so it can be serialized across the Server→Client component boundary. */
export function buildEvidenceMap(board: ScoutingBoardRow[]): Record<string, PlayerEvidence> {
  const m: Record<string, PlayerEvidence> = {}
  for (const r of board) {
    const events = r.numberOfEvents ?? null
    m[r.playerId] = {
      linked: true,
      events,
      wins: r.numberOfWins ?? null,
      topTen: r.topTenFinishes ?? null,
      points: r.totalPoints ?? null,
      rank: r.currentRank ?? null,
      pointsBehindLeader: r.pointsBehindLeader ?? null,
      winRate: winRate(r.numberOfWins ?? null, events),
      seattleCupCount: r.seattleCupCount ?? null,
      seattleCupYears: r.seattleCupYears ?? null,
      strength: evidenceStrength(events),
    }
  }
  return m
}

/** Look up evidence for a roster player by its resolved planit-ai playerId.
 *  Returns NO_EVIDENCE (linked=false) when there is no link or no board row. */
export function evidenceFor(
  evidence: Record<string, PlayerEvidence>,
  resolvedPlayerId: string | null,
): PlayerEvidence {
  if (!resolvedPlayerId) return NO_EVIDENCE
  return evidence[resolvedPlayerId] ?? NO_EVIDENCE
}