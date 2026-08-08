import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { getChampionshipAggregate } from '@/lib/competition/aggregate-reader'

export const dynamic = 'force-dynamic'

async function authenticatedUserId(): Promise<string | undefined> {
  const supabase = await createClient()
  const claims: any = await supabase.auth.getClaims()
  const id = claims.data?.claims?.sub as string | undefined
  if (id) return id
  const user: any = await supabase.auth.getUser()
  return user.data?.user?.id as string | undefined
}

// Live-poll endpoint for the Club Championship aggregate. Mirrors
// /api/competition/live but builds the cross-occurrence aggregate instead of a
// single occurrence. Auth-gated the same way (public standings require a
// logged-in viewer). Returns { results: ChampionshipAggregate }.
export async function GET(request: Request) {
  const userId = await authenticatedUserId()
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const url = new URL(request.url)
  const competition = url.searchParams.get('competition') ?? 'mens-league'
  const championship = url.searchParams.get('championship') ?? 'club-championship'
  const scoring = (url.searchParams.get('scoring') as 'gross' | 'net') || 'gross'
  try {
    const nowIso = new Date().toISOString()
    const results = await getChampionshipAggregate(competition, championship, scoring, nowIso)
    return NextResponse.json({ results })
  } catch (err) {
    console.error(`[api/competition/championship] ${competition}/${championship}:`, err)
    return NextResponse.json({ error: 'Failed to fetch championship aggregate' }, { status: 502 })
  }
}