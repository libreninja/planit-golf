import 'server-only'

import { createHash } from 'node:crypto'

import { createServiceClient } from '@/lib/supabase/service'

const GOLF_GENIUS_BASE_URL = process.env.GOLF_GENIUS_BASE_URL || 'https://www.golfgenius.com'
const GOLF_GENIUS_API_KEY = process.env.GOLF_GENIUS_API_KEY
const PROVIDER = 'golf_genius'
const DEFAULT_TIME_ZONE = 'America/Los_Angeles'

type JsonRecord = Record<string, unknown>

type SyncEvent = {
  id: string
  slug: string
  name: string
  starts_on: string | null
  status: string
  golf_genius_event_id: string | null
  golf_genius_portal_id: string | null
}

type RawFetchResult = {
  endpoint: string
  ok: boolean
  statusCode: number | null
  payload: unknown
  errorMessage: string | null
}

type RawPayloadRow = {
  id: string
  endpoint: string
  ok: boolean
  status_code: number | null
  payload: unknown
  error_message: string | null
}

type SyncContext = {
  supabase: ReturnType<typeof createServiceClient>
  event: SyncEvent
  syncRunId: string
  externalEventId: string
}

type NormalizedRound = {
  id?: string
  externalRoundId: string
  name: string
  roundNumber: number | null
  courseName: string | null
  startsOn: string | null
  status: string | null
  rawData: JsonRecord
}

type NormalizedTeeTime = {
  externalTeeTimeId: string
  teeTimeLabel: string | null
  startsAt: string | null
  tee: string | null
  groupName: string | null
  displayOrder: number
  rawData: JsonRecord
  players: NormalizedPairingPlayer[]
}

type NormalizedPairingPlayer = {
  externalPlayerId: string | null
  playerName: string
  teamName: string | null
  rawData: JsonRecord
}

type NormalizedLeaderboardRow = {
  externalId: string
  name: string
  position: string
  rankSort: number | null
  score: string | null
  today: string | null
  thru: string | null
  movement: string | null
  raw: JsonRecord
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function compactText(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

function getString(row: JsonRecord | null | undefined, keys: string[]) {
  if (!row) return null

  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'string' && value.trim()) return compactText(value)
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }

  return null
}

function getNumber(row: JsonRecord | null | undefined, keys: string[]) {
  if (!row) return null

  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim() && !Number.isNaN(Number(value))) return Number(value)
  }

  return null
}

function unwrapRow(value: unknown): JsonRecord | null {
  if (!isRecord(value)) return null
  return (
    (isRecord(value.event) && value.event) ||
    (isRecord(value.round) && value.round) ||
    (isRecord(value.member) && value.member) ||
    (isRecord(value.player) && value.player) ||
    (isRecord(value.participant) && value.participant) ||
    value
  )
}

function getRows(payload: unknown, keys: string[]): JsonRecord[] {
  if (Array.isArray(payload)) {
    return payload.map(unwrapRow).filter((row): row is JsonRecord => Boolean(row))
  }

  if (!isRecord(payload)) return []

  for (const key of keys) {
    const candidate = payload[key]
    if (Array.isArray(candidate)) {
      return candidate.map(unwrapRow).filter((row): row is JsonRecord => Boolean(row))
    }
    if (isRecord(candidate)) {
      const nested: JsonRecord[] = getRows(candidate, keys)
      if (nested.length > 0) return nested
    }
  }

  return []
}

function getFirstRecord(payload: unknown) {
  if (isRecord(payload)) {
    return unwrapRow(payload)
  }
  const [first] = getRows(payload, ['events', 'data', 'rows'])
  return first || null
}

function getDateString(row: JsonRecord | null | undefined, keys: string[]) {
  const value = getString(row, keys)
  if (!value) return null

  const isoDate = value.match(/\d{4}-\d{2}-\d{2}/)?.[0]
  if (isoDate) return isoDate

  const parsed = Date.parse(value)
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString().slice(0, 10)

  return null
}

function getPersonName(row: JsonRecord | null | undefined) {
  if (!row) return null

  const directName = getString(row, ['name', 'display_name', 'player_name', 'participant_name', 'member_name'])
  if (directName) return directName

  const firstName = getString(row, ['first_name', 'firstName'])
  const lastName = getString(row, ['last_name', 'lastName'])
  const combined = [firstName, lastName].filter(Boolean).join(' ')

  return combined || null
}

function stableFallbackId(scope: string, value: unknown) {
  return `${scope}:${createHash('sha1').update(JSON.stringify(value)).digest('hex').slice(0, 16)}`
}

function getExternalId(row: JsonRecord, keys: string[], fallbackScope: string) {
  return getString(row, keys) || stableFallbackId(fallbackScope, row)
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

function makeAbsoluteStart(eventDate: string | null, timeValue: string | null) {
  if (!eventDate || !timeValue) return null
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

  return null
}

function hashJson(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function buildEndpoint(endpoint: string, params: Record<string, string | number | boolean | undefined> = {}) {
  const query = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&')

  return `${endpoint}${query ? `?${query}` : ''}`
}

async function makeGolfGeniusRequest(endpoint: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<RawFetchResult> {
  if (!GOLF_GENIUS_API_KEY) {
    throw new Error('GOLF_GENIUS_API_KEY is required for Golf Genius event sync')
  }

  const endpointWithQuery = buildEndpoint(endpoint, params)

  try {
    const response = await fetch(`${GOLF_GENIUS_BASE_URL}/api_v2/${GOLF_GENIUS_API_KEY}${endpointWithQuery}`, {
      headers: {
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    })
    const text = await response.text()
    let payload: unknown = null

    if (text) {
      try {
        payload = JSON.parse(text)
      } catch {
        payload = { text: text.slice(0, 20000) }
      }
    }

    return {
      endpoint: endpointWithQuery,
      ok: response.ok,
      statusCode: response.status,
      payload,
      errorMessage: response.ok ? null : `Golf Genius API error (${response.status})`,
    }
  } catch (error) {
    return {
      endpoint: endpointWithQuery,
      ok: false,
      statusCode: null,
      payload: null,
      errorMessage: error instanceof Error ? error.message : 'Golf Genius request failed',
    }
  }
}

async function storeRawPayload(
  supabase: SyncContext['supabase'],
  syncRunId: string,
  result: RawFetchResult,
) {
  const { data, error } = await supabase
    .from('external_raw_payloads')
    .insert({
      sync_run_id: syncRunId,
      provider: PROVIDER,
      endpoint: result.endpoint,
      status_code: result.statusCode,
      ok: result.ok,
      payload: result.payload ?? null,
      error_message: result.errorMessage,
    })
    .select('id, endpoint, ok, status_code, payload, error_message')
    .single()

  if (error) throw error
  return data as RawPayloadRow
}

async function fetchAndStore(
  context: SyncContext,
  endpoint: string,
  params: Record<string, string | number | boolean | undefined> = {},
) {
  const result = await makeGolfGeniusRequest(endpoint, params)
  return storeRawPayload(context.supabase, context.syncRunId, result)
}

async function fetchPagedRows(context: SyncContext, endpoint: string, keys: string[]) {
  const rows: JsonRecord[] = []
  const payloads: RawPayloadRow[] = []

  for (let page = 1; page <= 25; page += 1) {
    const rawPayload = await fetchAndStore(context, endpoint, { page })
    payloads.push(rawPayload)

    if (!rawPayload.ok) break

    const pageRows = getRows(rawPayload.payload, keys)
    if (pageRows.length === 0) break

    rows.push(...pageRows)
  }

  return { rows, payloads }
}

async function resolveEvent(supabase: SyncContext['supabase'], eventIdOrPortalId: string) {
  const select = 'id, slug, name, starts_on, status, golf_genius_event_id, golf_genius_portal_id'

  const bySlug = await supabase
    .from('igc_events')
    .select(select)
    .eq('slug', eventIdOrPortalId)
    .maybeSingle()
  if (bySlug.error) throw bySlug.error
  if (bySlug.data) return bySlug.data as SyncEvent

  const byGolfEventId = await supabase
    .from('igc_events')
    .select(select)
    .eq('golf_genius_event_id', eventIdOrPortalId)
    .maybeSingle()
  if (byGolfEventId.error) throw byGolfEventId.error
  if (byGolfEventId.data) return byGolfEventId.data as SyncEvent

  const byPortalId = await supabase
    .from('igc_events')
    .select(select)
    .eq('golf_genius_portal_id', eventIdOrPortalId)
    .maybeSingle()
  if (byPortalId.error) throw byPortalId.error
  if (byPortalId.data) return byPortalId.data as SyncEvent

  throw new Error(`No IGC event found for ${eventIdOrPortalId}`)
}

function normalizeEventUpdate(payload: unknown, externalEventId: string) {
  const row = getFirstRecord(payload)
  if (!row) return { golf_genius_event_id: externalEventId }

  return {
    golf_genius_event_id: externalEventId,
    name: getString(row, ['name', 'title', 'event_name']) || undefined,
    description: getString(row, ['description', 'overview']) || undefined,
    location_name: getString(row, ['location', 'location_name', 'course_name', 'facility_name']) || undefined,
    starts_on: getDateString(row, ['start_date', 'starts_on', 'date', 'event_date']) || undefined,
    ends_on: getDateString(row, ['end_date', 'ends_on']) || undefined,
    golf_genius_portal_url: getString(row, ['portal_url', 'event_url', 'url']) || undefined,
  }
}

function normalizePlayers(eventId: string, rows: JsonRecord[]) {
  return rows
    .map((row) => {
      const displayName = getPersonName(row)
      if (!displayName) return null
      const externalPlayerId = getExternalId(row, ['id', 'player_id', 'member_id', 'ggid', 'external_id'], `player:${displayName}`)

      return {
        event_id: eventId,
        external_player_id: externalPlayerId,
        external_member_id: getString(row, ['member_id', 'ggid', 'master_roster_id']),
        display_name: displayName,
        first_name: getString(row, ['first_name', 'firstName']),
        last_name: getString(row, ['last_name', 'lastName']),
        email: getString(row, ['email']),
        handicap_index: getNumber(row, ['handicap_index', 'handicap', 'hi']),
        raw_data: row,
      }
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
}

function normalizeRounds(event: SyncEvent, rows: JsonRecord[]): NormalizedRound[] {
  return rows.map((row, index) => {
    const roundNumber = getNumber(row, ['round_number', 'number', 'position']) || index + 1
    const externalRoundId = getExternalId(row, ['id', 'round_id', 'external_id'], `round:${event.id}:${roundNumber}`)

    return {
      externalRoundId,
      name: getString(row, ['name', 'title', 'round_name']) || `Round ${roundNumber}`,
      roundNumber,
      courseName: getString(row, ['course_name', 'course', 'facility_name']),
      startsOn: getDateString(row, ['date', 'event_date', 'start_date', 'starts_on']) || event.starts_on,
      status: getString(row, ['status', 'state']),
      rawData: row,
    }
  })
}

function getTeeSheetRows(payload: unknown) {
  return getRows(payload, ['tee_sheet', 'teeSheet', 'pairing_groups', 'pairingGroups', 'groups', 'rows'])
}

function getPlayersForTeeSheetRow(row: JsonRecord) {
  const group = isRecord(row.pairing_group) ? row.pairing_group : isRecord(row.group) ? row.group : null
  const candidates = [
    ...(group && Array.isArray(group.players) ? group.players : []),
    ...(group && Array.isArray(group.members) ? group.members : []),
    ...(Array.isArray(row.players) ? row.players : []),
    ...(Array.isArray(row.members) ? row.members : []),
    row.player,
    row.member,
  ]

  return candidates
    .map(unwrapRow)
    .filter((player): player is JsonRecord => Boolean(player))
    .map((player) => {
      const playerName = getPersonName(player)
      if (!playerName) return null

      return {
        externalPlayerId: getString(player, ['id', 'player_id', 'member_id', 'ggid', 'external_id']),
        playerName,
        teamName: getString(player, ['team_name', 'team', 'side']),
        rawData: player,
      }
    })
    .filter((player): player is NormalizedPairingPlayer => Boolean(player))
}

function normalizeTeeTimes({
  event,
  round,
  rows,
}: {
  event: SyncEvent
  round: NormalizedRound | null
  rows: JsonRecord[]
}) {
  return rows.map((row, index): NormalizedTeeTime => {
    const group = isRecord(row.pairing_group) ? row.pairing_group : isRecord(row.group) ? row.group : null
    const groupSource = group || row
    const teeTimeLabel = getString(groupSource, ['tee_time', 'teeTime', 'start_time', 'starts_at', 'actual_start_time'])
    const externalTeeTimeId =
      getString(groupSource, ['id', 'pairing_group_id', 'group_id', 'tee_time_id']) ||
      stableFallbackId(`tee:${event.id}:${round?.externalRoundId || 'event'}:${index}`, {
        teeTimeLabel,
        players: getPlayersForTeeSheetRow(row).map((player) => player.playerName),
      })

    return {
      externalTeeTimeId: `${round?.externalRoundId || 'event'}:${externalTeeTimeId}`,
      teeTimeLabel,
      startsAt: makeAbsoluteStart(round?.startsOn || event.starts_on, teeTimeLabel),
      tee: getString(groupSource, ['tee', 'tee_name', 'starting_hole', 'hole']),
      groupName: getString(groupSource, ['name', 'group_name', 'pairing_name']),
      displayOrder: index,
      rawData: row,
      players: getPlayersForTeeSheetRow(row),
    }
  })
}

async function upsertRounds(context: SyncContext, rounds: NormalizedRound[]) {
  if (rounds.length === 0) return []

  const payload = rounds.map((round) => ({
    event_id: context.event.id,
    external_round_id: round.externalRoundId,
    name: round.name,
    round_number: round.roundNumber,
    course_name: round.courseName,
    starts_on: round.startsOn,
    status: round.status,
    raw_data: round.rawData,
  }))

  const { data, error } = await context.supabase
    .from('igc_rounds')
    .upsert(payload, { onConflict: 'event_id,external_round_id' })
    .select('id, external_round_id, name, round_number, course_name, starts_on, status, raw_data')

  if (error) throw error

  return (data || []).map((row: any) => ({
    id: row.id,
    externalRoundId: row.external_round_id,
    name: row.name,
    roundNumber: row.round_number,
    courseName: row.course_name,
    startsOn: row.starts_on,
    status: row.status,
    rawData: row.raw_data || {},
  })) as NormalizedRound[]
}

async function upsertPlayers(context: SyncContext, rows: JsonRecord[]) {
  const players = normalizePlayers(context.event.id, rows)
  if (players.length === 0) return 0

  const { error } = await context.supabase
    .from('igc_players')
    .upsert(players, { onConflict: 'event_id,external_player_id' })

  if (error) throw error
  return players.length
}

async function upsertTeeTimes(context: SyncContext, round: NormalizedRound | null, teeTimes: NormalizedTeeTime[]) {
  if (teeTimes.length === 0) return { teeTimeCount: 0, pairingCount: 0 }

  const teeTimePayload = teeTimes.map((teeTime) => ({
    event_id: context.event.id,
    round_id: round?.id || null,
    external_tee_time_id: teeTime.externalTeeTimeId,
    tee_time_label: teeTime.teeTimeLabel,
    starts_at: teeTime.startsAt,
    tee: teeTime.tee,
    group_name: teeTime.groupName,
    display_order: teeTime.displayOrder,
    raw_data: teeTime.rawData,
  }))

  const { data: teeTimeRows, error: teeTimeError } = await context.supabase
    .from('igc_tee_times')
    .upsert(teeTimePayload, { onConflict: 'event_id,external_tee_time_id' })
    .select('id, external_tee_time_id')

  if (teeTimeError) throw teeTimeError

  let deleteQuery = context.supabase.from('igc_pairings').delete().eq('event_id', context.event.id)
  deleteQuery = round?.id ? deleteQuery.eq('round_id', round.id) : deleteQuery.is('round_id', null)
  const { error: deleteError } = await deleteQuery
  if (deleteError) throw deleteError

  const teeTimeIdByExternalId = new Map((teeTimeRows || []).map((row: any) => [row.external_tee_time_id, row.id]))
  const pairingPayload = teeTimes.flatMap((teeTime) =>
    teeTime.players.map((player, playerIndex) => ({
      event_id: context.event.id,
      round_id: round?.id || null,
      tee_time_id: teeTimeIdByExternalId.get(teeTime.externalTeeTimeId) || null,
      external_pairing_id: `${teeTime.externalTeeTimeId}:${player.externalPlayerId || playerIndex}`,
      external_player_id: player.externalPlayerId,
      player_name: player.playerName,
      team_name: player.teamName,
      display_order: playerIndex,
      raw_data: player.rawData,
    })),
  )

  if (pairingPayload.length > 0) {
    const { error: pairingError } = await context.supabase
      .from('igc_pairings')
      .upsert(pairingPayload, { onConflict: 'event_id,external_pairing_id' })

    if (pairingError) throw pairingError
  }

  await insertFeedEvent(context, {
    type: 'tee_times_imported',
    title: `${round?.name || 'Event'} pairings posted`,
    body: `${teeTimes.length} groups imported from Golf Genius.`,
    dedupeKey: `tee-times:${round?.externalRoundId || 'event'}:${hashJson(teeTimePayload)}`,
    metadata: {
      roundExternalId: round?.externalRoundId || null,
      teeTimeCount: teeTimes.length,
      pairingCount: pairingPayload.length,
    },
  })

  return { teeTimeCount: teeTimes.length, pairingCount: pairingPayload.length }
}

function extractLeaderboardRows(payload: unknown): JsonRecord[] {
  if (Array.isArray(payload)) {
    return payload.map(unwrapRow).filter((row): row is JsonRecord => Boolean(row))
  }

  if (!isRecord(payload)) return []

  const directRows = getRows(payload, [
    'leaderboard',
    'leaderboard_rows',
    'leaderboardRows',
    'results',
    'standings',
    'rows',
    'teams',
    'players',
    'scores',
  ])
  if (directRows.length > 0) return directRows

  for (const value of Object.values(payload)) {
    if (isRecord(value)) {
      const nestedRows = extractLeaderboardRows(value)
      if (nestedRows.length > 0) return nestedRows
    }
  }

  return []
}

function parseRank(value: string | null) {
  if (!value) return null
  const match = value.match(/\d+/)
  return match ? Number(match[0]) : null
}

function normalizeLeaderboardRows(payload: unknown): NormalizedLeaderboardRow[] {
  return extractLeaderboardRows(payload)
    .map((row, index) => {
      const name =
        getPersonName(row) ||
        getString(row, ['team_name', 'team', 'side_name', 'competitor_name', 'name'])
      if (!name) return null

      const position = getString(row, ['position', 'place', 'rank', 'standing', 'formatted_position', 'pos']) || String(index + 1)
      const rankSort = parseRank(position)
      const externalId = getExternalId(row, ['id', 'player_id', 'team_id', 'member_id', 'competitor_id', 'ggid'], `leaderboard:${name}`)

      return {
        externalId,
        name,
        position,
        rankSort,
        score: getString(row, ['total', 'total_score', 'score', 'to_par', 'total_to_par', 'net', 'gross']),
        today: getString(row, ['today', 'round_score', 'current_round', 'round_to_par']),
        thru: getString(row, ['thru', 'holes', 'holes_played']),
        movement: getString(row, ['movement', 'change']),
        raw: row,
      }
    })
    .filter((row): row is NormalizedLeaderboardRow => Boolean(row))
}

async function insertFeedEvent(
  context: SyncContext,
  {
    type,
    title,
    body,
    dedupeKey,
    metadata,
  }: {
    type: string
    title: string
    body?: string | null
    dedupeKey: string
    metadata?: JsonRecord
  },
) {
  const { error } = await context.supabase
    .from('igc_feed_events')
    .upsert(
      {
        event_id: context.event.id,
        external_sync_run_id: context.syncRunId,
        type,
        title,
        body: body || null,
        dedupe_key: dedupeKey,
        metadata: metadata || {},
      },
      { onConflict: 'event_id,dedupe_key', ignoreDuplicates: true },
    )

  if (error) throw error
}

function buildLeaderboardFeedItems({
  previousRows,
  currentRows,
  roundName,
  snapshotId,
  leaderboardType,
}: {
  previousRows: NormalizedLeaderboardRow[]
  currentRows: NormalizedLeaderboardRow[]
  roundName: string
  snapshotId: string
  leaderboardType: string
}) {
  const items: Array<{ type: string; title: string; body?: string | null; dedupeKey: string; metadata?: JsonRecord }> = []
  const currentLeader = currentRows.find((row) => row.rankSort === 1) || currentRows[0]
  const previousLeader = previousRows.find((row) => row.rankSort === 1) || previousRows[0]

  if (!previousLeader && currentRows.length > 0) {
    items.push({
      type: leaderboardType === 'results' ? 'results_imported' : 'leaderboard_imported',
      title: leaderboardType === 'results' ? `${roundName} results imported` : `${roundName} leaderboard imported`,
      body: `${currentRows.length} leaderboard rows are now available.`,
      dedupeKey: `leaderboard:${snapshotId}:initial`,
    })
  } else if (currentLeader && previousLeader && currentLeader.externalId !== previousLeader.externalId) {
    items.push({
      type: 'leader_change',
      title: `${currentLeader.name} took the lead`,
      body: previousLeader.name ? `Previous leader: ${previousLeader.name}.` : null,
      dedupeKey: `leaderboard:${snapshotId}:leader`,
      metadata: {
        previousLeader: previousLeader.name,
        currentLeader: currentLeader.name,
      },
    })
  }

  const previousByExternalId = new Map(previousRows.map((row) => [row.externalId, row]))
  const movers = currentRows
    .map((row) => {
      const previous = previousByExternalId.get(row.externalId)
      if (!previous?.rankSort || !row.rankSort) return null
      const delta = previous.rankSort - row.rankSort
      if (delta <= 0) return null
      return { row, previous, delta }
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 3)

  for (const mover of movers) {
    items.push({
      type: 'leaderboard_move',
      title: `${mover.row.name} moved from ${mover.previous.position} to ${mover.row.position}`,
      body: mover.row.score ? `Current score: ${mover.row.score}.` : null,
      dedupeKey: `leaderboard:${snapshotId}:move:${mover.row.externalId}`,
      metadata: {
        from: mover.previous.position,
        to: mover.row.position,
        score: mover.row.score,
      },
    })
  }

  if (items.length === 0 && currentRows.length > 0) {
    items.push({
      type: 'leaderboard_updated',
      title: `${roundName} leaderboard updated`,
      body: `${currentRows.length} rows imported from Golf Genius.`,
      dedupeKey: `leaderboard:${snapshotId}:updated`,
    })
  }

  return items
}

async function storeLeaderboardSnapshot({
  context,
  round,
  sourcePayload,
  leaderboardType,
}: {
  context: SyncContext
  round: NormalizedRound | null
  sourcePayload: RawPayloadRow
  leaderboardType: string
}) {
  if (!sourcePayload.ok) return 0

  const rows = normalizeLeaderboardRows(sourcePayload.payload)
  if (rows.length === 0) return 0

  let previousQuery = context.supabase
    .from('igc_leaderboard_snapshots')
    .select('id, rows, content_hash')
    .eq('event_id', context.event.id)
    .eq('leaderboard_type', leaderboardType)
    .order('snapshot_at', { ascending: false })
    .limit(1)

  previousQuery = round?.id ? previousQuery.eq('round_id', round.id) : previousQuery.is('round_id', null)
  const { data: previousSnapshots, error: previousError } = await previousQuery
  if (previousError) throw previousError

  const previousSnapshot = previousSnapshots?.[0] as { id: string; rows: NormalizedLeaderboardRow[]; content_hash: string } | undefined
  const contentHash = hashJson(rows.map(({ raw, ...row }) => row))

  if (previousSnapshot?.content_hash === contentHash) {
    return 0
  }

  let existingQuery = context.supabase
    .from('igc_leaderboard_snapshots')
    .select('id')
    .eq('event_id', context.event.id)
    .eq('leaderboard_type', leaderboardType)
    .eq('content_hash', contentHash)
    .limit(1)
  existingQuery = round?.id ? existingQuery.eq('round_id', round.id) : existingQuery.is('round_id', null)
  const { data: existingSnapshots, error: existingError } = await existingQuery
  if (existingError) throw existingError
  if (existingSnapshots && existingSnapshots.length > 0) return 0

  const { data: snapshot, error: snapshotError } = await context.supabase
    .from('igc_leaderboard_snapshots')
    .insert({
      event_id: context.event.id,
      round_id: round?.id || null,
      external_sync_run_id: context.syncRunId,
      source_payload_id: sourcePayload.id,
      leaderboard_type: leaderboardType,
      content_hash: contentHash,
      rows,
      summary: {
        rowCount: rows.length,
        roundExternalId: round?.externalRoundId || null,
      },
    })
    .select('id')
    .single()

  if (snapshotError) throw snapshotError

  const feedItems = buildLeaderboardFeedItems({
    previousRows: previousSnapshot?.rows || [],
    currentRows: rows,
    roundName: round?.name || 'Event',
    snapshotId: snapshot.id,
    leaderboardType,
  })

  for (const item of feedItems) {
    await insertFeedEvent(context, item)
  }

  return 1
}

async function completeSyncRun(
  context: SyncContext,
  status: 'success' | 'failed',
  summary: JsonRecord,
  errorMessage?: string,
) {
  const completedAt = new Date().toISOString()

  await context.supabase
    .from('external_sync_runs')
    .update({
      status,
      completed_at: completedAt,
      error_message: errorMessage || null,
      summary,
    })
    .eq('id', context.syncRunId)

  await context.supabase
    .from('igc_events')
    .update({
      last_synced_at: completedAt,
      last_sync_status: status,
      last_sync_error: errorMessage || null,
    })
    .eq('id', context.event.id)
}

export async function syncGolfGeniusEvent(eventIdOrPortalId: string) {
  const supabase = createServiceClient()
  const event = await resolveEvent(supabase, eventIdOrPortalId)
  const externalEventId = event.golf_genius_event_id || event.golf_genius_portal_id

  if (!externalEventId) {
    throw new Error('Add a Golf Genius event or portal id before syncing this event.')
  }

  const { data: syncRun, error: syncRunError } = await supabase
    .from('external_sync_runs')
    .insert({
      provider: PROVIDER,
      entity_type: 'igc_event',
      entity_id: event.id,
      external_id: externalEventId,
      status: 'running',
    })
    .select('id')
    .single()

  if (syncRunError) throw syncRunError

  const context: SyncContext = {
    supabase,
    event,
    syncRunId: syncRun.id,
    externalEventId,
  }

  const summary = {
    rawPayloads: 0,
    players: 0,
    rounds: 0,
    teeTimes: 0,
    pairings: 0,
    leaderboardSnapshots: 0,
  }

  try {
    const eventMetadata = await fetchAndStore(context, `/events/${externalEventId}`)
    summary.rawPayloads += 1

    if (eventMetadata.ok) {
      const updatePayload = normalizeEventUpdate(eventMetadata.payload, externalEventId)
      await supabase.from('igc_events').update(updatePayload).eq('id', event.id)
    }

    const rosterResult = await fetchPagedRows(context, `/events/${externalEventId}/roster`, ['roster', 'members', 'players', 'data', 'rows'])
    summary.rawPayloads += rosterResult.payloads.length
    summary.players = await upsertPlayers(context, rosterResult.rows)

    const roundsPayload = await fetchAndStore(context, `/events/${externalEventId}/rounds`)
    summary.rawPayloads += 1
    const roundRows = roundsPayload.ok ? getRows(roundsPayload.payload, ['rounds', 'event_rounds', 'data', 'rows']) : []
    const normalizedRounds = normalizeRounds(event, roundRows)
    const rounds = await upsertRounds(context, normalizedRounds)
    summary.rounds = rounds.length

    const roundsOrEvent = rounds.length > 0 ? rounds : [null]

    for (const round of roundsOrEvent) {
      const teeSheetEndpoint = round
        ? `/events/${externalEventId}/rounds/${round.externalRoundId}/tee_sheet`
        : `/events/${externalEventId}/tee_sheet`
      const teeSheetPayload = await fetchAndStore(context, teeSheetEndpoint)
      summary.rawPayloads += 1

      if (teeSheetPayload.ok) {
        const teeTimes = normalizeTeeTimes({
          event,
          round,
          rows: getTeeSheetRows(teeSheetPayload.payload),
        })
        const teeTimeResult = await upsertTeeTimes(context, round, teeTimes)
        summary.teeTimes += teeTimeResult.teeTimeCount
        summary.pairings += teeTimeResult.pairingCount
      }

      const leaderboardEndpoint = round
        ? `/events/${externalEventId}/rounds/${round.externalRoundId}/leaderboard`
        : `/events/${externalEventId}/leaderboard`
      const leaderboardPayload = await fetchAndStore(context, leaderboardEndpoint)
      summary.rawPayloads += 1
      summary.leaderboardSnapshots += await storeLeaderboardSnapshot({
        context,
        round,
        sourcePayload: leaderboardPayload,
        leaderboardType: 'leaderboard',
      })

      const resultsEndpoint = round
        ? `/events/${externalEventId}/rounds/${round.externalRoundId}/results`
        : `/events/${externalEventId}/results`
      const resultsPayload = await fetchAndStore(context, resultsEndpoint)
      summary.rawPayloads += 1
      summary.leaderboardSnapshots += await storeLeaderboardSnapshot({
        context,
        round,
        sourcePayload: resultsPayload,
        leaderboardType: 'results',
      })
    }

    await insertFeedEvent(context, {
      type: 'sync_completed',
      title: 'Golf Genius sync completed',
      body: `${summary.players} players, ${summary.teeTimes} tee times, and ${summary.leaderboardSnapshots} leaderboard snapshots imported.`,
      dedupeKey: `sync:${context.syncRunId}`,
      metadata: summary,
    })

    await completeSyncRun(context, 'success', summary)
    return summary
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Golf Genius sync failed'
    await completeSyncRun(context, 'failed', summary, message)
    throw error
  }
}
