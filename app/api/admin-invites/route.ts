import { NextResponse } from 'next/server'
import { getProfileRoles } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'

function toArray<T>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) return value
  if (value == null) return []
  return [value]
}

async function requireAdminRequest() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return null
  }

  const roles = await getProfileRoles(user.id)
  if (!roles.is_admin && !roles.is_system_admin) {
    return null
  }

  return user
}

export async function GET() {
  const user = await requireAdminRequest()
  if (!user) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  }

  const serviceClient = createServiceClient()
  const { data: members } = await serviceClient
    .from('members')
    .select(`
      id,
      display_name,
      email,
      roster_email,
      email_override,
      phone,
      golf_member_name,
      golf_member_id,
      active,
      invites (
        id,
        status,
        invite_token
      )
    `)
    .eq('active', true)
    .order('display_name', { ascending: true })

  const inviteRows = (members || []).map((member) => ({
    id: member.id,
    display_name: member.display_name,
    email: member.email,
    roster_email: member.roster_email,
    email_override: member.email_override,
    phone: member.phone,
    golf_member_name: member.golf_member_name,
    golf_member_id: member.golf_member_id,
    active: member.active,
    invites: toArray(member.invites).map((invite) => ({
      id: invite.id,
      status: invite.status,
      invite_token: invite.invite_token,
    })),
  }))

  return NextResponse.json({ inviteRows })
}
