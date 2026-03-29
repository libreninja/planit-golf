import { redirect } from "next/navigation"
import { PreferenceForm } from "@/components/preference-form"
import { createServiceClient } from "@/lib/supabase/service"
import { createClient } from "@/lib/supabase/server"
import { isConfiguredSystemAdminEmail } from "@/lib/system-admin"

export default async function Home() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, display_name, member_id, invite_id, is_admin, is_system_admin, registrations_paused, membership_revoked")
    .eq("id", user.id)
    .maybeSingle()

  let resolvedProfile = profile
  const serviceClient = createServiceClient()

  if (!resolvedProfile && user.email) {
    await serviceClient
      .from("profiles")
      .upsert({
        id: user.id,
        email: user.email,
        display_name:
          typeof user.user_metadata?.display_name === "string"
            ? user.user_metadata.display_name
            : user.email.split("@")[0],
        updated_at: new Date().toISOString(),
      })

    const { data: createdProfile } = await supabase
      .from("profiles")
      .select("id, display_name, member_id, invite_id, is_admin, is_system_admin, registrations_paused, membership_revoked")
      .eq("id", user.id)
      .maybeSingle()

    resolvedProfile = createdProfile
  }

  if (!resolvedProfile || !resolvedProfile.member_id || !resolvedProfile.invite_id) {
    const inviteToken =
      typeof user.user_metadata?.invite_token === "string"
        ? user.user_metadata.invite_token
        : null

    if (inviteToken && user.email) {
      const { data: claimResult } = await supabase.rpc("claim_invite_for_user", {
        claim_user_id: user.id,
        claim_email: user.email,
        claim_token: inviteToken,
        claim_display_name:
          typeof user.user_metadata?.display_name === "string"
            ? user.user_metadata.display_name
            : null,
      })

      const claimedInvite = Array.isArray(claimResult) ? claimResult[0] : claimResult
      if (claimedInvite?.member_id && claimedInvite?.invite_id) {
        const baseProfile = resolvedProfile || {
          id: user.id,
          display_name:
            typeof user.user_metadata?.display_name === "string"
              ? user.user_metadata.display_name
              : null,
          member_id: null,
          invite_id: null,
          is_admin: false,
          is_system_admin: false,
          registrations_paused: false,
          membership_revoked: false,
        }
        resolvedProfile = {
          ...baseProfile,
          member_id: claimedInvite.member_id,
          invite_id: claimedInvite.invite_id,
        }
      }
    }
  }

  if (user.email && resolvedProfile && await isConfiguredSystemAdminEmail(user.email)) {
    const { data: member } = await serviceClient
      .from("members")
      .select("id")
      .eq("email", user.email.toLowerCase())
      .maybeSingle()

    if (member) {
      await serviceClient
        .from("profiles")
        .update({
          member_id: member.id,
          is_admin: true,
          is_system_admin: true,
          registrations_paused: resolvedProfile?.registrations_paused ?? false,
          membership_revoked: resolvedProfile?.membership_revoked ?? false,
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id)

      resolvedProfile = {
        ...resolvedProfile,
        member_id: member.id,
        is_admin: true,
        is_system_admin: true,
        registrations_paused: resolvedProfile?.registrations_paused ?? false,
        membership_revoked: resolvedProfile?.membership_revoked ?? false,
      }
    }
  }

  const canAccessWithoutInvite = Boolean(
    resolvedProfile?.member_id &&
    (resolvedProfile?.invite_id || resolvedProfile?.is_system_admin),
  )

  if (!canAccessWithoutInvite) {
    redirect("/stay-tuned")
  }

  if (resolvedProfile?.membership_revoked) {
    redirect("/stay-tuned")
  }

  const { data: member } = resolvedProfile?.member_id
    ? await supabase
        .from("members")
        .select("id, league")
        .eq("id", resolvedProfile.member_id)
        .maybeSingle()
    : { data: null }

  let eventsQuery = supabase
    .from("events")
    .select(`
      id,
      event_date,
      course_name,
      league,
      event_time_slots (
        id,
        time_slot,
        display_order
      )
    `)
    .gte("event_date", new Date().toISOString().split("T")[0])
    .order("event_date", { ascending: true })

  if (member?.league) {
    eventsQuery = eventsQuery.eq("league", member.league)
  }

  const { data: events } = await eventsQuery

  const { data: defaultPrefs } = await supabase
    .from("default_preferences")
    .select("tee_time_preferences")
    .eq("user_id", user.id)
    .maybeSingle()

  const { data: eventPrefs } = await supabase
    .from("event_preferences")
    .select("event_id, tee_time_preferences, skip_registration")
    .eq("user_id", user.id)

  const { data: leagueMembers } = member?.league
    ? await supabase
        .from("members")
        .select(`
          id,
          profiles (
            id,
            registrations_paused,
            membership_revoked
          )
        `)
        .eq("active", true)
        .eq("league", member.league)
    : { data: [] as Array<{ id: string; profiles: Array<{ id: string; registrations_paused: boolean; membership_revoked: boolean }> | null }> }

  const leagueProfileIds = (leagueMembers || []).flatMap((memberRow) =>
    (memberRow.profiles || []).map((profileRow) => profileRow.id),
  )
  const eventIds = (events || []).map((event) => event.id)

  const { data: allDefaultPrefs } =
    leagueProfileIds.length > 0
      ? await supabase
          .from("default_preferences")
          .select("user_id, tee_time_preferences")
          .in("user_id", leagueProfileIds)
      : { data: [] as Array<{ user_id: string; tee_time_preferences: string[] }> }

  const { data: allEventPrefs } =
    leagueProfileIds.length > 0 && eventIds.length > 0
      ? await supabase
          .from("event_preferences")
          .select("user_id, event_id, tee_time_preferences, skip_registration")
          .in("user_id", leagueProfileIds)
          .in("event_id", eventIds)
      : { data: [] as Array<{ user_id: string; event_id: string; tee_time_preferences: string[]; skip_registration: boolean }> }

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

  return (
    <PreferenceForm
      user={user}
      profile={resolvedProfile}
      events={events || []}
      defaultPrefs={defaultPrefs}
      eventPrefs={eventPrefs || []}
      eventDemandCounts={eventDemandCounts}
    />
  )
}
