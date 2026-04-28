import type { SupabaseClient } from '@supabase/supabase-js'

export type EventDemandCounts = Record<string, Record<string, number>>

export async function getEventDemandCounts(
  serviceClient: SupabaseClient,
  league: string,
  eventIds: string[],
): Promise<EventDemandCounts> {
  if (eventIds.length === 0) {
    return {}
  }

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
    .eq('league', league)

  const leagueProfileIds = (leagueMembers || []).flatMap((memberRow) =>
    (memberRow.profiles || []).map((profileRow) => profileRow.id),
  )

  if (leagueProfileIds.length === 0) {
    return {}
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

  return Object.fromEntries(
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
}
