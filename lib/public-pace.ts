import { unstable_noStore as noStore } from 'next/cache'
import { randomUUID } from 'node:crypto'

import { createServiceClient } from '@/lib/supabase/service'

const GOLF_GENIUS_BASE_URL = process.env.GOLF_GENIUS_BASE_URL || 'https://www.golfgenius.com'
const GOLF_GENIUS_API_KEY = process.env.GOLF_GENIUS_API_KEY
const DEFAULT_TIME_ZONE = 'America/Los_Angeles'

export type League = 'mens' | 'womens'

export type PaceCheckpoint = {
  id: string
  token: string
  label: string
  course_name: string
  league: League | null
  hole_number: number | null
  scan_window_minutes: number
}

export type PaceEvent = {
  id: string
  event_date: string
  course_name: string
  league: League | null
  golf_event_id: string | null
  golf_round_id: string | null
}

export type TeeSheetFoursome = {
  key: string
  teeTime: string
  actualStartAt: string
  playerNames: string[]
}

export type LeaderboardRow = {
  id: string
  checkpointLabel: string
  eventDate: string
  groupGgid: string | null
  startedAt: string
  finishedAt: string | null
  scannedAt: string
  elapsedMinutes: number | null
}

export type PaceTimingRun = {
  id: string
  checkpoint_id: string
  event_date: string
  group_ggid: string
  started_at: string
  finished_at: string | null
  finished_checkpoint_id: string | null
  continuation_token: string
}

type TeeSheetRow = {
  id?: string | number
  tee_time?: string
  actual_start_time?: string
  started_at?: string
  start_time?: string
  players?: unknown[]
  player?: unknown
  member?: unknown
  pairing_group?: {
    id?: string | number
    tee_time?: string
    actual_start_time?: string
    started_at?: string
    start_time?: string
    players?: unknown[]
  }
}

function getTodayDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: DEFAULT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

function getString(value: unknown) {
  return typeof value === 'string' && value.trim() ? normalizeText(value) : null
}

function getPlayerName(value: unknown) {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const directName = getString(row.name) || getString(row.display_name) || getString(row.player_name)
  if (directName) return directName

  const firstName = getString(row.first_name)
  const lastName = getString(row.last_name)
  if (firstName || lastName) return [firstName, lastName].filter(Boolean).join(' ')

  return null
}

function getTimeZoneOffsetMinutes(date: Date) {
  const timeZoneName = new Intl.DateTimeFormat('en-US', {
    timeZone: DEFAULT_TIME_ZONE,
    timeZoneName: 'shortOffset',
  })
    .formatToParts(date)
    .find((part) => part.type === 'timeZoneName')?.value
  const match = timeZoneName?.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/)
  if (!match) return 0

  const sign = match[1] === '-' ? -1 : 1
  return sign * (Number(match[2]) * 60 + Number(match[3] || 0))
}

function parseTimeOfDay(value: string) {
  const match = value.trim().match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(AM|PM)?$/i)
  if (!match) return null

  let hours = Number(match[1])
  const minutes = Number(match[2] || 0)
  const meridiem = match[3]?.toUpperCase()

  if (meridiem === 'PM' && hours < 12) hours += 12
  if (meridiem === 'AM' && hours === 12) hours = 0

  return { hours, minutes }
}

function getRowsFromTeeSheetPayload(payload: unknown): TeeSheetRow[] {
  if (Array.isArray(payload)) return payload as TeeSheetRow[]
  if (!payload || typeof payload !== 'object') return []

  const row = payload as Record<string, unknown>
  const candidates = [row.tee_sheet, row.teeSheet, row.pairing_groups, row.pairingGroups, row.groups, row.rows]
  const match = candidates.find(Array.isArray)
  return match ? (match as TeeSheetRow[]) : []
}

function makeAbsoluteStart(eventDate: string, timeValue: string) {
  const trimmed = timeValue.trim()
  if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) return new Date(trimmed).toISOString()

  const timeOfDay = parseTimeOfDay(trimmed)
  if (timeOfDay) {
    const [year, month, day] = eventDate.split('-').map(Number)
    const utcGuess = new Date(Date.UTC(year, month - 1, day, timeOfDay.hours, timeOfDay.minutes))
    const offsetMinutes = getTimeZoneOffsetMinutes(utcGuess)
    return new Date(utcGuess.getTime() - offsetMinutes * 60 * 1000).toISOString()
  }

  const parsed = Date.parse(`${eventDate} ${trimmed}`)
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString()

  return new Date(`${eventDate}T12:00:00-07:00`).toISOString()
}

async function makeGolfGeniusRequest(endpoint: string) {
  if (!GOLF_GENIUS_API_KEY) {
    throw new Error('GOLF_GENIUS_API_KEY is required to fetch live tee sheets')
  }

  const response = await fetch(`${GOLF_GENIUS_BASE_URL}/api_v2/${GOLF_GENIUS_API_KEY}${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`Golf Genius API error (${response.status})`)
  }

  return response.json()
}

export function formatElapsedMinutes(minutes: number) {
  const wholeMinutes = Math.max(0, Math.round(minutes))
  const hours = Math.floor(wholeMinutes / 60)
  const remainingMinutes = wholeMinutes % 60
  return hours > 0 ? `${hours}h ${remainingMinutes}m` : `${remainingMinutes}m`
}

export function formatDateLabel(dateString: string) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${dateString}T00:00:00Z`))
}

export function formatTimeLabel(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: DEFAULT_TIME_ZONE,
  }).format(new Date(value))
}

export async function getCheckpointByToken(token: string) {
  noStore()
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('public_pace_checkpoints')
    .select('id, token, label, course_name, league, hole_number, scan_window_minutes')
    .eq('token', token)
    .eq('active', true)
    .maybeSingle()

  if (error?.code === 'PGRST205') return null
  if (error) throw error
  return data as PaceCheckpoint | null
}

export async function getActivePaceEvent(checkpoint: PaceCheckpoint) {
  noStore()
  const supabase = createServiceClient()
  let query = supabase
    .from('events')
    .select('id, event_date, course_name, league, golf_event_id, golf_round_id')
    .gte('event_date', getTodayDate())
    .not('golf_event_id', 'is', null)
    .not('golf_round_id', 'is', null)
    .order('event_date', { ascending: true })
    .limit(1)

  if (checkpoint.league) {
    query = query.eq('league', checkpoint.league)
  }

  const { data, error } = await query.maybeSingle()
  if (error) throw error
  return data as PaceEvent | null
}

export async function fetchLiveFoursomes(event: PaceEvent, checkpoint: PaceCheckpoint) {
  noStore()
  if (!event.golf_event_id || !event.golf_round_id) return []

  const payload = await makeGolfGeniusRequest(`/events/${event.golf_event_id}/rounds/${event.golf_round_id}/tee_sheet`)
  const rows = getRowsFromTeeSheetPayload(payload)
  const grouped = new Map<string, TeeSheetFoursome>()
  const now = Date.now()
  const scanWindowMs = checkpoint.scan_window_minutes * 60 * 1000

  for (const row of rows) {
    const group = row.pairing_group || {}
    const teeTime = getString(group.tee_time) || getString(row.tee_time)
    if (!teeTime) continue

    const actualStartValue =
      getString(group.actual_start_time) ||
      getString(row.actual_start_time) ||
      getString(group.started_at) ||
      getString(row.started_at) ||
      getString(group.start_time) ||
      getString(row.start_time) ||
      teeTime
    const actualStartAt = makeAbsoluteStart(event.event_date, actualStartValue)
    const startMs = Date.parse(actualStartAt)

    if (Number.isNaN(startMs) || startMs > now + 15 * 60 * 1000 || now - startMs > scanWindowMs) {
      continue
    }

    const players = [
      ...(Array.isArray(group.players) ? group.players : []),
      ...(Array.isArray(row.players) ? row.players : []),
      row.player,
      row.member,
    ]
      .map(getPlayerName)
      .filter((name): name is string => Boolean(name))

    const fallbackKey = [event.golf_round_id, teeTime, players.join('|')].join(':')
    const key = String(group.id || row.id || fallbackKey)
    const existing = grouped.get(key)

    grouped.set(key, {
      key,
      teeTime,
      actualStartAt,
      playerNames: Array.from(new Set([...(existing?.playerNames || []), ...players])),
    })
  }

  return Array.from(grouped.values()).sort((a, b) => Date.parse(b.actualStartAt) - Date.parse(a.actualStartAt))
}

export async function recordPaceScan({
  checkpoint,
  event,
  foursome,
  userAgent,
}: {
  checkpoint: PaceCheckpoint
  event: PaceEvent
  foursome: TeeSheetFoursome
  userAgent: string | null
}) {
  noStore()
  const supabase = createServiceClient()
  const payload = {
    checkpoint_id: checkpoint.id,
    event_id: event.id,
    event_date: event.event_date,
    league: event.league,
    golf_event_id: event.golf_event_id,
    golf_round_id: event.golf_round_id,
    foursome_key: foursome.key,
    tee_time: foursome.teeTime,
    actual_start_at: foursome.actualStartAt,
    player_names: foursome.playerNames,
    user_agent: userAgent,
  }

  const { data, error } = await supabase
    .from('public_pace_scans')
    .upsert(payload, {
      onConflict: 'checkpoint_id,event_date,foursome_key',
      ignoreDuplicates: true,
    })
    .select('id')
    .maybeSingle()

  if (error) throw error
  return data
}

export async function recordGgidPaceScan({
  checkpoint,
  event,
  groupGgid,
  userAgent,
}: {
  checkpoint: PaceCheckpoint
  event: PaceEvent
  groupGgid: string
  userAgent: string | null
}) {
  noStore()
  const supabase = createServiceClient()
  const normalizedGgid = groupGgid.trim().toUpperCase()
  const payload = {
    checkpoint_id: checkpoint.id,
    event_id: event.id,
    event_date: event.event_date,
    league: event.league,
    golf_event_id: event.golf_event_id,
    golf_round_id: event.golf_round_id,
    foursome_key: normalizedGgid,
    group_ggid: normalizedGgid,
    user_agent: userAgent,
  }

  const { data, error } = await supabase
    .from('public_pace_scans')
    .upsert(payload, {
      onConflict: 'checkpoint_id,event_date,foursome_key',
      ignoreDuplicates: true,
    })
    .select('id')
    .maybeSingle()

  if (error) throw error
  return data
}

export async function startPaceTimingRun({
  checkpoint,
  event,
  groupGgid,
  userAgent,
}: {
  checkpoint: PaceCheckpoint
  event: PaceEvent
  groupGgid: string
  userAgent: string | null
}) {
  noStore()
  const supabase = createServiceClient()
  const normalizedGgid = groupGgid.trim().toUpperCase()
  const payload = {
    checkpoint_id: checkpoint.id,
    event_id: event.id,
    event_date: event.event_date,
    league: event.league,
    golf_event_id: event.golf_event_id,
    golf_round_id: event.golf_round_id,
    foursome_key: normalizedGgid,
    group_ggid: normalizedGgid,
    started_at: new Date().toISOString(),
    scanned_at: new Date().toISOString(),
    continuation_token: randomUUID(),
    user_agent: userAgent,
  }

  const { data, error } = await supabase
    .from('public_pace_scans')
    .upsert(payload, {
      onConflict: 'checkpoint_id,event_date,foursome_key',
      ignoreDuplicates: true,
    })
    .select('id, checkpoint_id, event_date, group_ggid, started_at, finished_at, finished_checkpoint_id, continuation_token')
    .maybeSingle()

  if (error) throw error
  if (data) return data as PaceTimingRun

  const { data: existing, error: existingError } = await supabase
    .from('public_pace_scans')
    .select('id, checkpoint_id, event_date, group_ggid, started_at, finished_at, finished_checkpoint_id, continuation_token')
    .eq('checkpoint_id', checkpoint.id)
    .eq('event_date', event.event_date)
    .eq('foursome_key', normalizedGgid)
    .maybeSingle()

  if (existingError) throw existingError
  return existing as PaceTimingRun | null
}

export async function finishPaceTimingRun({
  checkpoint,
  finishToken,
}: {
  checkpoint: PaceCheckpoint
  finishToken: string
}) {
  noStore()
  const supabase = createServiceClient()
  const finishedAt = new Date().toISOString()

  const { data, error } = await supabase
    .from('public_pace_scans')
    .update({
      finished_at: finishedAt,
      finished_checkpoint_id: checkpoint.id,
    })
    .eq('continuation_token', finishToken)
    .is('finished_at', null)
    .select('id, checkpoint_id, event_date, group_ggid, started_at, finished_at, finished_checkpoint_id, continuation_token')
    .maybeSingle()

  if (error) throw error
  if (data) return data as PaceTimingRun

  const { data: existing, error: existingError } = await supabase
    .from('public_pace_scans')
    .select('id, checkpoint_id, event_date, group_ggid, started_at, finished_at, finished_checkpoint_id, continuation_token')
    .eq('continuation_token', finishToken)
    .maybeSingle()

  if (existingError) throw existingError
  return existing as PaceTimingRun | null
}

export async function getPaceTimingRunByToken(finishToken: string) {
  noStore()
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('public_pace_scans')
    .select('id, checkpoint_id, event_date, group_ggid, started_at, finished_at, finished_checkpoint_id, continuation_token')
    .eq('continuation_token', finishToken)
    .maybeSingle()

  if (error) throw error
  return data as PaceTimingRun | null
}

export async function getLeaderboardRows(limit = 25) {
  noStore()
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('public_pace_scans')
    .select(`
      id,
      event_date,
      group_ggid,
      started_at,
      finished_at,
      scanned_at,
      public_pace_checkpoints (
        label
      )
    `)
    .order('event_date', { ascending: false })
    .order('finished_at', { ascending: true, nullsFirst: false })
    .limit(limit)

  if (error?.code === 'PGRST205') return []
  if (error) throw error

  return (data || [])
    .map((row: any) => ({
      id: row.id,
      checkpointLabel: row.public_pace_checkpoints?.label || 'Checkpoint',
      eventDate: row.event_date,
      groupGgid: row.group_ggid,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      scannedAt: row.scanned_at,
      elapsedMinutes: row.finished_at && row.started_at
        ? (Date.parse(row.finished_at) - Date.parse(row.started_at)) / 60000
        : null,
    }))
    .sort((a, b) => {
      if (a.elapsedMinutes === null && b.elapsedMinutes === null) return Date.parse(a.scannedAt) - Date.parse(b.scannedAt)
      if (a.elapsedMinutes === null) return 1
      if (b.elapsedMinutes === null) return -1
      return a.elapsedMinutes - b.elapsedMinutes
    }) as LeaderboardRow[]
}
