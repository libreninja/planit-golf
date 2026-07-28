'use client'

// The activity inbox control for the authenticated app shell. A compact bell in
// the top bar with an unread indicator; clicking opens a popover listing recent
// Seattle Cup scouting activity newest-first (actor + action + player + relative
// time). Clicking an item deep-links to that player's scouting profile. Opening
// the inbox marks the currently-represented snapshot as seen (up to the newest
// event present at open time, so an event arriving mid-open stays unread).
//
// A Supabase Realtime postgres_changes subscription on activity_events drives
// the unread bump and a scoped router.refresh(): the actor's OWN events are
// ignored (their optimistic UI already reflects their mutation); another
// captain's event bumps unread and refreshes the board, or the matching player
// detail. The browser talks only to the planit.golf Supabase project — never to
// planit-ai. See migration 025 + lib/activity-format (decideRealtimeAction).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Bell } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import {
  ACTIVITY_FEATURE,
  decideRealtimeAction,
  formatRelativeTime,
  groupActivities,
  formatGroupedItem,
  markSeenCursor,
  type ActivityEvent,
} from '@/lib/activity-format'

interface ServerItem {
  id: string
  created_at: string
  actor_user_id: string
  actor_display_name: string
  feature: string
  activity_type: ActivityEvent['activityType']
  subject_player_id: string | null
  subject_player_name: string | null
  metadata: Record<string, unknown>
}

function mapItem(r: ServerItem): ActivityEvent {
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

export function ActivityInbox({ userId }: { userId: string }) {
  const router = useRouter()
  const pathname = usePathname() || '/'
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<ActivityEvent[]>([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(true)
  const [nowTick, setNowTick] = useState(() => Date.now())
  // Track the cursor we marked seen up to, so a realtime event arriving while
  // the inbox is open is correctly counted as new/unread (created_at > cursor).
  const seenCursorRef = useRef<string | null>(null)
  // Independent leading-edge throttle for router.refresh(). A rapid burst (e.g.
  // a batch availability save emits several activity rows near-simultaneously)
  // would otherwise fire one server refetch per row. The first event refreshes
  // immediately; further refreshes within the throttle window are suppressed.
  // This is deliberately separate from activity grouping (which is purely a
  // presentation concern over the already-fetched rows).
  const lastRefreshRef = useRef(0)
  const maybeRefresh = useCallback(() => {
    const t = Date.now()
    if (t - lastRefreshRef.current >= 500) {
      lastRefreshRef.current = t
      router.refresh()
    }
  }, [router])
  // Group raw events into editing bursts for presentation only. `items` stays
  // the raw newest-first list (read state + cursor are computed from it); the
  // rendered list is the grouped view.
  const groups = useMemo(() => groupActivities(items), [items])

  // Initial fetch: recent activity + authoritative unread count.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/activity', { cache: 'no-store' })
        if (!res.ok) return
        const data = (await res.json()) as { items?: ServerItem[]; unreadCount?: number }
        if (cancelled) return
        setItems((data.items ?? []).map(mapItem))
        setUnread(data.unreadCount ?? 0)
      } catch {
        // Inbox is non-critical; a failed fetch just leaves it empty.
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Realtime subscription: bump unread + scoped refresh on OTHER captains'
  // activity. Own events are ignored entirely.
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('scouting-activity')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'activity_events', filter: `feature=eq.${ACTIVITY_FEATURE}` },
        (payload) => {
          const row = payload.new as ServerItem
          const ev = mapItem(row)
          const action = decideRealtimeAction(
            { actorUserId: ev.actorUserId, subjectPlayerId: ev.subjectPlayerId },
            pathname,
            userId
          )
          if (!action.bumpUnread) return // own event: ignore
          // Prepend the RAW event (newest-first). groupActivities (memoized on
          // items) coalesces it into the existing visible item when it belongs
          // to the same burst, so the visible list doesn't gain a new row per
          // edit — only when it's a genuinely separate burst.
          setItems((prev) => [ev, ...prev].slice(0, 40))
          setUnread((c) => c + 1)
          if (action.refresh) maybeRefresh()
        }
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [pathname, maybeRefresh, userId])

  // Nudge relative timestamps while the popover is open.
  useEffect(() => {
    if (!open) return
    const t = setInterval(() => setNowTick(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [open])

  async function handleOpen() {
    const next = !open
    setOpen(next)
    if (!next) return
    // Mark the opened snapshot as seen, up to its newest event (cursor). This
    // is the snapshot present at open — a new event arriving mid-open has
    // created_at > cursor and stays unread.
    const cursor = markSeenCursor(items)
    if (!cursor) return
    seenCursorRef.current = cursor
    try {
      const res = await fetch('/api/activity/read', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ seenAt: cursor }),
      })
      if (!res.ok) return
      const data = (await res.json()) as { unreadCount?: number }
      setUnread(data.unreadCount ?? 0)
    } catch {
      // Non-critical: the unread state will reconcile on next open/refresh.
    }
  }

  function handleItemClick(href: string | null) {
    setOpen(false)
    if (href) router.push(href)
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleOpen}
        aria-label="Activity"
        aria-expanded={open}
        className="relative flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span
            aria-label={`${unread} unread`}
            className="absolute -right-1 -top-1 inline-flex min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-none text-white"
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open ? (
        <>
          <button
            type="button"
            aria-label="Close activity"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            className="absolute right-0 top-full z-50 mt-1 w-80 max-w-[calc(100vw-2rem)] rounded-md border border-border bg-card p-1 shadow-md"
          >
            {loading ? (
              <div className="px-3 py-4 text-sm text-muted-foreground">Loading…</div>
            ) : items.length === 0 ? (
              <div className="px-3 py-4 text-sm text-muted-foreground">No recent activity.</div>
            ) : (
              <ul className="max-h-80 overflow-y-auto">
                {groups.map((g) => {
                  const view = formatGroupedItem(g)
                  return (
                    <li key={view.id}>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => handleItemClick(view.href)}
                        className="block w-full rounded-sm px-3 py-2 text-left text-sm hover:bg-muted"
                      >
                        <span className="block text-foreground">{view.line}</span>
                        {view.sub && <span className="mt-0.5 block text-xs text-muted-foreground">{view.sub}</span>}
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {formatRelativeTime(view.newestTime, nowTick)}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </>
      ) : null}
    </div>
  )
}