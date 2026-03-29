type League = 'mens' | 'womens'

type UpcomingEventLike = {
  event_date: string
  league?: string | null
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

export async function getNextRunEventDateFromStatus(
  serviceClient: any,
  league: League,
  upcomingEvents: UpcomingEventLike[] = [],
) {
  const fallbackDate = getNextRunEventDate(league)
  const eventsForLeague = upcomingEvents
    .filter((event) => event.league === league || event.league == null)
    .map((event) => event.event_date)
    .sort()

  try {
    const { data, error } = await serviceClient
      .from('registration_runs')
      .select('event_date, status')
      .eq('league', league)
      .order('event_date', { ascending: false })
      .limit(1)

    if (error || !data?.length) {
      return fallbackDate
    }

    const latestRun = data[0]

    if (latestRun.status !== 'completed') {
      return latestRun.event_date
    }

    const nextPendingEventDate = eventsForLeague.find((eventDate) => eventDate > latestRun.event_date)
    return nextPendingEventDate || fallbackDate
  } catch {
    return fallbackDate
  }
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
