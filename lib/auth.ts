import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

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

export async function isAdmin(userId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('trips')
    .select('id')
    .eq('created_by', userId)
    .limit(1)
    .single()

  // If user has created at least one trip, they're an admin
  return !error && data !== null
}

