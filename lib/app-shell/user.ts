import { createClient } from '@/lib/supabase/server'
import { hasScoutingAccess } from '@/lib/scouting-access'
import { hasHarvestContributorAccess } from '@/lib/seattle-cup/harvest/access'

// The single "who is the current viewer" object the application shell needs.
// Non-redirecting and side-effect free (it performs no writes and never bounces
// a visitor), so it is safe to run in the root layout on every request. The
// scouting-invite safety net (ensureCapabilityInviteClaimed) is intentionally
// NOT run here — it belongs on the dashboard (app/page.tsx), where the homepage
// already ran it, not on every route.

export interface AppShellUser {
  signedIn: boolean
  userId: string | null
  email: string | null
  displayName: string | null
  league: 'mens' | 'womens' | null
  // Good to Go (tee-time preferences) access — mirrors the canAccessWithoutInvite
  // condition in lib/home-page-data.ts without its redirect logic.
  gtgAccess: boolean
  scouting: boolean
  harvest: boolean
  harvestReview: boolean
  isAdmin: boolean
}

const ANON: AppShellUser = {
  signedIn: false,
  userId: null,
  email: null,
  displayName: null,
  league: null,
  gtgAccess: false,
  scouting: false,
  harvest: false,
  harvestReview: false,
  isAdmin: false,
}

type ProfileRow = {
  display_name: string | null
  member_id: string | null
  invite_id: string | null
  is_admin: boolean | null
  is_system_admin: boolean | null
  membership_revoked: boolean | null
  member: { id: string; league: 'mens' | 'womens' | null } | null
}

export async function getAppShellUser(): Promise<AppShellUser> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return ANON

  const { data: profile } = await supabase
    .from('profiles')
    .select(
      `display_name, member_id, invite_id, is_admin, is_system_admin, membership_revoked, member:members!profiles_member_id_fkey ( id, league )`
    )
    .eq('id', user.id)
    .maybeSingle()

  const p = (profile ?? null) as ProfileRow | null
  const league = p?.member?.league ?? null
  const gtgAccess = Boolean(
    p?.member_id && (p?.invite_id || p?.is_system_admin) && !p?.membership_revoked,
  )
  const isAdmin = Boolean(p?.is_admin || p?.is_system_admin)
  const [scouting, contributor] = await Promise.all([
    hasScoutingAccess(user.id),
    hasHarvestContributorAccess(user.id),
  ])
  const harvest = contributor || scouting || isAdmin

  return {
    signedIn: true,
    userId: user.id,
    email: user.email ?? null,
    displayName: p?.display_name ?? null,
    league,
    gtgAccess,
    scouting,
    harvest,
    harvestReview: scouting || isAdmin,
    isAdmin,
  }
}
