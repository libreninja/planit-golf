import { cookies } from 'next/headers'
import { createServiceClient } from '@/lib/supabase/service'
import { createParticipantScorecardService } from '@/lib/events/participant-scorecard'
import { privateHeaders, requireScorecardOrigin, scorecardCookie, scorecardError, scorecardJson } from '@/lib/events/participant-http'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const token = (await cookies()).get(scorecardCookie)?.value ?? ''
    const card = await createParticipantScorecardService(createServiceClient()).read(token)
    return Response.json(card, { headers: privateHeaders })
  } catch (error) { return scorecardError(error) }
}

export async function POST(request: Request) {
  try {
    requireScorecardOrigin(request)
    const token = (await cookies()).get(scorecardCookie)?.value ?? ''
    const receipt = await createParticipantScorecardService(createServiceClient())
      .recordGrossScore(token, await scorecardJson(request))
    // Only the score result needed by this client; full provenance stays private.
    return Response.json({ participantId: receipt.participant_id, hole: receipt.hole,
      gross: receipt.gross, revision: receipt.revision, recordedAt: receipt.recorded_at }, { headers: privateHeaders })
  } catch (error) { return scorecardError(error) }
}
