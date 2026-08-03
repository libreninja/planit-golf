// Map igc_league_* DB rows to generic Occurrence/Leaderboard. SERVER-ONLY.
// This is the only place igc_league_* column names appear in the new shared
// layer; everything downstream consumes generic types. The active window is
// BUILT here from config (date + playStartLocal + windowHours + tz) producing
// valid ISO timestamps with real offsets — no hardcoded evening start in
// shared code. See design spec §4/§6 (revision 6).

import type { Occurrence, ActiveWindow, EventFormat, DiscoveryState, ResultStatus, LabelRule } from '../../types.ts'
import { isOccurrenceActive } from '../../active-window.ts'

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
// unit-testable and so the server wrapper stays thin. Order of preference:
//   1. the occurrence currently in its active window (live play now)
//   2. the most recent finalized occurrence (latest historical results)
//   3. the latest occurrence overall (e.g. a scheduled-but-not-played week)
// Occurrences are assumed chronological (oldest→newest); "latest" = last.
export function defaultOccurrenceId(occurrences: Occurrence[], nowIso: string): string | null {
  if (occurrences.length === 0) return null
  for (const o of occurrences) {
    if (isOccurrenceActive(o.activeWindow, nowIso, false)) return o.id
  }
  let lastFinal: Occurrence | null = null
  for (const o of occurrences) {
    if (o.resultStatus === 'final') lastFinal = o
  }
  if (lastFinal) return lastFinal.id
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
