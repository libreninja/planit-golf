import type { SupabaseClient } from '@supabase/supabase-js'
import { EventScoringError } from './scoring.ts'

export type GolfGeniusRoundPurpose = 'replay' | 'competition'
export type GolfGeniusScoreAuthority = 'planit' | 'golf_genius'

export interface GolfGeniusEventSnapshot {
  capturedAt: string
  event: {
    eventId: string
    portalId: string | null
    name: string
    startDate: string
    endDate: string
    locationName: string
    year: number
    seriesSlug: string
    seriesName: string
    editionSlug: string
  }
  roster: Array<{
    rosterId: string
    memberCardId: string
    displayName: string
  }>
  rounds: Array<{
    roundId: string
    number: number
    name: string
    date: string
    status: string
    purpose: GolfGeniusRoundPurpose
    countsTowardCompetition: boolean
    scoreAuthority: GolfGeniusScoreAuthority
    course: {
      courseId: string
      name: string
      holes: Array<{ hole: number; par: number }>
    }
    groups: Array<{
      groupId: string
      name: string
      teeTime: string
      startingHole: number
    }>
    participations: Array<{
      rosterId: string
      playerRoundId: string
      groupId: string | null
    }>
  }>
}

export interface GolfGeniusSyncReceipt {
  eventEditionId: string
  eventId: string
  golfersCreated: number
  golfersMatched: number
  participants: number
  rounds: number
  groups: number
  roundParticipations: number
  unassignedRoundParticipations: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function requireSnapshot(value: unknown): GolfGeniusEventSnapshot {
  if (!isRecord(value) || !isRecord(value.event) || !Array.isArray(value.roster)
    || !Array.isArray(value.rounds) || typeof value.event.eventId !== 'string'
    || !value.event.eventId || typeof value.event.seriesSlug !== 'string'
    || !value.event.seriesSlug || !Number.isInteger(value.event.year)) {
    throw new EventScoringError('22023', 'Invalid Golf Genius event snapshot')
  }
  return value as unknown as GolfGeniusEventSnapshot
}

// Convert the published local tee time to an absolute instant without making
// the database infer a time zone. Wine Valley is in Pacific time; Intl keeps
// this correct across daylight-saving transitions.
function localStart(date: string, time: string, timeZone = 'America/Los_Angeles') {
  const match = time.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
  if (!match) throw new EventScoringError('22023', `Invalid Golf Genius tee time: ${time}`)
  let hour = Number(match[1]) % 12
  if (match[3].toUpperCase() === 'PM') hour += 12
  const [year, month, day] = date.split('-').map(Number)
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, Number(match[2])))
  const zone = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' })
    .formatToParts(utcGuess).find((part) => part.type === 'timeZoneName')?.value
  const offset = zone?.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/)
  if (!offset) throw new EventScoringError('22023', `Unable to resolve time zone: ${timeZone}`)
  const minutes = (Number(offset[2]) * 60 + Number(offset[3] || 0)) * (offset[1] === '-' ? -1 : 1)
  return new Date(utcGuess.getTime() - minutes * 60_000).toISOString()
}

function prepareSnapshot(value: unknown) {
  const snapshot = requireSnapshot(value)
  return {
    ...snapshot,
    rounds: snapshot.rounds.map((round) => ({
      ...round,
      groups: round.groups.map((group) => ({
        ...group,
        startsAt: localStart(round.date, group.teeTime),
      })),
    })),
  }
}

export function createGolfGeniusEventSyncService(db: Pick<SupabaseClient, 'rpc'>) {
  return {
    async syncSnapshot(snapshot: unknown): Promise<GolfGeniusSyncReceipt> {
      const prepared = prepareSnapshot(snapshot)
      const { data, error } = await db.rpc('sync_event_from_golf_genius', { p_snapshot: prepared })
      if (error) throw new EventScoringError(error.code, error.message)
      if (!data) throw new EventScoringError('unavailable', 'Golf Genius sync returned no receipt')
      return data as GolfGeniusSyncReceipt
    },
  }
}
