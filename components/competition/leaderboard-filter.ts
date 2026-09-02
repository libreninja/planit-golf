// Pure client-side leaderboard filtering by flight. The workspace applies the
// same selection to projected and official Men's League responses. Women's
// Overall remains a single grouping and never reaches a flight selection.
//
// Relative import (no @/ alias) so node --test can load it.

import type { Leaderboard } from '../../lib/competition/types.ts'
import { rankProjectedEntries } from '../../lib/competition/projected-flights.ts'

export function filterLeaderboardByGrouping(
  leaderboard: Leaderboard | null,
  grouping: string | null,
  membershipStatus: 'unavailable' | 'projected' | 'official' = 'official',
): Leaderboard | null {
  if (!leaderboard) return null
  // 'all' / null / unknown grouping → show every entry. Only narrow to a
  // specific flight when one is selected and entries carry flight labels.
  if (!grouping || grouping === 'all') return leaderboard
  const entries = leaderboard.entries.filter((e) => e.flight === grouping)
  return {
    ...leaderboard,
    entries: membershipStatus === 'projected' ? rankProjectedEntries(entries) : entries,
  }
}
