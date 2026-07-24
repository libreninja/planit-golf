import { NextResponse, type NextRequest } from 'next/server'

// Temporary compat redirect for anyone who bookmarked the old Good to Go URL
// (`/` on main). 307 (temporary) so we can change the destination later without
// fighting browser caches. The destination preserves the full GTG data flow and
// invite-gated access. See production rollout plan (Phase 1).
export function GET(req: NextRequest) {
  const url = req.nextUrl.clone()
  url.pathname = '/igc/mens-league/tee-times'
  url.search = ''
  return NextResponse.redirect(url, 307)
}