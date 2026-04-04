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

  return null
}
