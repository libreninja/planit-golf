import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createParticipantScorecardService } from '@/lib/events/participant-scorecard'
import { EventScoringError } from '@/lib/events/scoring'
import { privateHeaders, requireScorecardOrigin, scorecardCookie, scorecardError, scorecardJson } from '@/lib/events/participant-http'

export async function POST(request: Request) {
  try {
    requireScorecardOrigin(request)
    const body = await scorecardJson(request)
    if (!body || typeof body !== 'object' || Object.keys(body).length !== 1
      || !('token' in body) || typeof body.token !== 'string') throw new EventScoringError('22023', 'Invalid link')
    const card = await createParticipantScorecardService(createServiceClient()).read(body.token)
    const response = NextResponse.json(card, { headers: privateHeaders })
    response.cookies.set(scorecardCookie, body.token, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production' || new URL(request.url).protocol === 'https:',
      sameSite: 'strict', path: '/api/scorecard',
    })
    return response
  } catch (error) {
    // A failed new link must not fall back to a previously opened group's card.
    const failure = scorecardError(error)
    const response = new NextResponse(await failure.text(), {
      status: failure.status, headers: { ...privateHeaders, 'Content-Type': 'application/json' },
    })
    response.cookies.set(scorecardCookie, '', { httpOnly: true, sameSite: 'strict', path: '/api/scorecard', maxAge: 0 })
    return response
  }
}
