'use server'

// Pre-signup validation for a Seattle Cup capability invite. Mirrors the GTG
// validateInviteForSignUp but uses the capability-invite RPC and does NOT touch
// the members-anchored GTG invite tables. Returns whether the invite is valid
// for this email and, if so, whether an auth.users account already exists
// (confirmed/unconfirmed) so the form can route accordingly.

import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export async function validateCapabilityInviteForSignUp(email: string, token: string) {
  if (!email || !token) {
    return { valid: false, authStatus: 'none' as const }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('validate_capability_invite', {
    p_email: email,
    p_token: token,
  })

  if (error || data !== true) {
    return { valid: false, authStatus: 'none' as const }
  }

  const serviceClient = createServiceClient()
  const normalizedEmail = email.trim().toLowerCase()
  const { data: usersData, error: usersError } = await serviceClient.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  })
  if (usersError) {
    throw usersError
  }

  const existingUser = usersData.users.find(
    (user) => (user.email || '').trim().toLowerCase() === normalizedEmail
  )

  return {
    valid: true,
    authStatus: existingUser
      ? existingUser.email_confirmed_at
        ? ('confirmed' as const)
        : ('unconfirmed' as const)
      : ('none' as const),
  }
}

export const validateScoutingInviteForSignUp = validateCapabilityInviteForSignUp
