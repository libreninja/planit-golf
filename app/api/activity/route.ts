// GET /api/activity — recent Seattle Cup scouting activity + unread count, for
// the authenticated captain's inbox. V1 hardcodes the seattle_cup_scouting
// feature (no arbitrary feature query is exposed) and is scouting-entitlement
// gated. Returns the newest 20 events newest-first plus the authoritative
// unread count over ALL scouting activity (created_at > last_seen_at).
import { NextResponse } from 'next/server'
import { getUser } from '@/lib/auth'
import { hasScoutingAccess, SCOUTING_FEATURE_KEY } from '@/lib/scouting-access'
import { createClient } from '@/lib/supabase/server'
import type { ActivityEvent, ActivityType } from '@/lib/activity-format'

export const dynamic = 'force-dynamic'

interface ActivityRow {
  id: string
  created_at: string
  actor_user_id: string
  actor_display_name: string
  feature: string
  activity_type: ActivityType
  subject_player_id: string | null
  subject_player_name: string | null
  metadata: Record<string, unknown>
}

function mapRow(r: ActivityRow): ActivityEvent {
  return {
    id: r.id,
    createdAt: r.created_at,
    actorUserId: r.actor_user_id,
    actorDisplayName: r.actor_display_name,
    feature: r.feature,
    activityType: r.activity_type,
    subjectPlayerId: r.subject_player_id,
    subjectPlayerName: r.subject_player_name,
    metadata: r.metadata ?? {},
  }
}

export async function GET() {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!(await hasScoutingAccess(user.id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const supabase = await createClient()

  const [{ data: rows, error }, { data: readState }] = await Promise.all([
    supabase
      .from('activity_events')
      .select('id, created_at, actor_user_id, actor_display_name, feature, activity_type, subject_player_id, subject_player_name, metadata')
      .eq('feature', SCOUTING_FEATURE_KEY)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('activity_read_state')
      .select('last_seen_at')
      .eq('user_id', user.id)
      .eq('feature', SCOUTING_FEATURE_KEY)
      .maybeSingle(),
  ])

  if (error) {
    console.error('[activity] GET recent failed:', error.message)
    return NextResponse.json({ error: 'query_failed' }, { status: 500 })
  }

  const lastSeenAt: string | null = (readState?.last_seen_at as string | undefined) ?? null

  // Authoritative unread count over ALL scouting activity (not just the 20-row
  // window). With no read-state row, every event is unread.
  let unreadCount = 0
  let countQuery = supabase
    .from('activity_events')
    .select('id', { count: 'exact', head: true })
    .eq('feature', SCOUTING_FEATURE_KEY)
  if (lastSeenAt) countQuery = countQuery.gt('created_at', lastSeenAt)
  const { count, error: countError } = await countQuery
  if (countError) {
    console.error('[activity] GET count failed:', countError.message)
  } else {
    unreadCount = count ?? 0
  }

  return NextResponse.json({
    items: (rows as ActivityRow[] | null ?? []).map(mapRow),
    unreadCount,
    lastSeenAt,
  })
}