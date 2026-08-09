import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { getLiveResults } from '@/lib/competition/live'
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

export async function GET(request: Request) {
  const url = new URL(request.url)
  const competition = url.searchParams.get('competition')
  const occurrence = url.searchParams.get('occurrence')
  const scoring = (url.searchParams.get('scoring') as 'gross' | 'net') || 'net'
  if (!competition || !occurrence) {
    return NextResponse.json({ error: 'competition and occurrence required' }, { status: 400 })
  }

  // Authorize by COMPETITION VISIBILITY, not login. A public competition (the
  // IGC leagues) is readable anonymously so golfers can share the live
  // leaderboard link without a Planit account; a private competition still
  // requires auth. The userId is still resolved (for future per-user behavior
  // / telemetry) but never required for public reads. See live-auth.ts.
  const userId = await authenticatedUserId()
  const decision = authorizeLiveRead(resolveCompetitionVisibility(competition), !!userId)
  if (!decision.allowed) {
    return NextResponse.json({ error: decision.reason }, { status: decision.status })
  }

  try {
    const nowIso = new Date().toISOString()
    const results = await getLiveResults({ competitionKey: competition, occurrenceId: occurrence, scoring, nowIso })
    return NextResponse.json({ results })
  } catch (err) {
    console.error(`[api/competition/live] ${competition}/${occurrence}:`, err)
    return NextResponse.json({ error: 'Failed to fetch live results' }, { status: 502 })
  }
}
