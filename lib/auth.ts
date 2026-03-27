import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export interface ProfileRoles {
  is_admin: boolean
  is_system_admin: boolean
}

export async function getUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
}

export async function requireAuth() {
  const user = await getUser()
  if (!user) {
    redirect('/login')
  }
  return user
}

export async function getProfileRoles(userId: string): Promise<ProfileRoles> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('profiles')
    .select('is_admin, is_system_admin')
    .eq('id', userId)
    .maybeSingle()

  return {
    is_admin: data?.is_admin === true,
    is_system_admin: data?.is_system_admin === true,
  }
}

export async function isAdmin(userId: string) {
  const roles = await getProfileRoles(userId)
  return roles.is_admin || roles.is_system_admin
}

export async function requireAdmin() {
  const user = await requireAuth()
  const roles = await getProfileRoles(user.id)

  if (!roles.is_admin && !roles.is_system_admin) {
    redirect('/')
  }

  return { user, roles }
}

export async function requireSystemAdmin() {
  const user = await requireAuth()
  const roles = await getProfileRoles(user.id)

  if (!roles.is_system_admin) {
    redirect('/')
  }

  return { user, roles }
}
