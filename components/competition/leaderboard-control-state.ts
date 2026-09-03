import type { FlightMembershipState, ScoringMode, View } from '../../lib/competition/types.ts'

export interface LeaderboardControlState {
  view: View
  scoring: ScoringMode
  grouping: string
  placedOnly: boolean
}

export type LeaderboardControlAction =
  | { type: 'select-view'; view: View }
  | { type: 'select-scoring'; scoring: ScoringMode }
  | { type: 'select-grouping'; grouping: string }
  | { type: 'select-placed-only'; placedOnly: boolean }
  | { type: 'clear-filters'; defaultScoring: ScoringMode }

// Each control owns one orthogonal dimension. In particular, changing scoring
// or the top-level view must never silently rewrite the selected flight.
export function leaderboardControlReducer(
  state: LeaderboardControlState,
  action: LeaderboardControlAction,
): LeaderboardControlState {
  switch (action.type) {
    case 'select-view':
      return { ...state, view: action.view }
    case 'select-scoring':
      return { ...state, scoring: action.scoring }
    case 'select-grouping':
      return { ...state, grouping: action.grouping }
    case 'select-placed-only':
      return { ...state, placedOnly: action.placedOnly }
    case 'clear-filters':
      return { ...state, scoring: action.defaultScoring, grouping: 'all', placedOnly: false }
  }
}

export function hasActiveLeaderboardFilters(
  state: Pick<LeaderboardControlState, 'scoring' | 'grouping' | 'placedOnly'>,
  defaultScoring: ScoringMode,
): boolean {
  return state.scoring !== defaultScoring || state.grouping !== 'all' || state.placedOnly
}

// Projected and official flights intentionally share canonical keys, so a
// transition between those membership states preserves Flight N. A genuinely
// unavailable or missing grouping safely falls back to Overall.
export function resolveGroupingSelection(
  selected: string | null,
  membership: FlightMembershipState,
): string {
  if (!selected || selected === 'all') return 'all'
  if (membership.status === 'unavailable') return 'all'
  return membership.groupings.some((grouping) => grouping.key === selected)
    ? selected
    : 'all'
}
