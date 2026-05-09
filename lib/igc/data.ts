import 'server-only'

import { unstable_noStore as noStore } from 'next/cache'

import { createServiceClient } from '@/lib/supabase/service'

export type IgcCommunity = {
  id: string
  slug: string
  name: string
  short_name: string | null
  description: string | null
}

export type IgcEventSummary = {
  id: string
  slug: string
  name: string
  description: string | null
  location_name: string | null
  starts_on: string | null
  ends_on: string | null
  status: string
  golf_genius_portal_url: string | null
  last_synced_at: string | null
  last_sync_status: string | null
}

export type IgcPlayer = {
  id: string
  display_name: string
  handicap_index: number | null
}

export type IgcRound = {
  id: string
  external_round_id: string
  name: string
  round_number: number | null
  course_name: string | null
  starts_on: string | null
  status: string | null
}

export type IgcPairing = {
  id: string
  tee_time_id: string | null
  round_id: string | null
  player_name: string
  team_name: string | null
  display_order: number
}

export type IgcTeeTime = {
  id: string
  round_id: string | null
  tee_time_label: string | null
  starts_at: string | null
  tee: string | null
  group_name: string | null
  display_order: number
  pairings: IgcPairing[]
}

export type IgcLeaderboardRow = {
  externalId?: string
  name?: string
  position?: string
  rankSort?: number | null
  score?: string | null
  today?: string | null
  thru?: string | null
  movement?: string | null
}

export type IgcLeaderboardSnapshot = {
  id: string
  round_id: string | null
  leaderboard_type: string
  snapshot_at: string
  rows: IgcLeaderboardRow[]
  summary: Record<string, unknown>
}

export type IgcFeedEvent = {
  id: string
  type: string
  title: string
  body: string | null
  occurred_at: string
  metadata: Record<string, unknown>
}

export type IgcSyncRun = {
  id: string
  status: string
  started_at: string
  completed_at: string | null
  error_message: string | null
  summary: Record<string, unknown>
}

export type IgcEventHubData = {
  setupRequired: boolean
  community: IgcCommunity | null
  event: IgcEventSummary | null
  players: IgcPlayer[]
  rounds: IgcRound[]
  teeTimes: IgcTeeTime[]
  leaderboardSnapshots: IgcLeaderboardSnapshot[]
  feedEvents: IgcFeedEvent[]
  syncRuns: IgcSyncRun[]
  logistics: Record<string, unknown>
}

function isMissingTableError(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const maybeError = error as { code?: string; message?: string }
  return maybeError.code === 'PGRST205' || Boolean(maybeError.message?.includes('schema cache'))
}

function emptyHubData(setupRequired = false): IgcEventHubData {
  return {
    setupRequired,
    community: null,
    event: null,
    players: [],
    rounds: [],
    teeTimes: [],
    leaderboardSnapshots: [],
    feedEvents: [],
    syncRuns: [],
    logistics: {},
  }
}

export async function getIgcEventsIndex() {
  noStore()
  const supabase = createServiceClient()

  const { data: community, error: communityError } = await supabase
    .from('communities')
    .select('id, slug, name, short_name, description')
    .eq('slug', 'interbay-golf-club')
    .maybeSingle()

  if (isMissingTableError(communityError)) {
    return { setupRequired: true, community: null, events: [] as IgcEventSummary[] }
  }
  if (communityError) throw communityError

  const { data: events, error: eventsError } = await supabase
    .from('igc_events')
    .select('id, slug, name, description, location_name, starts_on, ends_on, status, golf_genius_portal_url, last_synced_at, last_sync_status')
    .eq('community_id', community?.id || '')
    .order('starts_on', { ascending: true, nullsFirst: false })

  if (eventsError) throw eventsError

  return {
    setupRequired: false,
    community: community as IgcCommunity | null,
    events: (events || []) as IgcEventSummary[],
  }
}

function normalizeRows(value: unknown): IgcLeaderboardRow[] {
  return Array.isArray(value) ? (value as IgcLeaderboardRow[]) : []
}

function normalizeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export async function getIgcEventHubData(eventSlug: string): Promise<IgcEventHubData> {
  noStore()
  const supabase = createServiceClient()

  const { data: event, error: eventError } = await supabase
    .from('igc_events')
    .select(`
      id,
      slug,
      name,
      description,
      location_name,
      starts_on,
      ends_on,
      status,
      golf_genius_portal_url,
      last_synced_at,
      last_sync_status,
      logistics,
      community:communities (
        id,
        slug,
        name,
        short_name,
        description
      )
    `)
    .eq('slug', eventSlug)
    .maybeSingle()

  if (isMissingTableError(eventError)) return emptyHubData(true)
  if (eventError) throw eventError
  if (!event) return emptyHubData()

  const eventId = event.id as string

  const [
    playersResult,
    roundsResult,
    teeTimesResult,
    pairingsResult,
    snapshotsResult,
    feedResult,
    syncRunsResult,
  ] = await Promise.all([
    supabase
      .from('igc_players')
      .select('id, display_name, handicap_index')
      .eq('event_id', eventId)
      .order('display_name', { ascending: true }),
    supabase
      .from('igc_rounds')
      .select('id, external_round_id, name, round_number, course_name, starts_on, status')
      .eq('event_id', eventId)
      .order('round_number', { ascending: true, nullsFirst: false }),
    supabase
      .from('igc_tee_times')
      .select('id, round_id, tee_time_label, starts_at, tee, group_name, display_order')
      .eq('event_id', eventId)
      .order('display_order', { ascending: true }),
    supabase
      .from('igc_pairings')
      .select('id, tee_time_id, round_id, player_name, team_name, display_order')
      .eq('event_id', eventId)
      .order('display_order', { ascending: true }),
    supabase
      .from('igc_leaderboard_snapshots')
      .select('id, round_id, leaderboard_type, snapshot_at, rows, summary')
      .eq('event_id', eventId)
      .order('snapshot_at', { ascending: false })
      .limit(12),
    supabase
      .from('igc_feed_events')
      .select('id, type, title, body, occurred_at, metadata')
      .eq('event_id', eventId)
      .order('occurred_at', { ascending: false })
      .limit(25),
    supabase
      .from('external_sync_runs')
      .select('id, status, started_at, completed_at, error_message, summary')
      .eq('provider', 'golf_genius')
      .eq('entity_type', 'igc_event')
      .eq('entity_id', eventId)
      .order('started_at', { ascending: false })
      .limit(5),
  ])

  for (const result of [
    playersResult,
    roundsResult,
    teeTimesResult,
    pairingsResult,
    snapshotsResult,
    feedResult,
    syncRunsResult,
  ]) {
    if (result.error) throw result.error
  }

  const pairingsByTeeTimeId = new Map<string, IgcPairing[]>()
  for (const pairing of (pairingsResult.data || []) as IgcPairing[]) {
    if (!pairing.tee_time_id) continue
    const rows = pairingsByTeeTimeId.get(pairing.tee_time_id) || []
    rows.push(pairing)
    pairingsByTeeTimeId.set(pairing.tee_time_id, rows)
  }

  const teeTimes = ((teeTimesResult.data || []) as Omit<IgcTeeTime, 'pairings'>[]).map((teeTime) => ({
    ...teeTime,
    pairings: pairingsByTeeTimeId.get(teeTime.id) || [],
  }))

  return {
    setupRequired: false,
    community: (Array.isArray(event.community) ? event.community[0] : event.community) as IgcCommunity | null,
    event: {
      id: event.id,
      slug: event.slug,
      name: event.name,
      description: event.description,
      location_name: event.location_name,
      starts_on: event.starts_on,
      ends_on: event.ends_on,
      status: event.status,
      golf_genius_portal_url: event.golf_genius_portal_url,
      last_synced_at: event.last_synced_at,
      last_sync_status: event.last_sync_status,
    },
    players: (playersResult.data || []) as IgcPlayer[],
    rounds: (roundsResult.data || []) as IgcRound[],
    teeTimes,
    leaderboardSnapshots: ((snapshotsResult.data || []) as any[]).map((snapshot) => ({
      id: snapshot.id,
      round_id: snapshot.round_id,
      leaderboard_type: snapshot.leaderboard_type,
      snapshot_at: snapshot.snapshot_at,
      rows: normalizeRows(snapshot.rows),
      summary: normalizeObject(snapshot.summary),
    })),
    feedEvents: ((feedResult.data || []) as any[]).map((feedEvent) => ({
      ...feedEvent,
      metadata: normalizeObject(feedEvent.metadata),
    })) as IgcFeedEvent[],
    syncRuns: ((syncRunsResult.data || []) as any[]).map((syncRun) => ({
      ...syncRun,
      summary: normalizeObject(syncRun.summary),
    })) as IgcSyncRun[],
    logistics: normalizeObject(event.logistics),
  }
}
