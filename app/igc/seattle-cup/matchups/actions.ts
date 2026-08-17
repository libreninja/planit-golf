'use server'

// Server actions for the Seattle Cup Matchup Room. Each resolves the
// authenticated captain (the actor for attribution + the x-planit-actor header),
// calls the planit-ai matchup draft HTTP API, and revalidates the matchups
// route so the board reads fresh after a write. The captain identity is passed
// server-to-server only; it is never exposed to the browser.
//
// Activity inbox recording is intentionally NOT wired here in the V1 Monday MVP
// (it would require a new ActivityType + inbox copy helpers). The draft state is
// authoritative in planit-ai; the client owns optimistic UI and rollback on error.

import { revalidatePath } from 'next/cache'
import { requireScoutingAccess } from '@/lib/scouting-access'
import * as ai from '@/lib/planit-ai/client'

const PATH = '/igc/seattle-cup/matchups'

async function actorEmail(): Promise<string> {
  const user = await requireScoutingAccess()
  return user.email ?? user.id
}

/** Upsert one matchup slot; returns it with the live engine consequence. */
export async function saveMatchupCall(input: ai.MatchupDraftInput): Promise<ai.SavedMatchup> {
  const actor = await actorEmail()
  const saved = await ai.saveMatchup(input, actor)
  revalidatePath(PATH)
  return saved
}

/** Preview a candidate matchup's handicap consequence WITHOUT persisting. Read
 *  only, but still gated to scouting access so the endpoint isn't public. */
export async function previewMatchupCall(
  team: string,
  round: number,
  ourPlayerIds: string[],
  opponentPlayerIds: string[] | null,
): Promise<ai.MatchHandicapResult | null> {
  await requireScoutingAccess()
  const res = await ai.previewMatchup(team, round, ourPlayerIds, opponentPlayerIds)
  return res.consequence
}

/** Read the stored round lineup for a (team, round). Used client-side to fetch
 *  the opponent's lineup for the what-if counter (so opponent picks are
 *  constrained to their selected 12, not their full roster). Read-only. */
export async function getRoundLineupCall(team: string, round: number): Promise<ai.RoundLineup> {
  await requireScoutingAccess()
  return ai.getRoundLineup(team, round)
}

/** Exhaustive RESPOND analysis: every legal pair from our remaining lineup vs
 *  the opponent's exposed pair, with exact signed consequences, ordered
 *  most-favorable-first. Deterministic; no synthetic score. Read-only. */
export async function respondAnalysisCall(
  team: string,
  round: number,
  opponentTeam: string,
  theirExposedPlayerIds: string[],
): Promise<ai.RespondAnalysis> {
  await requireScoutingAccess()
  return ai.getRespondAnalysis(team, round, opponentTeam, theirExposedPlayerIds)
}

/** Exhaustive PUT-UP analysis: for every legal pair from our remaining lineup,
 *  every legal opponent counter from their remaining lineup, with the full
 *  counter matrix preserved and exploitability summaries. Ordered by maximin
 *  (worst-case robustness). Deterministic; no synthetic score. Read-only. */
export async function putUpAnalysisCall(
  team: string,
  round: number,
  opponentTeam: string,
): Promise<ai.PutUpAnalysis> {
  await requireScoutingAccess()
  return ai.getPutUpAnalysis(team, round, opponentTeam)
}

/** Lock every draft slot for a (team, round): draft -> final. */
export async function lockRoundCall(team: string, round: number): Promise<number> {
  const actor = await actorEmail()
  const res = await ai.lockRound(team, round, actor)
  revalidatePath(PATH)
  return res.locked
}

/** Clear (undo) one slot from the draft. */
export async function clearMatchupCall(team: string, round: number, position: number): Promise<void> {
  const actor = await actorEmail()
  await ai.clearMatchup(team, round, position, actor)
  revalidatePath(PATH)
}

// ---- Round lineup (selecting the 12 amateurs a club fields for a paired round) ----

/** Replace the round lineup for (team, round) with `playerIds`. The backend
 *  enforces the eligibility rule (head pros Singles-only) + team membership.
 *  A provisional (<12) lineup is allowed for planning; the matchup draft
 *  requires a complete (12) lineup. */
export async function setRoundLineupCall(
  team: string,
  round: number,
  playerIds: string[],
): Promise<ai.RoundLineup> {
  const actor = await actorEmail()
  const saved = await ai.setRoundLineup(team, round, playerIds, actor)
  revalidatePath(PATH)
  return saved
}

/** Clear the stored round lineup for (team, round). */
export async function clearRoundLineupCall(team: string, round: number): Promise<void> {
  const actor = await actorEmail()
  await ai.clearRoundLineup(team, round, actor)
  revalidatePath(PATH)
}