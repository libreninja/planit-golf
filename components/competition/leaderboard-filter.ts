// Pure client-side leaderboard filtering by flight. The workspace applies the
// same selection to projected and official Men's League responses. Women's
// Overall remains a single grouping and never reaches a flight selection.
//
// Relative import (no @/ alias) so node --test can load it.

import type { Leaderboard } from '../../lib/competition/types.ts'
import type { LeaderboardFollowState } from '../../lib/players/leaderboard-interaction.ts'
import { displayedPlayerNameMatches } from '../../lib/players/player-search.ts'

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

// Explicit favorites lens: select canonical privately-followed golfers from
// the existing rows without changing their authoritative order. Missing or
// unresolved member-card identities fail closed.
export function filterLeaderboardByFavorites(
  leaderboard: Leaderboard | null,
  favoritesOnly: boolean,
  golferIdsByMemberCard: Record<string, string>,
  followState: LeaderboardFollowState,
): Leaderboard | null {
  if (!leaderboard || !favoritesOnly) return leaderboard
  const followed = new Set(followState.followedGolferIds)
  const cardByKey = new Map(leaderboard.scorecards.map((card) => [card.key, card]))
  return {
    ...leaderboard,
    entries: leaderboard.entries.filter((entry) => {
      const memberCardId = cardByKey.get(entry.key)?.memberCardId
      const golferId = memberCardId ? golferIdsByMemberCard[memberCardId] : null
      return !!golferId && followed.has(golferId)
    }),
  }
}

// Search is presentation-only and runs over the already-loaded authoritative
// rows. It selects displayed First Last names without reordering entries or
// touching the scorecards/member-card provenance used for player identity.
export function filterLeaderboardByPlayerName(
  leaderboard: Leaderboard | null,
  query: string,
): Leaderboard | null {
  if (!leaderboard || !query.trim()) return leaderboard
  return {
    ...leaderboard,
    entries: leaderboard.entries.filter((entry) => displayedPlayerNameMatches(entry.name, query)),
  }
}
