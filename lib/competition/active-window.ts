// Pure active-window decision. Activity is NEVER calendar-date equality. An
// occurrence is active when *now* falls within its configured window OR
// upstream scoring is in progress (which can run past the nominal end, e.g.
// delayed scoring after play). All timestamps are ISO strings with offsets.
// See design spec §4 "Active-window model".

export interface ActiveWindow {
  start: string
  end: string | null
}

export function isOccurrenceActive(window: ActiveWindow, nowIso: string, upstreamInProgress: boolean): boolean {
  if (upstreamInProgress) return true
  const now = Date.parse(nowIso)
  const start = Date.parse(window.start)
  if (!Number.isFinite(now) || !Number.isFinite(start)) return false
  if (now < start) return false
  if (window.end === null) return true
  const end = Date.parse(window.end)
  if (!Number.isFinite(end)) return true
  return now <= end
}