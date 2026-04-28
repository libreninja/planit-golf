import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const claimsResult: any = await supabase.auth.getClaims()
  const claims = claimsResult.data?.claims
  let userId = claims?.sub as string | undefined

  if (!userId) {
    const userResult: any = await supabase.auth.getUser()
    userId = userResult.data?.user?.id
  }

  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const [defaultPrefsResult, eventPrefsResult] = await Promise.all([
    supabase
      .from('default_preferences')
      .select('tee_time_preferences')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('event_preferences')
      .select('event_id, tee_time_preferences, skip_registration')
      .eq('user_id', userId),
  ])

  return NextResponse.json({
    defaultPrefs: defaultPrefsResult.data,
    eventPrefs: eventPrefsResult.data || [],
  })
}
