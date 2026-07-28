// POST /api/activity/read — mark the current Seattle Cup scouting activity
// snapshot as seen. The body carries `seenAt`: the created_at of the NEWEST
// event present when the inbox opened (computed client-side via markSeenCursor).
// Marking seen up to that cursor — rather than "now" — means an event arriving
// while the inbox is open (which was NOT part of the opened snapshot) stays
// unread, avoiding the race where new activity is accidentally cleared before
// the user saw it. `seenAt` is clamped to now() so a stale/future cursor can
// never mark not-yet-arrived events as read. Entitlement-gated; V1 hardcodes the
// seattle_cup_scouting feature.
import { NextResponse } from 'next/server'
import { getUser } from '@/lib/auth'
import { hasScoutingAccess, SCOUTING_FEATURE_KEY } from '@/lib/scouting-access'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!(await hasScoutingAccess(user.id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  let bodySeenAt: unknown = undefined
  try {
    const body = (await request.json()) as { seenAt?: unknown }
    bodySeenAt = body?.seenAt
  } catch {
    // empty / non-JSON body is fine — fall through to the default below
  }

  const now = Date.now()
  let seenAtMs = now
  if (typeof bodySeenAt === 'string') {
    const parsed = Date.parse(bodySeenAt)
    if (!Number.isNaN(parsed)) seenAtMs = parsed
  }
  // Clamp to now: never mark events read that haven't happened yet.
  if (seenAtMs > now) seenAtMs = now
  const seenAtIso = new Date(seenAtMs).toISOString()

  const supabase = await createClient()

  // Upsert the per-user/per-feature boundary. RLS allows a user to write only
  // their own row (INSERT + UPDATE policies on activity_read_state).
  const { error: upsertError } = await supabase
    .from('activity_read_state')
    .upsert(
      { user_id: user.id, feature: SCOUTING_FEATURE_KEY, last_seen_at: seenAtIso },
      { onConflict: 'user_id,feature' }
    )
  if (upsertError) {
    console.error('[activity] mark-seen upsert failed:', upsertError.message)
    return NextResponse.json({ error: 'write_failed' }, { status: 500 })
  }

  // New unread count = events strictly newer than the cursor we just set.
  const { count, error: countError } = await supabase
    .from('activity_events')
    .select('id', { count: 'exact', head: true })
    .eq('feature', SCOUTING_FEATURE_KEY)
    .gt('created_at', seenAtIso)
  if (countError) {
    console.error('[activity] mark-seen count failed:', countError.message)
    return NextResponse.json({ error: 'count_failed' }, { status: 500 })
  }

  return NextResponse.json({ unreadCount: count ?? 0, lastSeenAt: seenAtIso })
}