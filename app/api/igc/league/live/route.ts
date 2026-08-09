import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { getLiveResults } from '@/lib/competition/live'
import { authorizeLiveRead, resolveCompetitionVisibility } from '@/lib/competition/live-auth'

// Compatibility handler for the legacy /api/igc/league/live endpoint. Parses
// legacy params (league=mens|womens, week=N), maps them to the generic request,
// and invokes the SAME getLiveResults function the generic route uses. Does
// NOT redirect. Returns the same normalized response shape. Removed in a later
// cleanup. See design spec §4.
export const dynamic = 'force-dynamic'

async function authenticatedUserId(): Promise<string | undefined> {
  const supabase = await createClient()
  const claims: any = await supabase.auth.getClaims()
  const id = claims.data?.claims?.sub as string | undefined
  if (id) return id
  const user: any = await supabase.auth.getUser()
  return user.data?.user?.id as string | undefined
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const league = url.searchParams.get('league')
  const weekParam = url.searchParams.get('week')
  if (league !== 'mens' && league !== 'womens') {
    return NextResponse.json({ error: 'Invalid league' }, { status: 400 })
  }
  const week = weekParam ? Number.parseInt(weekParam, 10) : NaN
  if (!Number.isFinite(week)) {
    return NextResponse.json({ error: 'Invalid week' }, { status: 400 })
  }

  const competitionKey = league === 'mens' ? 'mens-league' : 'womens-league'
  // Authorize by competition visibility (the leagues are public) — same shared
  // boundary as the generic route, so anonymous viewers poll freely. See
  // lib/competition/live-auth.ts.
  const userId = await authenticatedUserId()
  const decision = authorizeLiveRead(resolveCompetitionVisibility(competitionKey), !!userId)
  if (!decision.allowed) {
    return NextResponse.json({ error: decision.reason }, { status: decision.status })
  }

  const scoring = (url.searchParams.get('scoring') as 'gross' | 'net') || 'net'
  try {
    const nowIso = new Date().toISOString()
    const results = await getLiveResults({ competitionKey, occurrenceId: String(week), scoring, nowIso })
    return NextResponse.json({ results })
  } catch (err) {
    console.error(`[api/igc/league/live] ${league} wk${week}:`, err)
    return NextResponse.json({ error: 'Failed to fetch live results' }, { status: 502 })
  }
}
