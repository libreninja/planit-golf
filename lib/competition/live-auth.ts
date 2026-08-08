// Authorization for the competition live-result API routes
// (/api/competition/live, /api/competition/championship, and the legacy
// /api/igc/league/live). Routes call authorizeLiveRead and gate on its
// decision instead of a blanket "is the viewer logged in".
//
// The product model: IGC league leaderboards are PUBLIC. The goal is that
// golfers share the Planit live leaderboard link instead of the Golf Genius
// link, and a large share of recipients have no Planit account. So a
// 'public' competition is readable anonymously at the live API boundary —
// anonymous viewers get the SAME live score updates as authenticated ones.
// 'private' competitions (a future capability, e.g. a members-only event)
// still require an authenticated viewer.
//
// This is NOT a removal of auth. It is explicit, per-competition, visibility-
// based authorization: public → allow anon; private → require auth; unknown
// competition → 404. The decision is pure (visibility + isAuthed in → decision
// out) so it is unit-testable without a server. The route resolves the
// competition's visibility from the registry and passes it in.
//
// No service-role credential or private data is exposed client-side by this:
// getLiveResults runs entirely server-side (GG calls + cache use server-only
// keys/env), and the response body is the public LiveResponse shape (player
// names + scores) — the same data the standings PAGE already renders for
// anonymous viewers. Anonymous reads of igc_league_events are permitted by the
// table's `USING (true)` SELECT RLS policy.

import { getCompetitionConfig } from './registry.ts'
import type { CompetitionVisibility } from './types.ts'

export interface LiveAuthDecision {
  allowed: boolean
  status?: number   // HTTP status to send when not allowed (omitted when allowed)
  reason?: string  // short error string for the response body
}

// Pure decision. `visibility` is null for an unknown competition (→ 404, so a
// typo'd competition key never falls through to "allow anon by default").
export function authorizeLiveRead(
  visibility: CompetitionVisibility | null,
  isAuthed: boolean,
): LiveAuthDecision {
  if (visibility === null) return { allowed: false, status: 404, reason: 'Unknown competition' }
  if (visibility === 'public') return { allowed: true }
  // private: require an authenticated viewer
  if (!isAuthed) return { allowed: false, status: 401, reason: 'Not authenticated' }
  return { allowed: true }
}

// Resolve a competition's visibility from the registry, or null when the
// competition is not configured. Routes call this once and pass the result
// (plus the viewer's auth state) into authorizeLiveRead.
export function resolveCompetitionVisibility(competitionKey: string): CompetitionVisibility | null {
  const config = getCompetitionConfig(competitionKey)
  return config ? config.visibility : null
}