// Pure, client-safe helpers for the activity inbox: human copy, relative time,
// deep-link, unread derivation, the realtime refresh decision, and the
// mark-seen cursor. No server imports, no Supabase, no React — so the decision
// logic is unit-testable with `node --test` (Node 24 strips TS types).
//
// The authoritative activity rows live in planit.golf Supabase (activity_events).
// These helpers only shape/derive from row data already fetched or delivered
// via Realtime; they hold no state.

export const ACTIVITY_FEATURE = 'seattle_cup_scouting'

export type ActivityType =
  | 'note_added'
  | 'candidate_state_changed'
  | 'availability_changed'

// The row shape used by the inbox. `metadata` is the structured render-hint
// object stored alongside the event (see migration 025).
export interface ActivityEvent {
  id: string
  createdAt: string
  actorUserId: string
  actorDisplayName: string
  feature: string
  activityType: ActivityType
  subjectPlayerId: string | null
  subjectPlayerName: string | null
  metadata: Record<string, unknown>
}

// V1 is Seattle Cup scouting only. The API hardcodes this feature rather than
// accepting an arbitrary query param, and these copy helpers assume scouting.
const SCOUTING_PREFIX = '/igc/seattle-cup/scouting'
const BOARD_PATH = SCOUTING_PREFIX
const PLAYER_DETAIL_PREFIX = `${SCOUTING_PREFIX}/players/`

const STATE_LABELS: Record<string, string> = {
  considering: 'Considering',
  out: 'Out',
  selected: 'Selected',
}

// First name for the inbox line: the first token of the display name, falling
// back to a generic "Someone" so the copy is never empty or a raw id/email.
export function actorFirstName(displayName: string | null | undefined): string {
  const n = (displayName ?? '').trim()
  if (!n) return 'Someone'
  return n.split(/\s+/)[0]
}

function playerName(ev: ActivityEvent): string {
  return ev.subjectPlayerName?.trim() || 'a player'
}

// Possessive form for the availability copy: "Hans Olson's Fourball availability".
function possessive(name: string): string {
  if (name.endsWith('s')) return `${name}'`
  return `${name}'s`
}

function metaString(ev: ActivityEvent, key: string): string | undefined {
  const v = ev.metadata?.[key]
  return typeof v === 'string' ? v : undefined
}

// Human inbox line for one event, e.g.:
//   "Noah added a note to Hans Olson"
//   "Josh marked Paul Payton Selected"
//   "Noah updated Maxwell Stejskal's Fourball availability"
// Never exposes raw enum names / uuids / field names beyond the human state label.
export function formatActivityLine(ev: ActivityEvent): string {
  const actor = actorFirstName(ev.actorDisplayName)
  const who = playerName(ev)
  switch (ev.activityType) {
    case 'note_added':
      return `${actor} added a note to ${who}`
    case 'candidate_state_changed': {
      const to = metaString(ev, 'to_state')
      const label = to ? STATE_LABELS[to] : undefined
      return label
        ? `${actor} marked ${who} ${label}`
        : `${actor} changed ${possessive(who)} state`
    }
    case 'availability_changed': {
      const session = metaString(ev, 'session_label') || 'session'
      return `${actor} updated ${possessive(who)} ${session} availability`
    }
    default:
      return `${actor} updated ${who}`
  }
}

// Deep-link to the affected player's scouting profile, or null if the event has
// no player subject (none in V1).
export function buildDeepLink(ev: ActivityEvent): string | null {
  if (!ev.subjectPlayerId) return null
  return `${PLAYER_DETAIL_PREFIX}${ev.subjectPlayerId}`
}

// Relative timestamp for the inbox: "just now", "2m ago", "8h ago", "3d ago",
// then a plain date once it's older than a week. `nowMs` is passed in (not
// Date.now()) so the helper is deterministic in tests.
export function formatRelativeTime(iso: string, nowMs: number): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const diffMs = nowMs - t
  if (diffMs < 0) return 'just now'
  const sec = Math.floor(diffMs / 1000)
  if (sec < 60) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d ago`
  const d = new Date(t)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

// Unread count over a fetched window: events newer than the boundary. With no
// boundary (null), all events are unread (per the V1 initial behavior — a user
// with no read-state row sees recent activity as unread).
export function deriveUnread(events: ActivityEvent[], lastSeenAt: string | null): number {
  if (!lastSeenAt) return events.length
  const boundary = Date.parse(lastSeenAt)
  if (Number.isNaN(boundary)) return events.length
  return events.filter((e) => Date.parse(e.createdAt) > boundary).length
}

// The cursor to mark "seen up to": the newest event present when the inbox
// opened. Marking seen with this (rather than now()) means an event arriving
// while the inbox is open — which was not part of the opened snapshot — stays
// unread. Null when there are no events (nothing to mark).
export function markSeenCursor(events: ActivityEvent[]): string | null {
  if (events.length === 0) return null
  let newest = events[0].createdAt
  for (const e of events) {
    if (Date.parse(e.createdAt) > Date.parse(newest)) newest = e.createdAt
  }
  return newest
}

// Decision for a Realtime INSERT of `ev` arriving at a viewer on `pathname`
// (who is `myUserId`):
//   - the actor's OWN event is ignored entirely (no unread bump, no refresh):
//     their optimistic UI already reflects their mutation;
//   - on the scouting board: bump unread + refresh so shared state becomes current;
//   - on a player detail: bump unread; refresh ONLY if the event is for the
//     player currently open;
//   - anywhere else: bump unread only.
export function decideRealtimeAction(
  ev: { actorUserId: string; subjectPlayerId: string | null },
  pathname: string,
  myUserId: string
): { bumpUnread: boolean; refresh: boolean } {
  if (ev.actorUserId === myUserId) return { bumpUnread: false, refresh: false }
  if (pathname === BOARD_PATH) return { bumpUnread: true, refresh: true }
  if (pathname.startsWith(PLAYER_DETAIL_PREFIX)) {
    const openId = decodeURIComponent(pathname.slice(PLAYER_DETAIL_PREFIX.length).split('/')[0] || '')
    return { bumpUnread: true, refresh: openId === ev.subjectPlayerId }
  }
  return { bumpUnread: true, refresh: false }
}

// ---------------------------------------------------------------------------
// Activity coalescing / grouping (presentation only).
//
// Durable activity_events rows remain individual + immutable; every scouting
// mutation still produces its own row (see lib/activity.ts). Grouping is a
// READ/PRESENTATION concern applied client-side, so a rapid editing burst by
// one captain on one player shows as ONE inbox item instead of a raw stream.
//
// Group identity uses stable ids — actor_user_id + subject_player_id + feature
// — plus a time window. Display names are presentation only and never determine
// grouping. Read state stays RAW-event-based (markSeenCursor / deriveUnread
// above operate on raw events), so grouping can never mark a future event read.

// Default interaction window: events within ~30s chain into one group. Tuned
// for a human editing burst (several availability clicks over a few seconds);
// work minutes apart stays separate.
export const GROUP_WINDOW_MS = 30_000

export interface GroupedActivity {
  // Stable key: the OLDEST event id in the group. Older events only ever append
  // to the tail of a newest-first group, so this id is stable when a newer
  // event later joins the head (realtime coalescing) — React keys stay stable.
  id: string
  // Newest-first. The first element is the newest (and is the group's
  // effective timestamp / position).
  events: ActivityEvent[]
  actorUserId: string
  subjectPlayerId: string | null
  feature: string
  newestTime: string
}

// Canonical Seattle Cup session order (as the board renders them). Session
// labels are sorted this way in the grouped subline so "Fourball · Chapman ·
// Singles" reads naturally regardless of edit order. Unknown labels sort after
// the known ones, alphabetically.
const SESSION_ORDER = ['Fourball', 'Scramble', 'Chapman', 'Singles']
function sessionRank(label: string): number {
  const i = SESSION_ORDER.indexOf(label)
  if (i >= 0) return i
  return SESSION_ORDER.length + label.toLowerCase().charCodeAt(0)
}

// Group raw events (expected NEWEST-FIRST) into bursts. Events chain into the
// same group when the immediately-preceding event (the next-newer one in the
// list) is the same actor + player + feature AND within GROUP_WINDOW_MS. This
// consecutive-pair chaining means a burst spanning longer than the window can
// stay one group as long as each adjacent pair is within the window, while a
// gap larger than the window splits two bursts. Groups are returned newest-
// first (the group containing the newest event is first), and each group's
// newestTime is its newest contained event so an actively-changing player stays
// positioned at the top.
export function groupActivities(
  events: ActivityEvent[],
  windowMs: number = GROUP_WINDOW_MS
): GroupedActivity[] {
  const groups: GroupedActivity[] = []
  for (const e of events) {
    const last = groups[groups.length - 1]
    if (
      last &&
      last.actorUserId === e.actorUserId &&
      last.subjectPlayerId === e.subjectPlayerId &&
      last.feature === e.feature
    ) {
      const prev = last.events[last.events.length - 1] // immediately-preceding (newer) event
      const gap = Date.parse(prev.createdAt) - Date.parse(e.createdAt)
      if (Number.isFinite(gap) && gap <= windowMs) {
        // e is older; append to the group tail. newestTime (head) is unchanged.
        last.events.push(e)
        last.id = e.id // tail = oldest so far; stable under later head prepends
        continue
      }
    }
    groups.push({
      id: e.id,
      events: [e],
      actorUserId: e.actorUserId,
      subjectPlayerId: e.subjectPlayerId,
      feature: e.feature,
      newestTime: e.createdAt,
    })
  }
  return groups
}

function distinctSessionLabels(events: ActivityEvent[]): string[] {
  const seen = new Set<string>()
  for (const e of events) {
    if (e.activityType !== 'availability_changed') continue
    const label = metaString(e, 'session_label')
    if (label) seen.add(label)
  }
  return [...seen].sort((a, b) => sessionRank(a) - sessionRank(b))
}

// The inbox copy for a grouped item. A single-event group keeps the standalone
// line (e.g. "Noah added a note to Hans Olson"), preserving note prominence. A
// multi-event group renders a concise player-level line plus a subline of the
// affected aspects:
//   all-availability: "Noah updated Joe's availability" / "Fourball · Chapman · Singles"
//   mixed:            "Noah updated Joe" / "Added a note · Candidate state · Fourball"
export interface GroupedItemView {
  id: string
  line: string
  sub: string | null
  href: string | null
  newestTime: string
  count: number
}

export function formatGroupedItem(g: GroupedActivity): GroupedItemView {
  const newest = g.events[0]
  const href = buildDeepLink(newest)
  if (g.events.length === 1) {
    return { id: g.id, line: formatActivityLine(newest), sub: null, href, newestTime: g.newestTime, count: 1 }
  }
  const actor = actorFirstName(newest.actorDisplayName)
  const who = playerName(newest)
  const types = new Set(g.events.map((e) => e.activityType))
  const sessions = distinctSessionLabels(g.events)

  if (types.size === 1 && types.has('availability_changed')) {
    return {
      id: g.id,
      line: `${actor} updated ${possessive(who)} availability`,
      sub: sessions.length > 0 ? sessions.join(' · ') : null,
      href,
      newestTime: g.newestTime,
      count: g.events.length,
    }
  }

  // Mixed burst: chips for the non-availability kinds first, then sessions.
  const chips: string[] = []
  if (types.has('note_added')) chips.push('Added a note')
  if (types.has('candidate_state_changed')) chips.push('Candidate state')
  chips.push(...sessions)
  return {
    id: g.id,
    line: `${actor} updated ${who}`,
    sub: chips.length > 0 ? chips.join(' · ') : null,
    href,
    newestTime: g.newestTime,
    count: g.events.length,
  }
}