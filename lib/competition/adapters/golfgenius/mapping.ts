// Map igc_league_* DB rows to generic Occurrence/Leaderboard. SERVER-ONLY.
// This is the only place igc_league_* column names appear in the new shared
// layer; everything downstream consumes generic types. The active window is
// BUILT here from config (date + playStartLocal + windowHours + tz) producing
// valid ISO timestamps with real offsets — no hardcoded evening start in
// shared code. See design spec §4/§6 (revision 6).

import type { Occurrence, ActiveWindow, EventFormat, DiscoveryState, ResultStatus } from '../../types.ts'

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
  rule: { kind: 'composite'; noun: string; separator: string } | { kind: 'numberPrefix'; noun: string } | { kind: 'event_name' },
  number: number | null,
  eventName: string | null,
): string {
  if (rule.kind === 'event_name') return eventName ?? `${number ?? ''}`.trim()
  const prefix = `${rule.noun} ${number ?? ''}`.trim()
  if (rule.kind === 'numberPrefix') return prefix
  return eventName ? `${prefix}${rule.separator}${eventName}` : prefix
}
