import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const eventIds = (searchParams.get('eventIds') || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  if (eventIds.length === 0) {
    return NextResponse.json({ eventDemandCounts: {} })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('member_id')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile?.member_id) {
    return NextResponse.json({ eventDemandCounts: {} })
  }

  const { data: member } = await supabase
    .from('members')
    .select('league')
    .eq('id', profile.member_id)
    .maybeSingle()

  if (!member?.league) {
    return NextResponse.json({ eventDemandCounts: {} })
  }

  const serviceClient = createServiceClient()
  const { data: events } = await serviceClient
    .from('events')
    .select(`
      id,
      event_time_slots (
        time_slot
      )
    `)
    .in('id', eventIds)

  const { data: leagueMembers } = await serviceClient
    .from('members')
    .select(`
      id,
      profiles (
        id,
        registrations_paused,
        membership_revoked
      )
    `)
    .eq('active', true)
    .eq('league', member.league)

  const leagueProfileIds = (leagueMembers || []).flatMap((memberRow) =>
    (memberRow.profiles || []).map((profileRow) => profileRow.id),
  )

  if (leagueProfileIds.length === 0) {
    return NextResponse.json({ eventDemandCounts: {} })
  }

  const [{ data: allDefaultPrefs }, { data: allEventPrefs }] = await Promise.all([
    serviceClient
      .from('default_preferences')
      .select('user_id, tee_time_preferences')
      .in('user_id', leagueProfileIds),
    serviceClient
      .from('event_preferences')
      .select('user_id, event_id, tee_time_preferences, skip_registration')
      .in('user_id', leagueProfileIds)
      .in('event_id', eventIds),
  ])

  const defaultPrefMap = new Map((allDefaultPrefs || []).map((row) => [row.user_id, row.tee_time_preferences]))
  const eventPrefMap = new Map((allEventPrefs || []).map((row) => [`${row.event_id}:${row.user_id}`, row]))
  const eventDemandCounts = Object.fromEntries(
    (events || []).map((event) => {
      const availableSlots = new Set((event.event_time_slots || []).map((slot) => slot.time_slot))
      const counts: Record<string, number> = {}

      for (const memberRow of leagueMembers || []) {
        const profileRow = (memberRow.profiles || [])[0]
        if (!profileRow || profileRow.registrations_paused || profileRow.membership_revoked) continue

        const profileId = profileRow.id
        const eventPreference = eventPrefMap.get(`${event.id}:${profileId}`)
        if (eventPreference?.skip_registration) continue

        const preferences =
          eventPreference?.tee_time_preferences ||
          defaultPrefMap.get(profileId) ||
          []

        for (const time of preferences.slice(0, 3)) {
          if (!availableSlots.has(time)) continue
          counts[time] = (counts[time] || 0) + 1
        }
      }

      return [event.id, counts]
    }),
  )

  return NextResponse.json({ eventDemandCounts })
}
