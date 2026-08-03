// Pure client-side leaderboard filtering by grouping (flight). The workspace
// applies the All / Flight A / Flight B / Flight C selection to a finalized
// men's leaderboard here. Live weeks are unflighted (the grouping filter is not
// rendered while live, per hide-until-final), so this is only reached for
// finalized weeks whose capabilities.groupings is 'multi'. Women's Overall is
// 'single' (no filter rendered), so this is never reached for women's. See P6.
//
// Relative import (no @/ alias) so node --test can load it.

import type { Leaderboard } from '../../lib/competition/types.ts'

export function filterLeaderboardByGrouping(
  leaderboard: Leaderboard | null,
  grouping: string | null,
): Leaderboard | null {
  if (!leaderboard) return null
  // 'all' / null / unknown grouping → show every entry. Only narrow to a
  // specific flight when one is selected and entries carry flight labels.
  if (!grouping || grouping === 'all') return leaderboard
  const entries = leaderboard.entries.filter((e) => e.flight === grouping)
  return { ...leaderboard, entries }
}
