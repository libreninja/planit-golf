// Pure request-generation ordering (Correction 8). When the user switches
// scoring mode (or occurrence), an in-flight fetch for the OLD mode may resolve
// AFTER the new mode's fetch. Tagging each response with the generation it was
// issued for — and only applying it when that generation still equals the
// current generation — prevents a slower previous-mode response from
// overwriting the new mode's data. The leaderboard is retained while the new
// mode loads; it is replaced only by a matching-generation response.
//
// This is a pure function so the ordering invariant is unit-testable without
// React or timers.

export interface GenResponse<T = unknown> {
  gen: number          // generation the request was issued for
  data: T
}

export function applyResponse<T>(current: T | null, res: GenResponse<T>, currentGen: number): T | null {
  if (res.gen !== currentGen) return current      // stale generation → retain current data
  return res.data
}
