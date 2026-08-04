// Pure decision: for a selected occurrence, do we render the STORED historical
// results or the LIVE path? Extracted from the server wrapper so the product
// rules "a completed historical week renders its stored leaderboard" and "an
// empty occurrence shows the empty state — not a live fetch that hides stored
// results" are unit-testable independent of React/DB. See P0 + §5.
//
// The decision uses DIRECT evidence (hasStoredResults) — never the
// source_finalized_at / resultStatus bookkeeping, which is absent for legacy
// imports. A completed week with stored rows always renders those rows; the
// live path is only used for TODAY's in-window occurrence that has no stored
// results yet (golf happening now). Relative import (no @/ alias) for node --test.

import type { ResultStatus } from '../../lib/competition/types.ts'

export interface InitialRenderInput {
  hasStoredResults: boolean
  todayActive: boolean        // the selected occurrence's window covers now
  selectedIsToday: boolean     // the selected occurrence is today's play-day event
}

export interface InitialRenderDecision {
  useLivePath: boolean
  initialIsHistoricalFinal: boolean
  effectiveStatus: ResultStatus
}

export function decideInitialRender(input: InitialRenderInput): InitialRenderDecision {
  // Today's in-window event with no stored final results yet → live scoring.
  if (input.todayActive && input.selectedIsToday && !input.hasStoredResults) {
    return { useLivePath: true, initialIsHistoricalFinal: false, effectiveStatus: 'live' }
  }
  // Stored results present → render them; polling is fully off.
  if (input.hasStoredResults) {
    return { useLivePath: false, initialIsHistoricalFinal: true, effectiveStatus: 'final' }
  }
  // No stored results and not a live-today event → honest empty state.
  return { useLivePath: false, initialIsHistoricalFinal: false, effectiveStatus: 'unknown' }
}
