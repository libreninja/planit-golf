import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { getChampionshipAggregate } from '@/lib/competition/aggregate-reader'
import { authorizeLiveRead, resolveCompetitionVisibility } from '@/lib/competition/live-auth'

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
// single occurrence. Authorizes by COMPETITION VISIBILITY (the Club
// Championship is a public mens-league competition) so anonymous viewers can
// follow live scores without a Planit account — same model as the per-week
// live endpoint. See lib/competition/live-auth.ts.
export async function GET(request: Request) {
  const url = new URL(request.url)
  const competition = url.searchParams.get('competition') ?? 'mens-league'
  const championship = url.searchParams.get('championship') ?? 'club-championship'
  const scoring = (url.searchParams.get('scoring') as 'gross' | 'net') || 'gross'

  const userId = await authenticatedUserId()
  const decision = authorizeLiveRead(resolveCompetitionVisibility(competition), !!userId)
  if (!decision.allowed) {
    return NextResponse.json({ error: decision.reason }, { status: decision.status })
  }

  try {
    const nowIso = new Date().toISOString()
    const results = await getChampionshipAggregate(competition, championship, scoring, nowIso)
    return NextResponse.json({ results })
  } catch (err) {
    console.error(`[api/competition/championship] ${competition}/${championship}:`, err)
    return NextResponse.json({ error: 'Failed to fetch championship aggregate' }, { status: 502 })
  }
}