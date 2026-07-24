// Pure, side-effect-free default event selection for a league standings view.
//
// This module intentionally has NO imports (no `@/` path aliases, no Node/Next
// APIs) so it can be unit-tested directly with Node's built-in test runner
// (`node --test`) via plain ESM, independent of the Men's/Women's presentation
// and of any database or request context.

export interface SelectableEvent {
  week_number: number
  // ISO date or timestamp from igc_league_events.event_date (synced from Golf
  // Genius event start_date / round date). May be a calendar date or a full
  // timestamp; toDateKey normalizes it.
  event_date: string | null
}

// Normalize a possibly-timestamped date string to a YYYY-MM-DD calendar key.
// igc_league_events.event_date is a DATE column, but values synced from Golf
// Genius can arrive as full ISO timestamps; comparing those directly against a
// YYYY-MM-DD "today" breaks active-day detection.
export function toDateKey(value: string | null | undefined): string | null {
  if (!value) return null
  return value.slice(0, 10)
}

// Choose the event to show on a league standings page when the user has not
// explicitly picked a week. The rule (documented; independent of presentation):
//
//   1. ACTIVE — an event whose calendar day is today. This is the smallest
//      deterministic derivation of "actively being scored now": Golf Genius
//      does not expose an explicit live/in-progress state we can rely on, and
//      the igc_league_events.status column is written as 'finalized' for every
//      week the sync processes, so it cannot distinguish live from completed.
//   2. MOST RECENT COMPLETED EVENT WITH RESULTS — the latest event before
//      today that actually has scored results. A future event with no scoring
//      must NOT become the default merely because it is chronologically next.
//   3. NEXT UPCOMING — the earliest event on or after today.
//   4. none — the caller renders an honest empty state.
//
// "Has results" is supplied by the caller as the set of week numbers that have
// at least one row in igc_league_performances (real Golf Genius-derived
// scoring), so the rule is driven by source data, not by the status column.
export function selectDefaultEvent<E extends SelectableEvent>(
  events: E[],
  weeksWithResults: Set<number>,
  today: string,
): E | null {
  const todayKey = toDateKey(today) ?? today

  const active = events
    .filter((e) => toDateKey(e.event_date) === todayKey)
    .sort(byDateAsc)
  if (active.length > 0) return active[0]

  const completed = events
    .filter((e) => {
      const key = toDateKey(e.event_date)
      return key !== null && key < todayKey && weeksWithResults.has(e.week_number)
    })
    .sort(byDateDesc)
  if (completed.length > 0) return completed[0]

  const upcoming = events
    .filter((e) => {
      const key = toDateKey(e.event_date)
      return key !== null && key >= todayKey
    })
    .sort(byDateAsc)
  if (upcoming.length > 0) return upcoming[0]

  return null
}

// Resolve the event to display on a standings page, honoring an explicit week
// selection from the URL (`?week=N`) before applying the default rule. An
// explicitly selected future event with no results is retained on purpose —
// the standings view then shows an honest "No results available yet" state
// rather than silently substituting a different week.
export function resolveStandingsEvent<E extends SelectableEvent>(
  explicitWeek: number | undefined,
  events: E[],
  weeksWithResults: Set<number>,
  today: string,
): E | null {
  if (explicitWeek !== undefined) {
    const explicit = events.find((e) => e.week_number === explicitWeek)
    if (explicit) return explicit
  }
  return selectDefaultEvent(events, weeksWithResults, today)
}

function byDateAsc<E extends SelectableEvent>(a: E, b: E): number {
  return cmp(toDateKey(a.event_date), toDateKey(b.event_date))
}

function byDateDesc<E extends SelectableEvent>(a: E, b: E): number {
  return cmp(toDateKey(b.event_date), toDateKey(a.event_date))
}

function cmp(a: string | null, b: string | null): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a < b ? -1 : a > b ? 1 : 0
}