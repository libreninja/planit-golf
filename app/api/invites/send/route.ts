import { NextResponse } from 'next/server'
import { getProfileRoles } from '@/lib/auth'
import { sendInviteEmail } from '@/lib/email/mailer'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const roles = await getProfileRoles(user.id)
  if (!roles.is_admin && !roles.is_system_admin) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  const body = await request.json().catch(() => null) as { token?: string; email?: string } | null
  const token = body?.token?.trim()
  const email = body?.email?.trim()

  if (!token || !email) {
    return NextResponse.json({ error: 'Invite token and email are required' }, { status: 400 })
  }

  try {
    await sendInviteEmail(token, email)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error(error)
    const message = error instanceof Error ? error.message : 'Invite failed to send'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
