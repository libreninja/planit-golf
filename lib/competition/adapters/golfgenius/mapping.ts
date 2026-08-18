// Map igc_league_* DB rows to generic Occurrence/Leaderboard. SERVER-ONLY.
// This is the only place igc_league_* column names appear in the new shared
// layer; everything downstream consumes generic types. The active window is
// BUILT here from config (date + playStartLocal + windowHours + tz) producing
// valid ISO timestamps with real offsets — no hardcoded evening start in
// shared code. See design spec §4/§6 (revision 6).

import type { Occurrence, ActiveWindow, EventFormat, DiscoveryState, ResultStatus, LabelRule } from '../../types.ts'

// Format an ISO date (YYYY-MM-DD[...]) as MM/DD/YYYY for user-facing labels.
// Returns '' when the date is missing or malformed so the label degrades to
// just the "<noun> <number>" prefix instead of leaking a raw timestamp.
export function formatDateUS(iso: string | null): string {
  if (!iso) return ''
  const parts = iso.slice(0, 10).split('-')
  if (parts.length !== 3 || !parts.every((p) => p && /^\d+$/.test(p))) return ''
  const [y, m, d] = parts
  return `${m}/${d}/${y}`
}

// Pick the occurrence to show when the URL doesn't name one. Pure so it is
// unit-testable and so the server wrapper stays thin. Implements the
// product rule verbatim — "if golf is happening today and scores are coming
// in, show me today's golf; otherwise show me the latest golf that happened"
// — using DIRECT result evidence, not inferred status:
//
//   1. TODAY (a play-day occurrence dated today) WITH posted golf → today.
//   2. Otherwise → the NEWEST occurrence that actually has stored results
//      (chronological order, oldest→newest; "newest with results" = last
//      occurrence whose id is in `hasResults`). An empty occurrence is never
//      useful merely because it is newer, so a future/unscored week never
//      replaces the last useful leaderboard.
//   3. Fallback → today (scheduled but no results yet), else the last
//      occurrence overall (e.g. start of season, nothing played yet).
//
// `todayId`/`todayHasPostedGolf`/`hasResults` are computed server-side from
// direct evidence (stored result rows + posted scorecards); this function
// stays pure and deterministic. Occurrences are chronological (oldest first).
// See P0/§3 (simplify initial selection).
export interface DefaultOccurrenceEvidence {
  todayId: string | null
  todayHasPostedGolf: boolean
  hasResults: Set<string>
}

export function defaultOccurrenceId(
  occurrences: Occurrence[],
  evidence: DefaultOccurrenceEvidence,
): string | null {
  if (occurrences.length === 0) return null
  if (evidence.todayId && evidence.todayHasPostedGolf) return evidence.todayId
  const withResults = occurrences.filter((o) => evidence.hasResults.has(o.id))
  if (withResults.length) return withResults[withResults.length - 1].id
  if (evidence.todayId) return evidence.todayId
  return occurrences[occurrences.length - 1].id
}

export interface LeagueEventRow {
  week_number: number
  event_name: string | null
  event_date: string | null
  event_format: EventFormat | null
  discovery_state: DiscoveryState | null
}

// Compute the IANA offset for a given date in a tz, e.g. -07:00 for PDT.
// Uses Intl.DateTimeFormat to avoid pulling a tz library.
function tzOffsetMinutes(tz: string, dateIso: string): number {
  const dt = new Date(dateIso + 'T12:00:00Z')
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' })
  const parts = fmt.formatToParts(dt)
  const off = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+0'
  // off like 'GMT-7' or 'GMT+5:30'
  const m = off.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/)
  if (!m) return 0
  const sign = m[1] === '-' ? -1 : 1
  const h = parseInt(m[2], 10)
  const min = m[3] ? parseInt(m[3], 10) : 0
  return sign * (h * 60 + min)
}
function formatOffset(minutes: number): string {
  const sign = minutes >= 0 ? '+' : '-'
  const abs = Math.abs(minutes)
  const h = String(Math.floor(abs / 60)).padStart(2, '0')
  const mm = String(abs % 60).padStart(2, '0')
  return `${sign}${h}:${mm}`
}

export interface WindowBuildInput {
  date: string | null
  tz: string
  playStartLocal?: string       // '16:00'
  windowHours?: number
}

export function buildLeagueActiveWindow(input: WindowBuildInput): ActiveWindow | null {
  if (!input.date) return null
  const d = input.date.slice(0, 10)
  const start = input.playStartLocal ?? '00:00'
  const offset = formatOffset(tzOffsetMinutes(input.tz, d))
  const startIso = `${d}T${start}:00${offset}`
  if (!input.windowHours) return { start: startIso, end: null }
  // Add windowHours to the wall-clock start, keeping the same offset (league
  // rounds are short enough that DST transitions mid-window are not a concern;
  // if they ever are, recompute the end offset separately).
  const [h, m] = start.split(':').map((s) => parseInt(s, 10))
  const startMin = h * 60 + m + input.windowHours * 60
  const endH = Math.floor(startMin / 60) % 24
  const endM = startMin % 60
  // Handle crossing midnight: add a day to the date if startMin >= 1440.
  const crossesMidnight = startMin >= 1440
  let endD = d
  if (crossesMidnight) {
    const dt = new Date(d + 'T00:00:00Z')
    dt.setUTCDate(dt.getUTCDate() + 1)
    endD = dt.toISOString().slice(0, 10)
  }
  const endIso = `${endD}T${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}:00${offset}`
  return { start: startIso, end: endIso }
}

export function mapLeagueEventToOccurrence(
  row: LeagueEventRow,
  label: string,
  activeWindow: ActiveWindow,
  resultStatus: ResultStatus,
): Occurrence {
  return {
    id: String(row.week_number),
    number: row.week_number,
    label,
    date: row.event_date ? row.event_date.slice(0, 10) : null,
    activeWindow,
    format: row.event_format ?? 'unknown',
    discoveryState: row.discovery_state ?? 'pending',
    resultStatus,
  }
}

export function leagueOccurrenceLabel(
  rule: LabelRule,
  number: number | null,
  eventName: string | null,
  date: string | null = null,
): string {
  if (rule.kind === 'event_name') return eventName ?? `${number ?? ''}`.trim()
  const prefix = `${rule.noun} ${number ?? ''}`.trim()
  if (rule.kind === 'numberPrefix') return prefix
  if (rule.kind === 'weekDate') {
    const ds = formatDateUS(date)
    return ds ? `${prefix}${rule.separator}${ds}` : prefix
  }
  return eventName ? `${prefix}${rule.separator}${eventName}` : prefix
}

// Display label for a configured special occurrence (e.g. a Club Championship
// round). The spec's `label` is the user-facing name ("Club Championship -
// Round 2"); the storage `weekNumber` (101/102) is NEVER shown. The date is
// appended with the same separator the league's labelRule uses for normal
// weeks, so specials read consistently alongside "Week 19 - 08/11/2026" in the
// nav. Used for BOTH the DB-row path (reconcile has upserted a durable row) and
// the config-only path — the spec is the single source of truth for the label
// regardless of durable-row existence.
export function specialOccurrenceLabel(
  specLabel: string,
  date: string | null,
  separator: string,
): string {
  const ds = formatDateUS(date)
  return ds ? `${specLabel}${separator}${ds}` : specLabel
}

// The separator a LabelRule uses between the prefix and its suffix (date for
// weekDate, event name for composite). numberPrefix/event_name carry none, so
// fall back to ' - ' — specials always append a date, so they need a separator.
export function labelRuleSeparator(rule: LabelRule): string {
  if (rule.kind === 'composite' || rule.kind === 'weekDate') return rule.separator
  return ' - '
}
