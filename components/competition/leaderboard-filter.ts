// Pure client-side leaderboard filtering by flight. The workspace applies the
// same selection to projected and official Men's League responses. Women's
// Overall remains a single grouping and never reaches a flight selection.
//
// Relative import (no @/ alias) so node --test can load it.

import type { Leaderboard } from '../../lib/competition/types.ts'

export function filterLeaderboardByGrouping(
  leaderboard: Leaderboard | null,
  grouping: string | null,
  _membershipStatus: 'unavailable' | 'projected' | 'official' = 'official',
): Leaderboard | null {
  if (!leaderboard) return null
  // 'all' / null / unknown grouping → show every entry. Only narrow to a
  // specific flight when one is selected and entries carry flight labels.
  if (!grouping || grouping === 'all') return leaderboard
  const entries = leaderboard.entries.filter((e) => e.flight === grouping)
  return {
    ...leaderboard,
    // Flight membership scopes the rows only. It never manufactures a new
    // placement from the subset, whether membership is projected or official.
    entries,
  }
}

// Presentation-only. An authoritative position is the membership signal; no
// placement is inferred from score order, points, or purse values.
export function filterLeaderboardByPlacement(
  leaderboard: Leaderboard | null,
  placedOnly: boolean,
): Leaderboard | null {
  if (!leaderboard || !placedOnly) return leaderboard
  return {
    ...leaderboard,
    entries: leaderboard.entries.filter((entry) => entry.positionLabel !== null),
  }
}
