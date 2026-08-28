import { NextResponse } from 'next/server'

import { getSeattleCupLive } from '@/lib/seattle-cup/live'
import { ROUND_LIST } from '@/lib/seattle-cup/config'
import { calculateSeattleCupRaceStatus } from '@/lib/seattle-cup/race'
import { getSeattleCupTournamentResolution } from '@/lib/seattle-cup/playoff-store'
import { authorizeLiveRead, resolveCompetitionVisibility } from '@/lib/competition/live-auth'
import type { SeattleCupRoundResponse } from '@/lib/seattle-cup/types'

export const dynamic = 'force-dynamic'

// CORS: the seattle-cup live API is consumed by the separate seattlecup.golf
// site. Restrict the Allow-Origin to the configured Seattle Cup origins (never
// the league cache's blanket `*`) so only seattlecup.golf / localhost may read
// it cross-origin. Same-origin planit.golf requests need no CORS header. The
// response body is the normalized SeattleCupRoundSnapshot plus the shared
// tournament raceStatus — no raw GG payload is exposed. See ground-truth
// report §6 + locked CORS constraint.
const DEFAULT_ORIGINS = 'https://seattlecup.golf,https://www.seattlecup.golf'
function allowedOrigin(requestOrigin: string | null): string | null {
  if (!requestOrigin) return null
  const configured = (process.env.SEATTLE_CUP_ALLOWED_ORIGINS ?? DEFAULT_ORIGINS)
    .split(',').map((s) => s.trim()).filter(Boolean)
  // Always permit localhost dev origins.
  const localhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/
  if (localhost.test(requestOrigin)) return requestOrigin
  if (configured.includes(requestOrigin)) return requestOrigin
  return null
}

function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '300',
  }
}

export async function OPTIONS(request: Request) {
  const origin = allowedOrigin(request.headers.get('origin'))
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) })
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const roundParam = url.searchParams.get('round')
  const round = roundParam ? Number(roundParam) : NaN

  // Validate round: 1-4 only.
  if (!Number.isInteger(round) || round < 1 || round > 4) {
    return NextResponse.json({ error: 'round query param must be 1-4' }, { status: 400 })
  }

  // Authorize by competition visibility. seattle-cup is public, so anonymous
  // reads are allowed — but we still run the check so an unknown/typo'd
  // competition key can never fall through to "allow by default".
  const decision = authorizeLiveRead(resolveCompetitionVisibility('seattle-cup'), false)
  if (!decision.allowed) {
    return NextResponse.json({ error: decision.reason }, { status: decision.status })
  }

  const origin = allowedOrigin(request.headers.get('origin'))

  try {
    // Race state is tournament-level, so read the four independently cached
    // normalized rounds and attach the same small contract to every existing
    // round response. Concurrent CupCentral requests collapse through the
    // existing per-round single-flight/cache layer.
    const snapshots = await Promise.all(
      ROUND_LIST.map((definition) => getSeattleCupLive({ round: definition.round })),
    )
    const snapshot = snapshots.find((candidate) => candidate.round === round)
    if (!snapshot) throw new Error(`normalized round ${round} missing`)
    const response: SeattleCupRoundResponse = {
      ...snapshot,
      raceStatus: calculateSeattleCupRaceStatus(snapshots),
      tournamentResolution: await getSeattleCupTournamentResolution(snapshots),
    }
    return NextResponse.json(response, { headers: corsHeaders(origin) })
  } catch (err) {
    console.error(`[api/seattle-cup/live] round ${round}:`, err)
    return NextResponse.json({ error: 'Failed to fetch Seattle Cup live results' }, { status: 502, headers: corsHeaders(origin) })
  }
}
