// Static Tailwind grid-template class strings for a leaderboard row, one
// verbatim literal per (flight x purse) variant. The strings MUST appear as
// literals in source -- Tailwind's JIT scanner only emits classes it can see
// as literal text; dynamically built class names (template literals, join())
// are silently dropped and the grid breaks. The base (mobile) template never
// includes Flight (Flight is an sm+ column only). Purse is data-driven, so the
// column is added/removed here alongside Flight rather than in the workspace.
//
// Relative import (no @/ alias) so node --test can load the picker.

export interface LeaderboardCols {
  base: string // mobile (no Flight column)
  sm: string // sm+ (Flight column when showFlight)
}

const COLS = {
  basePurseOff: 'grid-cols-[2.5rem_1fr_4rem_3rem_4rem_4rem]',
  basePurseOn: 'grid-cols-[2.5rem_1fr_4rem_3rem_4rem_4rem_5rem]',
  smNoFlightPurseOff: 'sm:grid-cols-[2.5rem_1fr_4rem_3rem_4rem_4rem]',
  smNoFlightPurseOn: 'sm:grid-cols-[2.5rem_1fr_4rem_3rem_4rem_4rem_5rem]',
  smFlightPurseOff: 'sm:grid-cols-[2.5rem_1fr_5rem_4rem_3rem_4rem_4rem]',
  smFlightPurseOn: 'sm:grid-cols-[2.5rem_1fr_5rem_4rem_3rem_4rem_4rem_5rem]',
} as const

export function pickLeaderboardCols(showFlight: boolean, showPurse: boolean): LeaderboardCols {
  return {
    base: showPurse ? COLS.basePurseOn : COLS.basePurseOff,
    sm: showFlight
      ? showPurse
        ? COLS.smFlightPurseOn
        : COLS.smFlightPurseOff
      : showPurse
        ? COLS.smNoFlightPurseOn
        : COLS.smNoFlightPurseOff,
  }
}