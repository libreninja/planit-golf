// Pure result-status derivation. Status is NEVER inferred from Scorecard.isLive
// (card completeness). It combines, in priority order:
//   1. durableFinalized — the durable reconciliation captured finalized results
//   2. upstream round/tournament status — 'completed' → final, 'in_progress' → live
//   3. configured active window + card evidence — but completeness alone never
//      yields 'final'; only 'live' (while active) or 'unknown'.
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
  if (input.upstreamStatus === 'in_progress') return 'live'
  if (input.upstreamStatus === 'not_started') return 'not_started'
  // upstream unknown: use window + card evidence. Completeness is NEVER final.
  if (input.active && (input.anyPartial || input.hasResults)) return 'live'
  return 'unknown'
}