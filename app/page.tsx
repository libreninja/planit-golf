import { redirect } from "next/navigation"
import { PreferenceForm } from "@/components/preference-form"
import { getNextRunEventDate, getNextRunEventDateFromStatus } from "@/lib/registration-schedule"
import { ensureInviteLinkForUser } from "@/lib/invite-linking"
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

  const inviteToken =
    typeof user.user_metadata?.invite_token === "string"
      ? user.user_metadata.invite_token
      : null

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, display_name, member_id, invite_id, is_admin, is_system_admin, registrations_paused, membership_revoked")
    .eq("id", user.id)
    .maybeSingle()

  let resolvedProfile = profile
  const serviceClient = createServiceClient()

  if (!resolvedProfile && user.email) {
    await ensureInviteLinkForUser({
      serviceClient,
      userId: user.id,
      email: user.email,
      displayName:
        typeof user.user_metadata?.display_name === "string"
          ? user.user_metadata.display_name
          : user.email.split("@")[0],
      inviteToken,
    })

    const { data: createdProfile } = await supabase
      .from("profiles")
      .select("id, display_name, member_id, invite_id, is_admin, is_system_admin, registrations_paused, membership_revoked")
      .eq("id", user.id)
      .maybeSingle()

    resolvedProfile = createdProfile
  }

  if (!resolvedProfile || !resolvedProfile.member_id || !resolvedProfile.invite_id) {
    if (user.email) {
      const claimResult = await ensureInviteLinkForUser({
        serviceClient,
        userId: user.id,
        email: user.email,
        displayName:
          typeof user.user_metadata?.display_name === "string"
            ? user.user_metadata.display_name
            : null,
        inviteToken,
      })

      if (claimResult?.memberId && claimResult?.inviteId) {
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
          member_id: claimResult.memberId,
          invite_id: claimResult.inviteId,
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
    if (inviteToken) {
      redirect(`/invite/${inviteToken}`)
    }
    redirect("/stay-tuned")
  }

  if (resolvedProfile?.membership_revoked) {
    redirect("/stay-tuned")
  }

  const [{ data: member }, { data: defaultPrefs }, { data: eventPrefs }] = await Promise.all([
    resolvedProfile?.member_id
      ? supabase
          .from("members")
          .select("id, league")
          .eq("id", resolvedProfile.member_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("default_preferences")
      .select("tee_time_preferences")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("event_preferences")
      .select("event_id, tee_time_preferences, skip_registration")
      .eq("user_id", user.id),
  ])

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
    .order("event_date", { ascending: true })

  let nextRunEventDate: string | null = null
  if (member?.league) {
    eventsQuery = eventsQuery.eq("league", member.league)
  } else {
    eventsQuery = eventsQuery.gte("event_date", new Date().toISOString().split("T")[0])
  }

  const { data: allEvents } = await eventsQuery

  if (member?.league) {
    nextRunEventDate = await getNextRunEventDateFromStatus(
      serviceClient,
      member.league as 'mens' | 'womens',
      allEvents || [],
    )
  }

  const events = member?.league && nextRunEventDate
    ? (allEvents || []).filter((event) => event.event_date >= nextRunEventDate)
    : (allEvents || []).filter((event) => event.event_date >= getNextRunEventDate((member?.league as 'mens' | 'womens' | undefined) || 'mens'))

  return (
    <PreferenceForm
      user={user}
      profile={resolvedProfile}
      events={events || []}
      defaultPrefs={defaultPrefs}
      eventPrefs={eventPrefs || []}
      eventDemandCounts={{}}
    />
  )
}
