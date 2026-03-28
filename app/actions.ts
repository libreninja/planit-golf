'use server'

import { randomUUID } from 'crypto'
import { revalidatePath } from 'next/cache'
import { getProfileRoles } from '@/lib/auth'
import { sendInviteEmail } from '@/lib/email/mailer'
import { isConfiguredSystemAdminEmail } from '@/lib/system-admin'
import { createClient } from '@/lib/supabase/server'

export async function validateInviteForSignUp(email: string, inviteToken: string) {
  if (await isConfiguredSystemAdminEmail(email)) {
    return { valid: true }
  }

  if (!email || !inviteToken) {
    return { valid: false }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('validate_invite_token', {
    signup_email: email,
    signup_token: inviteToken,
  })

  return {
    valid: !error && data === true,
  }
}

async function requireAdmin() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) throw new Error('Not authenticated')

  const roles = await getProfileRoles(user.id)

  if (!roles.is_admin && !roles.is_system_admin) {
    throw new Error('Admin access required')
  }

  return supabase
}

export async function createInvite(memberId: string) {
  const supabase = await requireAdmin()
  const token = randomUUID()

  const { data: member, error: memberError } = await supabase
    .from('members')
    .select('email')
    .eq('id', memberId)
    .maybeSingle()

  if (memberError) throw memberError
  if (!member?.email) {
    throw new Error('Member is missing an email address')
  }

  const { error } = await supabase.from('invites').upsert(
    {
      member_id: memberId,
      invite_token: token,
      status: 'pending',
      claimed_by_user_id: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'member_id' },
  )

  if (error) throw error

  await sendInviteEmail(token, member.email)

  revalidatePath('/admin')
  revalidatePath('/admin/invites')
  return token
}

export async function revokeInvite(inviteId: string) {
  const supabase = await requireAdmin()

  const { error } = await supabase
    .from('invites')
    .update({
      status: 'revoked',
      updated_at: new Date().toISOString(),
    })
    .eq('id', inviteId)

  if (error) throw error

  revalidatePath('/admin')
  revalidatePath('/admin/invites')
}
