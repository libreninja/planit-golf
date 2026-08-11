// Pure preference-resolution helpers for the Good-to-Go / Tee Times flow.
// Extracted from components/preference-form.tsx so the two-layer preference
// invariants are unit-testable without rendering the client component.
//
// Two preference layers (established product semantics):
//   - default_preferences: persistent per-user fallback, survives week to
//     week. Never deleted by the event-advance lifecycle.
//   - event_preferences: per-event override keyed by event_id. Historical
//     rows remain stored; they simply map only to the event whose id they
//     carry — an old Aug 11 row can never become an Aug 17/18 preference
//     because resolution is by event_id, not by "current event".
//
// No imports (no @/ alias) so `node --test` loads this module directly.

export interface EventPref {
  event_id: string
  tee_time_preferences: string[]
  skip_registration?: boolean | null
}

export interface EventOverrideState {
  times: string[]
  skipRegistration: boolean
}

// Build a lookup of per-event overrides keyed by event_id. Historical rows are
// retained (case 6: event_preferences survive) — the caller decides which
// events to display; stale rows for non-visible events are simply never read.
export function buildInitialEventOverrides(eventPrefs: EventPref[]): Record<string, EventOverrideState> {
  const overrides: Record<string, EventOverrideState> = {}
  for (const eventPref of eventPrefs) {
    overrides[eventPref.event_id] = {
      times: eventPref.tee_time_preferences,
      skipRegistration: eventPref.skip_registration === true,
    }
  }
  return overrides
}

// Effective tee times for one event: its override if present, otherwise the
// persistent defaults (case 5: default_preferences survive as the fallback).
// A skip_registration override yields no times ("can't play this week").
export function getEffectiveTimes(
  defaultTimes: string[],
  override: EventOverrideState | undefined,
): string[] {
  if (!override) {
    return defaultTimes
  }
  return override.skipRegistration ? [] : override.times
}