import type { SupabaseClient } from '@supabase/supabase-js'

interface LinkInviteParams {
  serviceClient: SupabaseClient
  userId: string
  email: string
  displayName?: string | null
  inviteToken?: string | null
}

interface InviteLinkResult {
  inviteId: string
  memberId: string
}

type InviteJoinRow = {
  id: string
  member_id: string
  claimed_by_user_id?: string | null
  members?: {
    id: string
    display_name: string | null
    phone: string | null
  } | {
    id: string
    display_name: string | null
    phone: string | null
  }[] | null
}

function getJoinedMember(invite: InviteJoinRow) {
  if (Array.isArray(invite.members)) {
    return invite.members[0] ?? null
  }

  return invite.members ?? null
}

async function syncProfileToInvite(
  serviceClient: SupabaseClient,
  userId: string,
  email: string,
  displayName: string | null | undefined,
  invite: InviteJoinRow,
) {
  const member = getJoinedMember(invite)

  await serviceClient
    .from('profiles')
    .update({
      member_id: invite.member_id,
      invite_id: invite.id,
      display_name: displayName ?? member?.display_name ?? null,
      email,
      phone: member?.phone ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId)
}

export async function ensureInviteLinkForUser({
  serviceClient,
  userId,
  email,
  displayName,
  inviteToken,
}: LinkInviteParams): Promise<InviteLinkResult | null> {
  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedEmail) {
    return null
  }

  await serviceClient
    .from('profiles')
    .upsert({
      id: userId,
      email: normalizedEmail,
      display_name: displayName ?? normalizedEmail.split('@')[0],
      updated_at: new Date().toISOString(),
    })

  if (inviteToken) {
    const { data: claimResult } = await serviceClient.rpc('claim_invite_for_user', {
      claim_user_id: userId,
      claim_email: normalizedEmail,
      claim_token: inviteToken,
      claim_display_name: displayName ?? null,
    })

    const claimedInvite = Array.isArray(claimResult) ? claimResult[0] : claimResult
    if (claimedInvite?.member_id && claimedInvite?.invite_id) {
      return {
        inviteId: claimedInvite.invite_id,
        memberId: claimedInvite.member_id,
      }
    }
  }

  const { data: existingClaim } = await serviceClient
    .from('invites')
    .select(`
      id,
      member_id,
      claimed_by_user_id,
      members (
        id,
        display_name,
        phone
      )
    `)
    .eq('claimed_by_user_id', userId)
    .eq('members.email', normalizedEmail)
    .eq('status', 'claimed')
    .maybeSingle()

  if (existingClaim) {
    await syncProfileToInvite(serviceClient, userId, normalizedEmail, displayName, existingClaim)
    return {
      inviteId: existingClaim.id,
      memberId: existingClaim.member_id,
    }
  }

  const { data: pendingInvite } = await serviceClient
    .from('invites')
    .select(`
      id,
      member_id,
      members (
        id,
        display_name,
        phone
      )
    `)
    .eq('status', 'pending')
    .eq('members.email', normalizedEmail)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!pendingInvite) {
    return null
  }

  await serviceClient
    .from('invites')
    .update({
      status: 'claimed',
      claimed_by_user_id: userId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', pendingInvite.id)

  await syncProfileToInvite(serviceClient, userId, normalizedEmail, displayName, pendingInvite)

  return {
    inviteId: pendingInvite.id,
    memberId: pendingInvite.member_id,
  }
}
