export const LEADERBOARD_CONTROL_STICKY_CLASSES = 'sticky top-20 z-10 sm:top-14'

export type LeaderboardPanelEvent = 'toggle' | 'scroll'

// Density is explicitly user-owned. Scroll is modeled here only to make the
// invariant testable: it never changes an expanded or collapsed panel.
export function nextLeaderboardPanelState(
  expanded: boolean,
  event: LeaderboardPanelEvent,
): boolean {
  return event === 'toggle' ? !expanded : expanded
}
