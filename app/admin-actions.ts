'use server'

import { revalidatePath } from 'next/cache'
import { getProfileRoles } from '@/lib/auth'
import { syncMembersFromGolfGenius, testGolfGeniusConnection } from '@/lib/golfgenius-sync'
import { createClient } from '@/lib/supabase/server'

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

  return user
}

export async function syncRoster() {
  await requireAdmin()
  return await syncMembersFromGolfGenius()
}

export async function syncRosterAndRefresh() {
  await requireAdmin()
  const result = await syncMembersFromGolfGenius()
  revalidatePath('/admin')
  return result
}

export async function testRosterConnection() {
  await requireAdmin()
  return await testGolfGeniusConnection()
}
