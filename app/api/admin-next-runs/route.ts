import { NextResponse } from 'next/server'
import { getProfileRoles } from '@/lib/auth'
import { getNextRunEventDateFromStatus, getRegistrationWindow } from '@/lib/registration-schedule'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'

function toArray<T>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) return value
  if (value == null) return []
  return [value]
}

async function requireAdminRequest() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return null
  }

  const roles = await getProfileRoles(user.id)
  if (!roles.is_admin && !roles.is_system_admin) {
    return null
  }

  return user
}

type RunRow = {
  memberId: string
  displayName: string
  email: string
  golfMemberName: string
  golfMemberId: string
  runOrder: number
  inviteStatus: 'not invited' | 'pending' | 'claimed' | 'revoked'
  appStatus: 'not signed up' | 'ready' | 'missing preferences'
  preferences: string[]
}

function stableTaskScore(seed: string, value: string) {
  const input = `${seed}:${value}`
  let hash = 2166136261

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return hash >>> 0
}

export async function GET() {
  const user = await requireAdminRequest()
  if (!user) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  }

  const serviceClient = createServiceClient()

  const [{ data: members }, { data: events }] = await Promise.all([
    serviceClient
      .from('members')
      .select(`
        id,
        display_name,
        email,
        golf_member_name,
        golf_member_id,
        league,
        invites (
          id,
          status,
          invite_token
        ),
        profiles (
          id,
          registrations_paused,
          membership_revoked
        )
      `)
      .eq('active', true)
      .order('display_name', { ascending: true }),
    serviceClient
      .from('events')
      .select(`
        id,
        event_date,
        course_name,
        league,
        registration_opens_at,
        status,
        event_time_slots (
          time_slot,
          display_order
        )
      `)
      .eq('status', 'upcoming')
      .order('event_date', { ascending: true }),
  ])

  const targetRunDateByLeague = {
    mens: await getNextRunEventDateFromStatus(serviceClient, 'mens', events || []),
    womens: await getNextRunEventDateFromStatus(serviceClient, 'womens', events || []),
  }

  const nextEventsByLeague = new Map<string, NonNullable<typeof events>[number]>()
  for (const event of events || []) {
    if (!event.league || nextEventsByLeague.has(event.league)) continue
    if (event.event_date === targetRunDateByLeague[event.league as 'mens' | 'womens']) {
      nextEventsByLeague.set(event.league, event)
    }
  }

  const profileIds = (members || []).flatMap((member) => toArray(member.profiles).map((profileRow) => profileRow.id))

  const [{ data: defaultPreferences }, { data: eventPreferences }] = await Promise.all([
    profileIds.length > 0
      ? serviceClient
          .from('default_preferences')
          .select('user_id, tee_time_preferences')
          .in('user_id', profileIds)
      : Promise.resolve({ data: [] as { user_id: string; tee_time_preferences: string[] }[] }),
    nextEventsByLeague.size > 0 && profileIds.length > 0
      ? serviceClient
          .from('event_preferences')
          .select('user_id, event_id, tee_time_preferences, skip_registration')
          .in('event_id', Array.from(nextEventsByLeague.values()).map((event) => event.id))
          .in('user_id', profileIds)
      : Promise.resolve({ data: [] as { user_id: string; event_id: string; tee_time_preferences: string[]; skip_registration: boolean }[] }),
  ])

  const defaultPrefMap = new Map((defaultPreferences || []).map((row) => [row.user_id, row.tee_time_preferences]))
  const eventPrefMap = new Map((eventPreferences || []).map((row) => [`${row.event_id}:${row.user_id}`, row]))

  const buildRunRows = (league: string, eventId: string, availableSlots: string[], orderSeed: string): { rows: RunRow[]; validationWarnings: string[] } => {
    const validationWarnings: string[] = []
    const rows = (members || [])
      .filter((member) => member.league === league)
      .map((member) => {
        const invite = toArray(member.invites)[0]
        const profileRow = toArray(member.profiles)[0]
        const eventPreference = profileRow ? eventPrefMap.get(`${eventId}:${profileRow.id}`) : null
        const rawPreferences: string[] = profileRow
          ? eventPreference?.tee_time_preferences || defaultPrefMap.get(profileRow.id) || []
          : []
        const uniquePreferences: string[] = []

        for (const preference of rawPreferences.slice(0, 3)) {
          if (uniquePreferences.includes(preference)) {
            validationWarnings.push(`${member.golf_member_name}: duplicate attempt ${preference} removed.`)
            continue
          }
          if (!availableSlots.includes(preference)) {
            validationWarnings.push(`${member.golf_member_name}: ${preference} is not available for this run.`)
            continue
          }
          uniquePreferences.push(preference)
        }

        const inviteStatus = (invite?.status || 'not invited') as 'not invited' | 'pending' | 'claimed' | 'revoked'
        const appStatus: 'not signed up' | 'ready' | 'missing preferences' = !profileRow
          ? 'not signed up'
          : profileRow.registrations_paused || profileRow.membership_revoked || eventPreference?.skip_registration
            ? 'missing preferences'
            : uniquePreferences.length > 0
              ? 'ready'
              : 'missing preferences'

        return {
          memberId: member.id,
          displayName: member.display_name,
          email: member.email,
          golfMemberName: member.golf_member_name,
          golfMemberId: member.golf_member_id,
          runOrder: 0,
          inviteStatus,
          appStatus,
          preferences: uniquePreferences,
        }
      })
      .filter((row) => row.appStatus === 'ready')
      .sort((a, b) => {
        const aScore = stableTaskScore(orderSeed, a.golfMemberId || a.golfMemberName)
        const bScore = stableTaskScore(orderSeed, b.golfMemberId || b.golfMemberName)
        if (aScore !== bScore) return aScore - bScore
        return a.golfMemberName.localeCompare(b.golfMemberName)
      })
      .map((row, index) => ({
        ...row,
        runOrder: index + 1,
      }))

    return { rows, validationWarnings }
  }

  const sections = Array.from(nextEventsByLeague.entries()).map(([league, event]) => {
    const availableSlots = (event.event_time_slots || [])
      .slice()
      .sort((a, b) => a.display_order - b.display_order)
      .map((slot) => slot.time_slot)
    const orderSeed = `${league}:${event.id}:${event.event_date}`
    const { rows, validationWarnings } = buildRunRows(league, event.id, availableSlots, orderSeed)
    const demandCounts = rows.reduce<Record<string, number>>((counts, row) => {
      for (const time of row.preferences) {
        counts[time] = (counts[time] || 0) + 1
      }
      return counts
    }, {})
    const title = league === 'mens' ? "Men's next registration run" : league === 'womens' ? "Women's next registration run" : `${league} next registration run`
    const registrationWindow = getRegistrationWindow(league as 'mens' | 'womens', event.event_date)
    return {
      title,
      rows,
      demandCounts,
      orderPolicy: 'seeded-event-random',
      orderSeed,
      taskCount: rows.length,
      validationWarnings,
      ...registrationWindow,
    }
  })

  return NextResponse.json({ sections })
}
