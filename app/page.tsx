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
    .select("id, display_name, member_id, invite_id, is_admin, is_system_admin")
    .eq("id", user.id)
    .maybeSingle()

  let resolvedProfile = profile

  if (resolvedProfile && (!resolvedProfile.member_id || !resolvedProfile.invite_id)) {
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
        resolvedProfile = {
          ...resolvedProfile,
          member_id: claimedInvite.member_id,
          invite_id: claimedInvite.invite_id,
        }
      }
    }
  }

  if (user.email && resolvedProfile && await isConfiguredSystemAdminEmail(user.email)) {
    const serviceClient = createServiceClient()
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
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id)

      resolvedProfile = {
        ...resolvedProfile,
        member_id: member.id,
        is_admin: true,
        is_system_admin: true,
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
    .select("event_id, tee_time_preferences")
    .eq("user_id", user.id)

  return (
    <PreferenceForm
      user={user}
      profile={resolvedProfile}
      events={events || []}
      defaultPrefs={defaultPrefs}
      eventPrefs={eventPrefs || []}
    />
  )
}
