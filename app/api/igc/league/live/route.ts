import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { fetchLeagueLiveResults } from '@/lib/igc/weekly-results'

// Live league round results, polled by the client's WeeklyResultsView while an
// in-progress round is the selected week. Reads the GG round/tournament ids
// from the persisted event row, then fetches the fresh Golf Genius results
// payload and parses it into the same view model the completed-round path
// serves from the database — so live and completed rounds render identically.
//
// Auth-gated (the app shell is authenticated-only; this endpoint must enforce
// the same gate since it's a server-side GG fetch keyed only by the league +
// week, which a client could otherwise call unauthenticated). No caching: the
// whole point is a fresh leaderboard on each poll.
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const supabase = await createClient()

  // Auth gate. Prefer claims (cheap); fall back to getUser for older sessions.
  let userId: string | undefined
  const claimsResult: any = await supabase.auth.getClaims()
  userId = claimsResult.data?.claims?.sub as string | undefined
  if (!userId) {
    const userResult: any = await supabase.auth.getUser()
    userId = userResult.data?.user?.id as string | undefined
  }
  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const url = new URL(request.url)
  const league = url.searchParams.get('league')
  const weekParam = url.searchParams.get('week')

  if (league !== 'mens' && league !== 'womens') {
    return NextResponse.json({ error: 'Invalid league' }, { status: 400 })
  }
  const weekNumber = weekParam ? Number.parseInt(weekParam, 10) : NaN
  if (!Number.isFinite(weekNumber)) {
    return NextResponse.json({ error: 'Invalid week' }, { status: 400 })
  }

  try {
    const results = await fetchLeagueLiveResults(league, weekNumber)
    if (!results) {
      return NextResponse.json({ error: 'No live round found for this week' }, { status: 404 })
    }
    return NextResponse.json({ results })
  } catch (err) {
    console.error(`[api/igc/league/live] fetch failed for ${league} wk${weekNumber}:`, err)
    return NextResponse.json({ error: 'Failed to fetch live results' }, { status: 502 })
  }
}