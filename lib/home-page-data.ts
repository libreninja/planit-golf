import { redirect } from 'next/navigation'
import { getLatestRegistrationRunStatus, getNextRunEventDate } from '@/lib/registration-schedule'
import { ensureInviteLinkForUser } from '@/lib/invite-linking'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import { isConfiguredSystemAdminEmail } from '@/lib/system-admin'
import { RequestTimer } from '@/lib/server-timing'

type League = 'mens' | 'womens'
type HomeEvent = {
  id: string
  event_date: string
  course_name: string
  league?: string | null
  event_time_slots: {
    id: string
    time_slot: string
    display_order: number
  }[]
}

type HomeProfile = {
  id: string
  display_name: string | null
  member_id: string | null
  invite_id: string | null
  is_admin: boolean
  is_system_admin: boolean
  registrations_paused: boolean
  membership_revoked: boolean
  member?: {
    id: string
    league: League | null
  } | null
}

export async function loadHomePageData(timer?: RequestTimer) {
  const supabase = await createClient()
  const serviceClient = createServiceClient()

  const measure = async <T>(
    name: string,
    run: () => PromiseLike<T>,
    description?: string,
  ) => (timer ? timer.measure(name, run, description) : run())

  const authClaimsResult: any = await measure(
    'auth',
    () => supabase.auth.getClaims(),
    'supabase auth.getClaims',
  )
  const claims = authClaimsResult.data?.claims
  let user =
    claims?.sub
      ? ({
          id: claims.sub,
          email: typeof claims.email === 'string' ? claims.email : null,
          user_metadata: claims.user_metadata || {},
          app_metadata: claims.app_metadata || {},
        } as any)
      : null

  if (!user) {
    const authUserFallback: any = await measure(
      'auth_fallback',
      () => supabase.auth.getUser(),
      'fallback to supabase auth.getUser',
    )
    user = authUserFallback.data.user
  }

  if (!user) {
    redirect('/login')
  }

  const inviteToken =
    typeof user.user_metadata?.invite_token === 'string'
      ? user.user_metadata.invite_token
      : null

  const profileSelect = `
    id,
    display_name,
    member_id,
    invite_id,
    is_admin,
    is_system_admin,
    registrations_paused,
    membership_revoked,
    member:members!profiles_member_id_fkey (
      id,
      league
    )
  `

  const profileResult: any = await measure(
    'profile',
    () =>
      supabase
        .from('profiles')
        .select(profileSelect)
        .eq('id', user.id)
        .maybeSingle(),
    'load profile',
  )
  const profile = profileResult.data as HomeProfile | null

  let resolvedProfile = profile
  let memberLeague = profile?.member?.league ?? null

  if (!resolvedProfile && user.email) {
    await measure(
      'invite_init',
      () =>
        ensureInviteLinkForUser({
          serviceClient,
          userId: user.id,
          email: user.email,
          displayName:
            typeof user.user_metadata?.display_name === 'string'
              ? user.user_metadata.display_name
              : user.email.split('@')[0],
          inviteToken,
        }),
      'ensure initial invite link',
    )

    const createdProfileResult: any = await measure(
      'profile_refetch',
      () =>
        supabase
          .from('profiles')
          .select(profileSelect)
          .eq('id', user.id)
          .maybeSingle(),
      'refetch profile after invite init',
    )
    const createdProfile = createdProfileResult.data as HomeProfile | null

    resolvedProfile = createdProfile
    memberLeague = createdProfile?.member?.league ?? null
  }

  if ((!resolvedProfile || !resolvedProfile.member_id || !resolvedProfile.invite_id) && user.email) {
    const claimResult = await measure(
      'invite_claim',
      () =>
        ensureInviteLinkForUser({
          serviceClient,
          userId: user.id,
          email: user.email,
          displayName:
            typeof user.user_metadata?.display_name === 'string'
              ? user.user_metadata.display_name
              : null,
          inviteToken,
        }),
      'claim invite for user',
    )

    if (claimResult?.memberId && claimResult?.inviteId) {
      const baseProfile = resolvedProfile || {
        id: user.id,
        display_name:
          typeof user.user_metadata?.display_name === 'string'
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

  const isSystemAdminEmail =
    user.email && resolvedProfile
      ? await measure(
          'admin_check',
          () => isConfiguredSystemAdminEmail(user.email),
          'check configured system admin email',
        )
      : false

  if (user.email && resolvedProfile && isSystemAdminEmail) {
    const adminMemberResult: any = await measure(
      'admin_member',
      () =>
        serviceClient
          .from('members')
          .select('id, league')
          .eq('email', user.email.toLowerCase())
          .maybeSingle(),
      'load admin member by email',
    )
    const member = adminMemberResult.data as { id: string; league?: League | null } | null

    if (member) {
      await measure(
        'admin_update',
        () =>
          serviceClient
            .from('profiles')
            .update({
              member_id: member.id,
              is_admin: true,
              is_system_admin: true,
              registrations_paused: resolvedProfile?.registrations_paused ?? false,
              membership_revoked: resolvedProfile?.membership_revoked ?? false,
              updated_at: new Date().toISOString(),
            })
            .eq('id', user.id),
        'update profile with system admin roles',
      )

      resolvedProfile = {
        ...resolvedProfile,
        member_id: member.id,
        is_admin: true,
        is_system_admin: true,
        registrations_paused: resolvedProfile?.registrations_paused ?? false,
        membership_revoked: resolvedProfile?.membership_revoked ?? false,
      }
      memberLeague = member.league ?? memberLeague
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
    redirect('/stay-tuned')
  }

  if (resolvedProfile?.membership_revoked) {
    redirect('/stay-tuned')
  }

  const [memberResult] = await Promise.all([
    resolvedProfile?.member_id && !memberLeague
      ? measure(
          'member',
          () =>
            supabase
              .from('members')
              .select('id, league')
              .eq('id', resolvedProfile.member_id)
              .maybeSingle(),
          'load member league',
        )
      : Promise.resolve({ data: null }),
  ])
  const member = ((memberResult as any).data || null) as { id: string; league: League | null } | null
  memberLeague = memberLeague ?? member?.league ?? null

  let eventsQuery = supabase
    .from('events')
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
    .order('event_date', { ascending: true })

  let nextRunEventDate: string | null = null
  if (memberLeague) {
    eventsQuery = eventsQuery.eq('league', memberLeague)
  } else {
    eventsQuery = eventsQuery.gte('event_date', new Date().toISOString().split('T')[0])
  }

  const [eventsResult, latestRun] = await Promise.all([
    measure('events', () => eventsQuery, 'load upcoming events'),
    memberLeague
      ? measure(
          'latest_run',
          () => getLatestRegistrationRunStatus(serviceClient, memberLeague as League),
          'load latest registration run status',
        )
      : Promise.resolve(null),
  ])
  const allEvents = ((eventsResult as any).data || []) as HomeEvent[]

  if (memberLeague) {
    const fallbackDate = getNextRunEventDate(memberLeague as League)
    const eventsForLeague = allEvents.map((event) => event.event_date).sort()

    if (!latestRun) {
      nextRunEventDate = fallbackDate
    } else if (latestRun.status !== 'completed') {
      nextRunEventDate = latestRun.event_date
    } else {
      nextRunEventDate =
        eventsForLeague.find((eventDate) => eventDate > latestRun.event_date) || fallbackDate
    }
  }

  const events =
    memberLeague && nextRunEventDate
      ? allEvents.filter((event) => event.event_date >= nextRunEventDate)
      : allEvents.filter(
          (event) =>
            event.event_date >=
            getNextRunEventDate(memberLeague || 'mens'),
        )

  return {
    user,
    profile: resolvedProfile,
    events: events.map((event) => ({
      ...event,
      event_time_slots: event.event_time_slots || [],
    })),
    defaultPrefs: null,
    eventPrefs: [],
  }
}
