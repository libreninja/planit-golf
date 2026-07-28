// Pure unit tests for the activity inbox decision/format logic. No network/db/
// auth — run with: `node --test tests/activity-format.test.ts`. Node 24 strips
// TS types natively, so no compiler or extra test dependency is required. The
// import uses a relative path (no `@/` alias) for the same reason.
//
// These cover the testable logic the approved plan lists: copy, deep-link,
// unread derivation, read-state cursor, own-vs-other refresh decision, and the
// player-detail-refresh-only-for-matching-player rule. The integration concerns
// (activity authoring after a real planit-ai write, activity-insert failure not
// breaking the scouting write, entitlement-gated reads over a live DB, and the
// realtime two-user flow) are validated by the manual two-session smoke (see
// the implementation report) — they require live Supabase + planit-ai and are
// not unit-testable here without fabricating a DB harness.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ACTIVITY_FEATURE,
  GROUP_WINDOW_MS,
  actorFirstName,
  buildDeepLink,
  decideRealtimeAction,
  deriveUnread,
  formatActivityLine,
  formatGroupedItem,
  formatRelativeTime,
  groupActivities,
  markSeenCursor,
  type ActivityEvent,
} from '../lib/activity-format.ts'

function ev(over: Partial<ActivityEvent> = {}): ActivityEvent {
  const base: ActivityEvent = {
    id: 'id-x',
    createdAt: '2026-07-28T12:00:00Z',
    actorUserId: 'noah-uid',
    actorDisplayName: 'Noah Benner',
    feature: ACTIVITY_FEATURE,
    activityType: 'note_added',
    subjectPlayerId: 'player-hans',
    subjectPlayerName: 'Hans Olson',
    metadata: {},
  }
  // Spread so an explicit null (e.g. subjectPlayerName: null) overrides the
  // default instead of being clobbered by a `?? default` fallback.
  return { ...base, ...over }
}

// ---- Activity copy (spec §11) -------------------------------------------------

test('note_added -> "Noah added a note to Hans Olson"', () => {
  assert.equal(formatActivityLine(ev({ activityType: 'note_added' })), 'Noah added a note to Hans Olson')
})

test('candidate_state_changed to selected -> "Josh marked Paul Payton Selected"', () => {
  assert.equal(
    formatActivityLine(
      ev({
        actorDisplayName: 'Josh Benner',
        subjectPlayerName: 'Paul Payton',
        activityType: 'candidate_state_changed',
        metadata: { from_state: 'considering', to_state: 'selected' },
      })
    ),
    'Josh marked Paul Payton Selected'
  )
})

test('candidate_state_changed to out uses the Out label', () => {
  assert.equal(
    formatActivityLine(ev({ activityType: 'candidate_state_changed', metadata: { to_state: 'out' } })),
    'Noah marked Hans Olson Out'
  )
})

test('availability_changed -> "Noah updated Maxwell Stejskal\'s Fourball availability"', () => {
  assert.equal(
    formatActivityLine(
      ev({
        subjectPlayerName: 'Maxwell Stejskal',
        activityType: 'availability_changed',
        metadata: { session_id: 's1', session_label: 'Fourball', status: 'fully_available' },
      })
    ),
    "Noah updated Maxwell Stejskal's Fourball availability"
  )
})

test('availability_changed with no session_label falls back to "session"', () => {
  assert.equal(
    formatActivityLine(ev({ activityType: 'availability_changed', metadata: {} })),
    "Noah updated Hans Olson's session availability"
  )
})

test('copy never leaks raw enum/uuid; player name falls back to "a player" when missing', () => {
  const line = formatActivityLine(ev({ subjectPlayerName: null, activityType: 'note_added' }))
  assert.equal(line, 'Noah added a note to a player')
  assert.ok(!line.includes('player-hans'), 'subject_player_id must not appear in copy')
})

test('actorFirstName falls back to "Someone" when display name is empty', () => {
  assert.equal(actorFirstName(''), 'Someone')
  assert.equal(actorFirstName(null), 'Someone')
  assert.equal(actorFirstName('Josh Benner'), 'Josh')
})

// ---- Deep-link (spec §8) -----------------------------------------------------

test('buildDeepLink points at the player scouting profile', () => {
  assert.equal(buildDeepLink(ev()), '/igc/seattle-cup/scouting/players/player-hans')
})

test('buildDeepLink is null when there is no subject player', () => {
  assert.equal(buildDeepLink(ev({ subjectPlayerId: null })), null)
})

// ---- Relative time -----------------------------------------------------------

test('formatRelativeTime buckets correctly from a fixed now', () => {
  const now = Date.parse('2026-07-28T12:00:00Z')
  assert.equal(formatRelativeTime('2026-07-28T11:59:30Z', now), 'just now')
  assert.equal(formatRelativeTime('2026-07-28T11:58:00Z', now), '2m ago')
  assert.equal(formatRelativeTime('2026-07-28T04:00:00Z', now), '8h ago')
  assert.equal(formatRelativeTime('2026-07-25T12:00:00Z', now), '3d ago')
  assert.equal(formatRelativeTime('2026-06-01T12:00:00Z', now), '2026-06-01')
})

// ---- Read-state / unread (spec §2, §9) ---------------------------------------

test('deriveUnread with no boundary counts all events as unread (initial behavior)', () => {
  const events = [ev({ createdAt: '2026-07-28T12:00:00Z' }), ev({ createdAt: '2026-07-28T11:00:00Z' })]
  assert.equal(deriveUnread(events, null), 2)
})

test('deriveUnread counts only events newer than the boundary', () => {
  const events = [
    ev({ createdAt: '2026-07-28T12:00:00Z' }),
    ev({ createdAt: '2026-07-28T11:00:00Z' }),
    ev({ createdAt: '2026-07-28T10:00:00Z' }),
  ]
  assert.equal(deriveUnread(events, '2026-07-28T11:00:00Z'), 1) // only 12:00 is newer
  assert.equal(deriveUnread(events, '2026-07-28T12:00:00Z'), 0) // none strictly newer
})

test('markSeenCursor returns the newest event created_at (the snapshot boundary)', () => {
  const events = [
    ev({ id: 'a', createdAt: '2026-07-28T11:00:00Z' }),
    ev({ id: 'b', createdAt: '2026-07-28T12:00:00Z' }),
    ev({ id: 'c', createdAt: '2026-07-28T10:00:00Z' }),
  ]
  assert.equal(markSeenCursor(events), '2026-07-28T12:00:00Z')
})

test('markSeenCursor is null when there are no events (nothing to mark)', () => {
  assert.equal(markSeenCursor([]), null)
})

test('marking seen up to the snapshot cursor leaves a mid-open arrival unread', () => {
  // Snapshot at open: newest = 12:00. A new event arrives at 12:30 while open.
  const snapshot = [ev({ id: 'a', createdAt: '2026-07-28T12:00:00Z' })]
  const cursor = markSeenCursor(snapshot)
  assert.equal(cursor, '2026-07-28T12:00:00Z')
  const after = [ev({ id: 'a', createdAt: '2026-07-28T12:00:00Z' }), ev({ id: 'b', createdAt: '2026-07-28T12:30:00Z' })]
  assert.equal(deriveUnread(after, cursor), 1) // the 12:30 arrival stays unread
})

// ---- Realtime refresh decision (spec §10) ------------------------------------

const ME = 'me-uid'
const OTHER = 'noah-uid'

test('own event is ignored: no unread bump, no refresh', () => {
  const r = decideRealtimeAction({ actorUserId: ME, subjectPlayerId: 'p1' }, '/igc/seattle-cup/scouting', ME)
  assert.deepEqual(r, { bumpUnread: false, refresh: false })
})

test('other-user event on the board bumps unread AND refreshes', () => {
  const r = decideRealtimeAction({ actorUserId: OTHER, subjectPlayerId: 'p1' }, '/igc/seattle-cup/scouting', ME)
  assert.deepEqual(r, { bumpUnread: true, refresh: true })
})

test('other-user event on a matching player detail bumps unread AND refreshes', () => {
  const r = decideRealtimeAction(
    { actorUserId: OTHER, subjectPlayerId: 'p-hans' },
    '/igc/seattle-cup/scouting/players/p-hans',
    ME
  )
  assert.deepEqual(r, { bumpUnread: true, refresh: true })
})

test('other-user event on a NON-matching player detail bumps unread but does NOT refresh', () => {
  const r = decideRealtimeAction(
    { actorUserId: OTHER, subjectPlayerId: 'p-hans' },
    '/igc/seattle-cup/scouting/players/p-other',
    ME
  )
  assert.deepEqual(r, { bumpUnread: true, refresh: false })
})

test('other-user event elsewhere in PlanIt bumps unread only (no refresh/navigation)', () => {
  const r = decideRealtimeAction({ actorUserId: OTHER, subjectPlayerId: 'p1' }, '/igc/mens-league', ME)
  assert.deepEqual(r, { bumpUnread: true, refresh: false })
})

test('own event is ignored even on a matching player detail (optimistic UI already reflects it)', () => {
  const r = decideRealtimeAction(
    { actorUserId: ME, subjectPlayerId: 'p-hans' },
    '/igc/seattle-cup/scouting/players/p-hans',
    ME
  )
  assert.deepEqual(r, { bumpUnread: false, refresh: false })
})

// ---- Activity coalescing / grouping (presentation only) ----------------------
// Durable rows stay individual + immutable (asserted below); grouping is a
// presentation concern over the raw newest-first list.

const T0 = '2026-07-28T12:00:00Z'
const sec = (n: number) => new Date(Date.parse(T0) + n * 1000).toISOString()

function availEv(
  player: string,
  session: string,
  t: string,
  actor = 'noah-uid',
  actorName = 'Noah Benner'
): ActivityEvent {
  return ev({
    id: `${player}-${session}-${t}`,
    createdAt: t,
    actorUserId: actor,
    actorDisplayName: actorName,
    subjectPlayerId: player,
    subjectPlayerName: 'Joe Player',
    activityType: 'availability_changed',
    metadata: { session_id: 's-' + session, session_label: session, status: 'fully_available' },
  })
}
function candEv(player: string, to: string, t: string, actor = 'noah-uid'): ActivityEvent {
  return ev({
    id: `${player}-cand-${to}-${t}`,
    createdAt: t,
    actorUserId: actor,
    subjectPlayerId: player,
    subjectPlayerName: 'Joe Player',
    activityType: 'candidate_state_changed',
    metadata: { from_state: 'considering', to_state: to },
  })
}
function noteEv(player: string, t: string, actor = 'noah-uid'): ActivityEvent {
  return ev({
    id: `${player}-note-${t}`,
    createdAt: t,
    actorUserId: actor,
    subjectPlayerId: player,
    subjectPlayerName: 'Joe Player',
    activityType: 'note_added',
    metadata: { note_id: 'n1', preview: 'looks solid' },
  })
}

test('groupActivities: 4 rapid availability edits on the same player → one group', () => {
  // Newest-first (as the API returns). Edits 0/5/10/15s — all within the window.
  const events = [
    availEv('joe', 'Singles', sec(15)),
    availEv('joe', 'Scramble', sec(10)),
    availEv('joe', 'Chapman', sec(5)),
    availEv('joe', 'Fourball', sec(0)),
  ]
  const groups = groupActivities(events)
  assert.equal(groups.length, 1)
  assert.equal(groups[0].events.length, 4)
  assert.equal(groups[0].newestTime, sec(15))
})

test('grouped availability item lists the affected sessions in canonical order', () => {
  const events = [
    availEv('joe', 'Chapman', sec(10)),
    availEv('joe', 'Singles', sec(5)),
    availEv('joe', 'Fourball', sec(0)),
  ]
  const view = formatGroupedItem(groupActivities(events)[0])
  assert.equal(view.line, "Noah updated Joe Player's availability")
  assert.equal(view.sub, 'Fourball · Chapman · Singles')
})

test('availability + candidate-state in the same burst → one player-level item', () => {
  const events = [
    candEv('joe', 'selected', sec(12)),
    availEv('joe', 'Singles', sec(8)),
    availEv('joe', 'Fourball', sec(3)),
  ]
  const groups = groupActivities(events)
  assert.equal(groups.length, 1)
  const view = formatGroupedItem(groups[0])
  assert.equal(view.line, 'Noah updated Joe Player')
  assert.equal(view.sub, 'Candidate state · Fourball · Singles')
})

test('note + availability burst → "Added a note" keeps prominence in the subline', () => {
  const events = [noteEv('joe', sec(10)), availEv('joe', 'Singles', sec(5)), availEv('joe', 'Fourball', sec(0))]
  const view = formatGroupedItem(groupActivities(events)[0])
  assert.equal(view.line, 'Noah updated Joe Player')
  assert.equal(view.sub, 'Added a note · Fourball · Singles')
})

test('a standalone note is NOT forced into the grouped line (single-event group keeps its line)', () => {
  const view = formatGroupedItem(groupActivities([noteEv('hans', sec(0))])[0])
  assert.equal(view.line, 'Noah added a note to Joe Player')
  assert.equal(view.sub, null)
})

test('different players in the same window → separate items', () => {
  const events = [availEv('joe', 'Fourball', sec(5)), availEv('max', 'Fourball', sec(0))]
  const groups = groupActivities(events)
  assert.equal(groups.length, 2)
  assert.notEqual(groups[0].subjectPlayerId, groups[1].subjectPlayerId)
})

test('different actors editing the same player → separate items', () => {
  const events = [
    availEv('joe', 'Fourball', sec(5), 'noah-uid', 'Noah Benner'),
    availEv('joe', 'Fourball', sec(0), 'josh-uid', 'Josh Benner'),
  ]
  const groups = groupActivities(events)
  assert.equal(groups.length, 2)
  assert.notEqual(groups[0].actorUserId, groups[1].actorUserId)
})

test('events outside the grouping window → separate items', () => {
  // Same actor/player, but 40s apart (> 30s window).
  const events = [availEv('joe', 'Fourball', sec(40)), availEv('joe', 'Singles', sec(0))]
  const groups = groupActivities(events)
  assert.equal(groups.length, 2)
})

test('a burst longer than the window but with adjacent pairs inside it stays one group', () => {
  // 0, 20, 40s: each adjacent pair is 20s apart (<= window) → one chained group.
  const events = [availEv('joe', 'Singles', sec(40)), availEv('joe', 'Chapman', sec(20)), availEv('joe', 'Fourball', sec(0))]
  assert.equal(groupActivities(events).length, 1)
})

test('realtime coalescing: a subsequent groupable event updates the visible item, no new row', () => {
  // Simulate the inbox receiving events over time (newest prepended). After the
  // first event there is one visible item; a second event in the same burst
  // coalesces into it (still one group), updating line + sub.
  let items = [availEv('joe', 'Fourball', sec(0))]
  assert.equal(groupActivities(items).length, 1)
  let view = formatGroupedItem(groupActivities(items)[0])
  assert.equal(view.line, "Noah updated Joe Player's Fourball availability")
  assert.equal(view.sub, null)

  // A newer event arrives (prepend → newest-first).
  items = [availEv('joe', 'Singles', sec(5)), ...items]
  const groups2 = groupActivities(items)
  assert.equal(groups2.length, 1, 'no new visible item — coalesced')
  view = formatGroupedItem(groups2[0])
  assert.equal(view.line, "Noah updated Joe Player's availability")
  assert.equal(view.sub, 'Fourball · Singles')
})

test('an event arriving after the snapshot was marked read becomes unread even if it groups with viewed activity', () => {
  // Snapshot at open: two grouped events, newest = sec(5).
  const snapshot = [availEv('joe', 'Singles', sec(5)), availEv('joe', 'Fourball', sec(0))]
  const cursor = markSeenCursor(snapshot)
  assert.equal(cursor, sec(5))
  // A new event arrives (newer than the cursor) and would group with the viewed
  // item. Read state is raw/timestamp-based, so it is still unread.
  const after = [availEv('joe', 'Chapman', sec(8)), ...snapshot]
  assert.equal(deriveUnread(after, cursor), 1)
  // It does coalesce in presentation, though:
  assert.equal(groupActivities(after).length, 1)
})

test('grouping preserves every raw event — rows are not merged, lost, or duplicated', () => {
  const events = [
    availEv('joe', 'Singles', sec(10)),
    availEv('joe', 'Fourball', sec(5)),
    availEv('max', 'Fourball', sec(0)),
  ]
  const groups = groupActivities(events)
  const total = groups.reduce((n, g) => n + g.events.length, 0)
  assert.equal(total, events.length, 'no raw event merged away')
  // Each input event appears exactly once across all groups.
  const ids = new Set(groups.flatMap((g) => g.events.map((e) => e.id)))
  assert.equal(ids.size, events.length)
})

test('GROUP_WINDOW_MS is ~30s', () => {
  assert.equal(GROUP_WINDOW_MS, 30_000)
})