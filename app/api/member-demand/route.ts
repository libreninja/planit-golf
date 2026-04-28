import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getEventDemandCounts } from '@/lib/member-demand'

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const eventIds = (searchParams.get('eventIds') || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  if (eventIds.length === 0) {
    return NextResponse.json({ eventDemandCounts: {} })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('member_id')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile?.member_id) {
    return NextResponse.json({ eventDemandCounts: {} })
  }

  const { data: member } = await supabase
    .from('members')
    .select('league')
    .eq('id', profile.member_id)
    .maybeSingle()

  if (!member?.league) {
    return NextResponse.json({ eventDemandCounts: {} })
  }

  const serviceClient = createServiceClient()
  const eventDemandCounts = await getEventDemandCounts(serviceClient, member.league, eventIds)

  return NextResponse.json({ eventDemandCounts })
}
