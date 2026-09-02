'use server'

// Admin server actions for Seattle Cup scouting access. All data writes use the
// service-role client (capability_invites has no user RLS; feature_entitlements
// is read-only for users). Each action re-checks admin role first.
//
// Per §4: granting scouting (by invite OR admin grant) creates ONLY a
// feature_entitlements row — never a club_memberships row. Scouting does not
// require IGC membership.

import { randomUUID } from 'crypto'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getProfileRoles } from '@/lib/auth'
import { getIgcClubId, SCOUTING_FEATURE_KEY } from '@/lib/scouting-access'
import { HARVEST_CAPTAIN_FEATURE_KEY } from '@/lib/seattle-cup/harvest/domain'
import { sendScoutingInviteEmail } from '@/lib/email/mailer'

async function requireAdminUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const roles = await getProfileRoles(user.id)
  if (!roles.is_admin && !roles.is_system_admin) {
    throw new Error('Admin access required')
  }
  return { user, service: createServiceClient() }
}

function normEmail(raw: FormDataEntryValue | null | undefined): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
}

// Invite a (possibly not-yet-existing) scouting reviewer by email. Upserts the pending
// capability_invite (re-invite replaces the token) and sends the email.
export async function createScoutingInvite(formData: FormData) {
  const { user, service } = await requireAdminUser()
  const email = normEmail(formData.get('email'))
  const displayName = (formData.get('displayName') as string | null)?.trim() || null
  if (!email || !email.includes('@')) throw new Error('A valid email is required')

  const clubId = await getIgcClubId()
  const token = randomUUID()

  const { error } = await service.from('capability_invites').upsert(
    {
      club_id: clubId,
      feature_key: SCOUTING_FEATURE_KEY,
      email,
      invite_token: token,
      status: 'pending',
      display_name: displayName,
      created_by: user.id,
      claimed_by_user_id: null,
      claimed_at: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'email,club_id,feature_key' }
  )
  if (error) throw error

  await sendScoutingInviteEmail(token, email, displayName)
  revalidatePath('/admin/scouting')
}

// Grant scouting to an EXISTING PlanIt account by email (no invite, no email,
// no re-registration, no club_memberships row).
export async function grantScoutingByEmail(formData: FormData) {
  const { user, service } = await requireAdminUser()
  const email = normEmail(formData.get('email'))
  if (!email || !email.includes('@')) throw new Error('A valid email is required')

  const { data: profile, error: profileError } = await service
    .from('profiles')
    .select('id, display_name')
    .ilike('email', email)
    .maybeSingle()
  if (profileError) throw profileError
  if (!profile?.id) {
    throw new Error(
      'No existing PlanIt account found for that email. Send an invite instead — the person can create an account from the invite link.'
    )
  }

  const clubId = await getIgcClubId()
  const { error } = await service.from('feature_entitlements').upsert(
    {
      user_id: profile.id,
      club_id: clubId,
      feature_key: SCOUTING_FEATURE_KEY,
      status: 'active',
      source: 'admin',
      granted_by: user.id,
      granted_at: new Date().toISOString(),
      revoked_by: null,
      revoked_at: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,club_id,feature_key' }
  )
  if (error) throw error

  revalidatePath('/admin/scouting')
}

// Grant only the IGC Seattle Cup Intel Harvest captain capability. This does
// not grant scouting-board access, club membership, or any Planit admin role.
export async function grantIntelCaptainByEmail(formData: FormData) {
  const { user, service } = await requireAdminUser()
  const email = normEmail(formData.get('email'))
  if (!email || !email.includes('@')) throw new Error('A valid email is required')

  const { data: profile, error: profileError } = await service
    .from('profiles')
    .select('id')
    .ilike('email', email)
    .maybeSingle()
  if (profileError) throw profileError
  if (!profile?.id) throw new Error('No existing PlanIt account found for that email')

  const clubId = await getIgcClubId()
  const { error } = await service.from('feature_entitlements').upsert({
    user_id: profile.id,
    club_id: clubId,
    feature_key: HARVEST_CAPTAIN_FEATURE_KEY,
    status: 'active',
    source: 'admin',
    granted_by: user.id,
    granted_at: new Date().toISOString(),
    revoked_by: null,
    revoked_at: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,club_id,feature_key' })
  if (error) throw error
  revalidatePath('/admin/scouting')
}

export async function revokeIntelCaptain(formData: FormData) {
  const { user, service } = await requireAdminUser()
  const userId = String(formData.get('userId') || '')
  if (!userId) throw new Error('userId is required')
  const clubId = await getIgcClubId()
  const { error } = await service
    .from('feature_entitlements')
    .update({ status: 'revoked', revoked_by: user.id, revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('club_id', clubId)
    .eq('feature_key', HARVEST_CAPTAIN_FEATURE_KEY)
    .eq('status', 'active')
  if (error) throw error
  revalidatePath('/admin/scouting')
}

// Revoke a user's scouting entitlement. Independent of account and any IGC
// membership — only the entitlement row is flipped to 'revoked'.
export async function revokeScouting(formData: FormData) {
  const { user, service } = await requireAdminUser()
  const userId = String(formData.get('userId') || '')
  if (!userId) throw new Error('userId is required')

  const clubId = await getIgcClubId()
  const { error } = await service
    .from('feature_entitlements')
    .update({
      status: 'revoked',
      revoked_by: user.id,
      revoked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('club_id', clubId)
    .eq('feature_key', SCOUTING_FEATURE_KEY)
  if (error) throw error

  revalidatePath('/admin/scouting')
}

// Revoke a pending (unclaimed) invite so the link can no longer be used.
export async function revokeScoutingInvite(formData: FormData) {
  const { service } = await requireAdminUser()
  const inviteId = String(formData.get('inviteId') || '')
  if (!inviteId) throw new Error('inviteId is required')

  const clubId = await getIgcClubId()
  const { error } = await service
    .from('capability_invites')
    .update({ status: 'revoked', updated_at: new Date().toISOString() })
    .eq('id', inviteId)
    .eq('club_id', clubId)
    .eq('feature_key', SCOUTING_FEATURE_KEY)
    .eq('status', 'pending')
  if (error) throw error

  revalidatePath('/admin/scouting')
}

// Resend a pending invite with a fresh token (the old link is invalidated).
export async function resendScoutingInvite(formData: FormData) {
  const { service } = await requireAdminUser()
  const inviteId = String(formData.get('inviteId') || '')
  if (!inviteId) throw new Error('inviteId is required')

  const token = randomUUID()
  const clubId = await getIgcClubId()
  const { data, error } = await service
    .from('capability_invites')
    .update({
      invite_token: token,
      status: 'pending',
      updated_at: new Date().toISOString(),
    })
    .eq('id', inviteId)
    .eq('club_id', clubId)
    .eq('feature_key', SCOUTING_FEATURE_KEY)
    .eq('status', 'pending')
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .select('email, display_name')
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Invite not found')

  await sendScoutingInviteEmail(token, data.email as string, (data.display_name as string | null) ?? null)
  revalidatePath('/admin/scouting')
}
