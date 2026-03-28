import { createServiceClient } from '@/lib/supabase/service'

const GOLF_GENIUS_BASE_URL = process.env.GOLF_GENIUS_BASE_URL || 'https://www.golfgenius.com'
const GOLF_GENIUS_API_KEY = process.env.GOLF_GENIUS_API_KEY

const LEAGUE_EVENT_PATTERNS = {
  mens: /IGC Mens League 2026/i,
  womens: /IGC Women's League 2026/i,
} as const

type League = keyof typeof LEAGUE_EVENT_PATTERNS

type GolfGeniusMember = {
  name?: string
  first_name?: string
  last_name?: string
  email?: string | null
  league?: League
}

type MemberRow = {
  id: string
  display_name: string
  email: string
  phone: string | null
  golf_member_name: string
  golf_member_id: string
  league: League | null
  active: boolean
}

function normalizeName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase()
}

function titleCaseName(value: string) {
  return value
    .split(',')
    .map((part) =>
      part
        .trim()
        .split(/\s+/)
        .map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
        .join(' '),
    )
    .join(', ')
}

function getDisplayName(name: string) {
  return titleCaseName(name).replace(',', '')
}

async function makeGolfGeniusRequest(endpoint: string, queryParams: Record<string, string | number | boolean | undefined> = {}) {
  if (!GOLF_GENIUS_API_KEY) {
    throw new Error('GOLF_GENIUS_API_KEY is required for roster sync')
  }

  const queryString = Object.entries(queryParams)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&')

  const url = `${GOLF_GENIUS_BASE_URL}/api_v2/${GOLF_GENIUS_API_KEY}${endpoint}${queryString ? `?${queryString}` : ''}`
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`Golf Genius API error (${response.status})`)
  }

  return response.json()
}

async function getEvents() {
  const eventsResponse = await makeGolfGeniusRequest('/events', { page: 1 })
  return (Array.isArray(eventsResponse) ? eventsResponse : eventsResponse?.events || [])
    .map((row: any) => row.event || row)
    .filter(Boolean)
}

async function getPagedRoster(endpoint: string, params: Record<string, string | number>) {
  const rows: GolfGeniusMember[] = []

  for (let page = 1; page <= 25; page += 1) {
    const response = await makeGolfGeniusRequest(endpoint, { ...params, page })
    const pageRows = (Array.isArray(response) ? response : response?.roster || response?.members || [])
      .map((row: any) => row.member || row)
      .filter(Boolean)

    if (pageRows.length === 0) break
    rows.push(...pageRows)
  }

  return rows
}

async function fetchLeagueRosterData() {
  const events = await getEvents()
  const eventRosterRows: GolfGeniusMember[] = []

  for (const [league, pattern] of Object.entries(LEAGUE_EVENT_PATTERNS) as Array<[League, RegExp]>) {
    const event = events.find((candidate: any) => pattern.test(candidate.name || ''))
    if (!event) {
      throw new Error(`Could not find Golf Genius event for ${league}`)
    }

    const rosterRows = await getPagedRoster(`/events/${event.id || event.event_id}/roster`, {})
    eventRosterRows.push(
      ...rosterRows.map((member) => ({
        ...member,
        league,
      })),
    )
  }

  const masterRosterRows = await getPagedRoster('/master_roster', {})
  const mergedByName = new Map<string, GolfGeniusMember>()

  for (const player of [...masterRosterRows, ...eventRosterRows]) {
    const golfMemberName = player.name || `${player.last_name}, ${player.first_name}`.trim()
    const normalizedName = normalizeName(golfMemberName)
    const existing = mergedByName.get(normalizedName)

    mergedByName.set(normalizedName, {
      ...player,
      name: golfMemberName,
      email: player.email || existing?.email || null,
      league: player.league || existing?.league,
    })
  }

  return mergedByName
}

export async function syncMembersFromGolfGenius() {
  const supabase = createServiceClient()
  const rosterByName = await fetchLeagueRosterData()

  const { data: existingMembers, error: existingMembersError } = await supabase
    .from('members')
    .select('id, display_name, email, phone, golf_member_name, golf_member_id, league, active')
    .order('display_name', { ascending: true })

  if (existingMembersError) throw existingMembersError

  const updates = (existingMembers || []).map((member: MemberRow) => {
    const matched = rosterByName.get(normalizeName(member.golf_member_name))

    if (!matched) {
      return {
        ...member,
        active: false,
      }
    }

    const name = matched.name || `${matched.last_name}, ${matched.first_name}`.trim()
    const nextEmail = matched.email ? normalizeEmail(matched.email) : member.email

    return {
      ...member,
      display_name: getDisplayName(name),
      email: nextEmail,
      league: matched.league || member.league,
      active: true,
    }
  })

  const { error: upsertError } = await supabase
    .from('members')
    .upsert(updates, { onConflict: 'golf_member_id' })

  if (upsertError) throw upsertError

  return {
    matchedMembers: updates.filter((member) => member.active).length,
    inactiveMembers: updates.filter((member) => !member.active).length,
    updatedMembers: updates.length,
  }
}
