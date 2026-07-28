// Leading + trailing throttle for coalescing a burst of remote refresh-worthy
// events into a bounded number of refresh() calls, with eventual correctness.
//
//   first relevant event          -> refresh immediately (leading)
//   further events within windowMs of that leading refresh -> suppressed
//   if ANY event was suppressed   -> ONE trailing refresh at leading + windowMs
//   after the trailing refresh    -> nothing pending unless a new event arrives
//
// This closes the stale-state hole a pure leading-edge throttle leaves: an
// event that arrives inside the window (e.g. the second of two availability
// saves 200ms after the first) is no longer dropped forever — the trailing
// refresh re-fetches no later than windowMs after the first. The window is
// ANCHORED at the leading refresh (fixed-window throttle), not reset by each
// new event, so refresh frequency is bounded at one per windowMs and we never
// wait for activity to "settle" (this is a throttle, not a sliding debounce).
//
// This is deliberately independent of the 30s inbox activity-grouping window
// (lib/activity-format groupActivities). Grouping is a presentation concern;
// this is a fetch-scheduling concern. The two share no state or timing.
//
// `now` / `setTimer` / `clearTimer` are injectable so the scheduling logic is
// unit-testable with a virtual clock (no real timers); in the inbox they
// default to Date.now / setTimeout / clearTimeout.

export interface ThrottleOptions {
  windowMs: number
  refresh: () => void
  now?: () => number
  setTimer?: (fn: () => void, delay: number) => number
  clearTimer?: (id: number) => void
}

export class LeadingTrailingThrottle {
  private lastRefresh = Number.NEGATIVE_INFINITY
  private trailingId: number | null = null
  private readonly windowMs: number
  private readonly refresh: () => void
  private readonly now: () => number
  private readonly setTimer: (fn: () => void, delay: number) => number
  private readonly clearTimer: (id: number) => void

  constructor(opts: ThrottleOptions) {
    this.windowMs = opts.windowMs
    this.refresh = opts.refresh
    this.now = opts.now ?? (() => Date.now())
    // Node's setTimeout returns a Timeout object, not a number; the handle is
    // typed as number so a virtual clock can use simple numeric ids. clearTimeout
    // accepts a number handle, so only the setTimer default needs the cast.
    this.setTimer = opts.setTimer ?? ((fn, delay) => setTimeout(fn, delay) as unknown as number)
    this.clearTimer = opts.clearTimer ?? ((id) => clearTimeout(id))
  }

  // Called for each refresh-worthy remote event.
  hit(): void {
    const t = this.now()
    if (t - this.lastRefresh >= this.windowMs) {
      // Leading: refresh now and anchor a fresh window. Cancel any trailing
      // refresh left over from the previous window (should already be null).
      this.cancelTrailing()
      this.lastRefresh = t
      this.refresh()
      return
    }
    // Within the window: suppress this event. Ensure exactly one trailing
    // refresh is scheduled at the end of the current (anchored) window — a
    // later suppressed event must NOT push the trailing refresh later.
    if (this.trailingId === null) {
      const fireAt = this.lastRefresh + this.windowMs
      this.trailingId = this.setTimer(() => {
        this.trailingId = null
        this.lastRefresh = fireAt
        this.refresh()
      }, Math.max(0, fireAt - t))
    }
  }

  // Cancel any pending trailing refresh. Call on component unmount so a refresh
  // scheduled during the last burst never fires after teardown.
  dispose(): void {
    this.cancelTrailing()
  }

  private cancelTrailing(): void {
    if (this.trailingId !== null) {
      this.clearTimer(this.trailingId)
      this.trailingId = null
    }
  }
}