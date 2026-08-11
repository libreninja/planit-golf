import { pacificToday } from './pacific-time.ts'

type League = 'mens' | 'womens'

type UpcomingEventLike = {
  event_date: string
  league?: string | null
}

type RegistrationRunStatus = {
  event_date: string
  status: string | null
}

function getPacificNowParts() {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

  const parts = Object.fromEntries(
    formatter
      .formatToParts(new Date())
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  )

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: parts.weekday,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  }
}

function addDaysToDateString(dateString: string, days: number) {
  const [year, month, day] = dateString.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function formatDateLabel(dateString: string) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${dateString}T00:00:00Z`))
}

export function getNextRunEventDate(league: League) {
  const now = getPacificNowParts()
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  }

  const targetWeekday = league === 'womens' ? 3 : 2
  const currentWeekday = weekdayMap[now.weekday]
  const baseDate = `${String(now.year).padStart(4, '0')}-${String(now.month).padStart(2, '0')}-${String(now.day).padStart(2, '0')}`
  let daysUntilRegistration = (targetWeekday - currentWeekday + 7) % 7
  const isRegistrationTimePassed =
    daysUntilRegistration === 0 && (now.hour > 12 || (now.hour === 12 && now.minute >= 0))

  if (isRegistrationTimePassed) {
    daysUntilRegistration += 7
  }

  return addDaysToDateString(baseDate, daysUntilRegistration + 7)
}

export async function getLatestRegistrationRunStatus(
  serviceClient: any,
  league: League,
): Promise<RegistrationRunStatus | null> {
  try {
    const { data, error } = await serviceClient
      .from('registration_runs')
      .select('event_date, status')
      .eq('league', league)
      .order('event_date', { ascending: false })
      .limit(1)

    if (error || !data?.length) {
      return null
    }

    return data[0]
  } catch {
    return null
  }
}

// Number of days before the play day that registration closes (end of that
// Pacific day, 11:59 PM). Matches getRegistrationWindow's closeOffset. An
// event is "actionable" (open or upcoming) until its close day ends.
function registrationCloseOffset(league: League): number {
  return league === 'womens' ? 3 : 2
}

// An event's registration window is still actionable (open now, or opens in
// the future and can be pre-set) iff today's Pacific day has not yet passed
// the window's close day. Registration happens BEFORE play day, so this is a
// window-semantics check — NOT a bare `event_date < today` check (an event
// whose play day is today still closed registration days ago).
export function isRegistrationWindowOpenOrUpcoming(eventDate: string, league: League, today: string): boolean {
  const closesDate = addDaysToDateString(eventDate, -registrationCloseOffset(league))
  return today <= closesDate
}

export interface ResolveNextActionableInput {
  league: League
  eventDates: string[]                 // league-filtered; order irrelevant (sorted here)
  latestRun: RegistrationRunStatus | null
  today: string                         // YYYY-MM-DD, Pacific
  fallbackDate: string                  // computed next play day when no event matches
}

// Canonical "which event date should the Tee Times / Good-to-Go UI treat as
// the current actionable registration target?" decision. PURE and
// deterministic (today + fallback injected) so the lifecycle invariants are
// unit-testable without a database or clock.
//
// Rule (registration-window is the authority, run telemetry is secondary):
//   - A non-completed run (pending / in-progress / failed / null status)
//     anchors to its event ONLY while that event's registration window is
//     still open. Once the window closes it advances, so a failed or missing
//     bot run can never pin a past registration event indefinitely.
//   - A completed run advances to the next event whose window is still
//     actionable and strictly after the run's event.
//   - No run at all → the earliest event whose window is still actionable
//     (never a closed/past event).
//
// This replaces the per-caller duplicate that lived in home-page-data.ts,
// which only advanced on `status === 'completed'` and therefore pinned the
// UI to Aug 11 after the Club Championship automation failed.
export function resolveNextActionableEventDate({
  league,
  eventDates,
  latestRun,
  today,
  fallbackDate,
}: ResolveNextActionableInput): string {
  const sorted = [...eventDates].sort()
  const actionable = (date: string) => isRegistrationWindowOpenOrUpcoming(date, league, today)

  if (!latestRun) {
    return sorted.find((date) => actionable(date)) || fallbackDate
  }

  // Keep an in-flight run's event current while registration is still open.
  if (latestRun.status !== 'completed' && actionable(latestRun.event_date)) {
    return latestRun.event_date
  }

  // Completed run, OR a non-completed run whose window has closed: advance to
  // the earliest still-actionable event strictly after the run's event.
  return (
    sorted.find((date) => date > latestRun.event_date && actionable(date)) ||
    fallbackDate
  )
}

export async function getNextRunEventDateFromStatus(
  serviceClient: any,
  league: League,
  upcomingEvents: UpcomingEventLike[] = [],
) {
  const fallbackDate = getNextRunEventDate(league)
  const eventsForLeague = upcomingEvents
    .filter((event) => event.league === league || event.league == null)
    .map((event) => event.event_date)

  const latestRun = await getLatestRegistrationRunStatus(serviceClient, league)
  return resolveNextActionableEventDate({
    league,
    eventDates: eventsForLeague,
    latestRun,
    today: pacificToday(),
    fallbackDate,
  })
}

export function getRegistrationWindow(league: League, eventDate: string) {
  const openDate = addDaysToDateString(eventDate, -7)
  const closeOffset = league === 'womens' ? -3 : -2
  const closeDate = addDaysToDateString(eventDate, closeOffset)

  return {
    roundLabel: formatDateLabel(eventDate),
    opensLabel: `${formatDateLabel(openDate)} at 12:00 PM PT`,
    closesLabel: `${formatDateLabel(closeDate)} at 11:59 PM PT`,
  }
}
