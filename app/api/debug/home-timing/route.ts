import { NextResponse } from 'next/server'
import { loadHomePageData } from '@/lib/home-page-data'
import { RequestTimer } from '@/lib/server-timing'

export async function GET() {
  const timer = new RequestTimer()
  const homeData = await loadHomePageData(timer)
  timer.finishTotal()

  return NextResponse.json(
    {
      timings: timer.toJSON(),
      summary: {
        userId: homeData.user.id,
        eventCount: homeData.events.length,
        hasProfile: Boolean(homeData.profile),
        hasMemberId: Boolean(homeData.profile?.member_id),
        hasInviteId: Boolean(homeData.profile?.invite_id),
      },
    },
    {
      headers: {
        'Cache-Control': 'no-store',
        'Server-Timing': timer.toHeader(),
      },
    },
  )
}
