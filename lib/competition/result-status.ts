// Pure result-status derivation. Card completeness (Scorecard.isLive) is
// NEVER used to infer 'final' — only 'live'. It combines, in priority order:
//   1. durableFinalized — the durable reconciliation captured finalized results
//   2. upstream round/tournament status — 'completed' → final, 'in_progress' → live
//   3. partial scorecards (anyPartial) — cards on the course → live, AUTHORITATIVE
//      over the configured active window (scores can arrive before playStartLocal)
//   4. configured active window + card evidence — all-completed cards while the
//      window is open and no upstream signal → live; otherwise unknown.
// The DB/historical path sets durableFinalized=true for persisted finalized
// results, so it doesn't need upstream status. The live path supplies upstream
// status from GG. See design spec §4 (revision: result-status model).

import type { ResultStatus } from './types.ts'

export type UpstreamStatus = 'completed' | 'in_progress' | 'not_started' | 'unknown'

export interface ResultStatusInput {
  upstreamStatus: UpstreamStatus
  active: boolean                 // from isOccurrenceActive
  hasResults: boolean             // at least one result/scorecard present
  anyPartial: boolean              // at least one in-progress scorecard
  durableFinalized: boolean        // durable import captured finalized source
}

export function deriveResultStatus(input: ResultStatusInput): ResultStatus {
  if (input.durableFinalized) return 'final'
  if (input.upstreamStatus === 'completed') return 'final'
  // Partial scorecards (cards genuinely on the course) are DEFINITIVE evidence
  // of a live round — authoritative over the configured active window. GG
  // league rounds never expose event.status, and scores can begin arriving
  // before the nominal playStartLocal (early shotgun, in-play reporting), so
  // gating card evidence on `active` alone suppresses real partial cards as
  // 'unknown' (2026-08-25 regression: live scores reported at 15:59 while the
  // 16:00 window had not opened → API returned 'unknown' for 40 partial cards).
  // A finalized round has no partial cards (completed cards are not isLive),
  // and durableFinalized/completed are checked first, so this never overrides a
  // finalized round. See design spec §4 (revision: result-status model).
  if (input.anyPartial) return 'live'
  if (input.upstreamStatus === 'in_progress') return 'live'
  if (input.upstreamStatus === 'not_started') return 'not_started'
  // upstream unknown: use window + card evidence. Completeness is NEVER final.
  // (anyPartial is already handled above; this covers all-completed cards while
  // the window is open and no upstream signal has arrived yet.)
  if (input.active && input.hasResults) return 'live'
  return 'unknown'
}