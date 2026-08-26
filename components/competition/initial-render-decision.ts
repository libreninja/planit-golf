// Pure decision: for a selected occurrence, do we render the STORED historical
// results or the LIVE path? Extracted from the server wrapper so the product
// rules "a completed historical week renders its stored leaderboard", "an empty
// occurrence shows the empty state — not a live fetch that hides stored
// results", and "live scoring wins while golf is actually happening now" are
// unit-testable independent of React/DB. See P0 + §5.
//
// The decision uses DIRECT evidence (hasStoredResults, todayLiveHasGolf) —
// never the source_finalized_at / resultStatus bookkeeping, which is absent
// for legacy imports. A completed week with stored rows renders those rows;
// the live path is used for TODAY's in-window occurrence. LIVE WINS OVER
// STORED only when the live path shows meaningful golf (todayLiveHasGolf:
// scorecards with holes completed) — so a live round in progress is shown even
// if stale/partial stored rows exist, but an empty live fetch never hides
// stored results. Relative import (no @/ alias) for node --test.

import type { ResultStatus } from '../../lib/competition/types.ts'

export interface InitialRenderInput {
  hasStoredResults: boolean
  todayActive: boolean        // the selected occurrence's window covers now
  selectedIsToday: boolean     // the selected occurrence is today's play-day event
  todayLiveHasGolf: boolean    // today's live path shows scorecards with holes completed
  // Genuinely in-progress live scoring: at least one PARTIAL scorecard (a card
  // still on the course) returned by today's live path. Distinct from
  // todayLiveHasGolf, which is also true for a finalized round whose cards are
  // all complete — todayLiveInProgress is the authoritative "golf is happening
  // NOW" signal that engages the live path even before the nominal play window
  // opens. See 2026-08-25 regression.
  todayLiveInProgress?: boolean
}

export interface InitialRenderDecision {
  useLivePath: boolean
  initialIsHistoricalFinal: boolean
  effectiveStatus: ResultStatus
}

export function decideInitialRender(input: InitialRenderInput): InitialRenderDecision {
  // Today's event with genuinely in-progress live scoring (partial scorecards
  // on the course) → live path REGARDLESS of the configured active window.
  // Card evidence is authoritative over the clock: scores can arrive before the
  // nominal playStartLocal (early shotgun, in-play reporting), and GG league
  // rounds never expose event.status, so the window gate alone suppresses real
  // partial cards as an empty state (2026-08-25: scores reported at 15:59 while
  // the 16:00 window was closed → UI said "Results aren't available" despite 40
  // partial scorecards). A finalized round has no partial cards, so this never
  // overrides finalized standings.
  if (input.selectedIsToday && input.todayLiveInProgress) {
    return { useLivePath: true, initialIsHistoricalFinal: false, effectiveStatus: 'live' }
  }
  // Live wins when golf is happening NOW on today's in-window event — even if
  // stored rows exist (they may be stale/partial). The meaningful-live-results
  // gate (todayLiveHasGolf) ensures an empty live fetch never hides stored.
  if (input.todayActive && input.selectedIsToday && input.todayLiveHasGolf) {
    return { useLivePath: true, initialIsHistoricalFinal: false, effectiveStatus: 'live' }
  }
  // Stored results present and no meaningful live golf now → render them;
  // polling is fully off.
  if (input.hasStoredResults) {
    return { useLivePath: false, initialIsHistoricalFinal: true, effectiveStatus: 'final' }
  }
  // Today's in-window event with no stored results yet and no live golf posted
  // yet → still use the live path (it shows not_started/pending until scores
  // arrive, then polling surfaces them without blanking).
  if (input.todayActive && input.selectedIsToday) {
    return { useLivePath: true, initialIsHistoricalFinal: false, effectiveStatus: 'live' }
  }
  // No stored results and not a live-today event → honest empty state.
  return { useLivePath: false, initialIsHistoricalFinal: false, effectiveStatus: 'unknown' }
}
