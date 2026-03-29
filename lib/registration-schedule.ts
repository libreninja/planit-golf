type League = 'mens' | 'womens'

function getPacificNowParts() {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
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
  }
}

function addDaysToDateString(dateString: string, days: number) {
  const [year, month, day] = dateString.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
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
  let daysUntil = ((targetWeekday - currentWeekday + 7) % 7) + 7

  if (currentWeekday === 0 && now.hour >= 12) {
    daysUntil += 7
  }

  return addDaysToDateString(baseDate, daysUntil)
}

