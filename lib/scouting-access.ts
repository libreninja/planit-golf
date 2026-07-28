import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireAuth } from '@/lib/auth'
import { redirect } from 'next/navigation'

// Seattle Cup scouting access gate. The gate is the feature entitlement ALONE
// (feature_entitlements row, active, scoped to the IGC club). IGC membership is
// NOT required and is NOT checked here — see docs/access-onboarding-design-addendum.md
// (§2/§4) and migration 022.

export const SCOUTING_FEATURE_KEY = 'seattle_cup_scouting'
const IGC_CLUB_SLUG = 'igc'

let cachedIgcClubId: string | null = null

// Resolve the IGC club id (slug 'igc', seeded by migration 016). Cached for the
// life of the server process.
export async function getIgcClubId(): Promise<string> {
  if (cachedIgcClubId) return cachedIgcClubId
  const service = createServiceClient()
  const { data, error } = await service
    .from('clubs')
    .select('id')
    .eq('slug', IGC_CLUB_SLUG)
    .maybeSingle()
  if (error || !data) {
    throw new Error(
      'IGC club not found (slug=igc). Ensure migration 016 has run.'
    )
  }
  cachedIgcClubId = data.id as string
  return cachedIgcClubId
}

// Does this user have an ACTIVE Seattle Cup scouting entitlement? Runs with the
// user's own client (RLS allows SELECT on own entitlement rows).
export async function hasScoutingAccess(userId: string): Promise<boolean> {
  const supabase = await createClient()
  const clubId = await getIgcClubId()
  const { data, error } = await supabase
    .from('feature_entitlements')
    .select('id')
    .eq('user_id', userId)
    .eq('club_id', clubId)
    .eq('feature_key', SCOUTING_FEATURE_KEY)
    .eq('status', 'active')
    .maybeSingle()
  if (error) {
    console.error('[scouting-access] query failed:', error.message)
    return false
  }
  return !!data
}

// Gate for scouting pages. Authenticated + active entitlement, else redirect.
export async function requireScoutingAccess() {
  const user = await requireAuth()
  const ok = await hasScoutingAccess(user.id)
  if (!ok) redirect('/')
  return user
}

// Safety net for a user who just confirmed a scouting-invite signup but did not
// land on /scouting-invite/[token] (e.g. they navigated to the homepage before
// the post-confirmation redirect completed). If their user_metadata still
// carries a capability_invite_token, attempt to claim it now. Idempotent: a
// token already claimed returns no rows and is treated as success. The token is
// then stripped from user_metadata so this is a one-shot per invite.
export async function ensureCapabilityInviteClaimed(user: {
  id: string
  email?: string | null
  user_metadata?: Record<string, unknown> | null
}): Promise<boolean> {
  const token =
    user.user_metadata &&
    typeof user.user_metadata.capability_invite_token === 'string'
      ? user.user_metadata.capability_invite_token
      : null
  if (!token || !user.email) return false

  const supabase = await createClient()
  const { data: claimed } = await supabase.rpc('claim_capability_invite', {
    p_user_id: user.id,
    p_email: user.email,
    p_token: token,
    p_display_name:
      (user.user_metadata?.display_name as string | undefined) ?? null,
  })

  // Strip the token either way so we don't retry every homepage load.
  const service = createServiceClient()
  const cleanedMetadata = { ...(user.user_metadata ?? {}) }
  delete cleanedMetadata.capability_invite_token
  await service.auth.admin.updateUserById(user.id, {
    user_metadata: cleanedMetadata,
  })

  return Array.isArray(claimed) && claimed.length > 0
}