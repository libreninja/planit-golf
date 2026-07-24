import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import {
  getNextRunEventDateFromStatus,
  getRegistrationWindow,
} from '@/lib/registration-schedule'
import { SCOUTING_FEATURE_KEY } from '@/lib/scouting-access'

// Dashboard data for the authenticated home page. Supabase-only — it never
// calls planit-ai, so the dashboard stays useful even when the scouting
// backend is down. Quiet by design: when there is nothing actionable, both
// lists are empty and the page renders nothing for that section.

type League = 'mens' | 'womens'

export interface ComingUpItem {
  id: string
  dateLabel: string
  course: string
  leagueLabel: string | null
  relativeBucket: 'today' | 'tomorrow' | 'thisWeek' | 'later'
  registration: { roundLabel: string; opensLabel: string; closesLabel: string } | null
  prefState: 'set' | 'not-set' | 'cant-play'
  status: string | null
}

export interface AttentionItem {
  id: string
  label: string
  href: string
  kind: 'prefs' | 'invite'
}

export interface DashboardData {
  comingUp: ComingUpItem[]
  needsAttention: AttentionItem[]
}

type EventRow = {
  id: string
  event_date: string
  course_name: string
  league: League | null
  status: string | null
  event_time_slots: { id: string }[]
}

type DefaultPrefRow = { tee_time_preferences: string[] } | null
type EventPrefRow = {
  event_id: string
  tee_time_preferences: string[]
  skip_registration: boolean | null
}

const LEAGUE_LABEL: Record<League, string> = {
  mens: "Men's League",
  womens: "Women's League",
}

// YYYY-MM-DD in America/Los_Angeles. Mirrors getPacificNowParts in
// lib/registration-schedule.ts without depending on its private export.
function pacificToday(): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = Object.fromEntries(
    formatter
      .formatToParts(new Date())
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, p.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}`
}

function pacificWeekday(dateString: string): number {
  // 0=Sun … 6=Sat, interpreted in Pacific time for the given calendar date.
  const [y, m, d] = dateString.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

function addDays(dateString: string, days: number): string {
  const [y, m, d] = dateString.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function relativeBucket(eventDate: string, today: string): ComingUpItem['relativeBucket'] {
  if (eventDate === today) return 'today'
  if (eventDate === addDays(today, 1)) return 'tomorrow'
  const todayWeekday = pacificWeekday(today)
  // "This week" = from today through the coming Saturday.
  const daysToSaturday = (6 - todayWeekday + 7) % 7
  const saturday = addDays(today, daysToSaturday)
  if (eventDate >= today && eventDate <= saturday) return 'thisWeek'
  return 'later'
}

export async function getDashboardData(input: {
  userId: string
  email: string
  league: League | null
  gtgAccess: boolean
  hasScouting: boolean
}): Promise<DashboardData> {
  const { userId, email, league, gtgAccess } = input

  // No league + no GTG access → nothing to surface from real data. Keep the
  // dashboard quiet rather than fabricating a feed.
  if (!league || !gtgAccess) {
    return { comingUp: [], needsAttention: [] }
  }

  const supabase = await createClient()
  const serviceClient = createServiceClient()
  const today = pacificToday()

  // Upcoming events for this league (and league-agnostic rounds). Query all
  // events from today forward, then resolve the registration "next run" date
  // and filter — same approach as lib/home-page-data.ts.
  const { data: allEventsRaw } = await supabase
    .from('events')
    .select(
      `id, event_date, course_name, league, status, event_time_slots ( id )`,
    )
    .gte('event_date', today)
    .order('event_date', { ascending: true })

  const allEvents = (allEventsRaw ?? []) as EventRow[]
  const nextRunEventDate = await getNextRunEventDateFromStatus(
    serviceClient,
    league,
    allEvents.map((e) => ({ event_date: e.event_date, league: e.league })),
  )

  const upcoming = allEvents.filter(
    (e) =>
      e.event_date >= (nextRunEventDate ?? today) &&
      (e.league === league || e.league === null),
  )

  // Preferences: the user's defaults plus any per-event overrides. RLS lets a
  // user read only their own rows.
  const [defaultPrefResult, eventPrefsResult] = await Promise.all([
    supabase
      .from('default_preferences')
      .select('tee_time_preferences')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('event_preferences')
      .select('event_id, tee_time_preferences, skip_registration')
      .eq('user_id', userId),
  ])

  const defaultPrefs = (defaultPrefResult.data ?? null) as DefaultPrefRow
  const defaultTimes = defaultPrefs?.tee_time_preferences ?? []
  const eventPrefs = (eventPrefsResult.data ?? []) as EventPrefRow[]
  const eventPrefByEvent = new Map(eventPrefs.map((p) => [p.event_id, p]))

  const comingUp: ComingUpItem[] = upcoming.map((event) => {
    const override = eventPrefByEvent.get(event.id)
    const effectiveTimes =
      override && override.skip_registration
        ? []
        : override?.tee_time_preferences ?? defaultTimes
    const prefState: ComingUpItem['prefState'] =
      override?.skip_registration === true
        ? 'cant-play'
        : effectiveTimes.length > 0
          ? 'set'
          : 'not-set'

    const window = getRegistrationWindow(league, event.event_date)

    return {
      id: event.id,
      dateLabel: window.roundLabel,
      course: event.course_name ?? 'TBD',
      leagueLabel: event.league ? LEAGUE_LABEL[event.league] : null,
      relativeBucket: relativeBucket(event.event_date, today),
      registration: window,
      prefState,
      status: event.status ?? null,
    }
  })

  // Needs Attention — only genuinely actionable items.
  const needsAttention: AttentionItem[] = []

  // 1. Tee-time preferences due: not-set events whose registration window is
  //    open or opens within the next 3 days. Capped to keep the list calm.
  const soon = addDays(today, 3)
  for (const item of comingUp) {
    if (item.prefState !== 'not-set') continue
    const eventDate = upcoming.find((e) => e.id === item.id)?.event_date
    if (!eventDate) continue
    const opensDate = addDays(eventDate, -7)
    if (opensDate <= soon) {
      needsAttention.push({
        id: `prefs-${item.id}`,
        kind: 'prefs',
        label: `Set tee-time preferences for ${item.dateLabel} at ${item.course}`,
        href: '/igc/mens-league/tee-times',
      })
    }
    if (needsAttention.filter((n) => n.kind === 'prefs').length >= 3) break
  }

  // 2. Pending Seattle Cup scouting invite addressed to this user's email.
  //    capability_invites has no user RLS, so this read needs the service
  //    client — the same role the admin actions already use.
  if (!input.hasScouting && email) {
    const { data: pendingInvite } = await serviceClient
      .from('capability_invites')
      .select('invite_token')
      .eq('email', email.toLowerCase())
      .eq('feature_key', SCOUTING_FEATURE_KEY)
      .eq('status', 'pending')
      .is('claimed_by_user_id', null)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (pendingInvite?.invite_token) {
      needsAttention.push({
        id: `invite-${pendingInvite.invite_token}`,
        kind: 'invite',
        label: 'You’re invited to Seattle Cup scouting — accept the invitation',
        href: `/scouting-invite/${pendingInvite.invite_token}`,
      })
    }
  }

  return { comingUp, needsAttention }
}