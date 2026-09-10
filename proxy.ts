import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === '/scorecard' || (request.nextUrl.pathname === '/api/scorecard' || request.nextUrl.pathname.startsWith('/api/scorecard/'))) {
    const headers = new Headers(request.headers)
    // Overwrite caller input; this only bypasses optional account-shell lookup.
    headers.set('x-planit-participant-page', request.nextUrl.pathname === '/scorecard' ? '1' : '0')
    const response = NextResponse.next({ request: { headers } })
    response.headers.set('Cache-Control', 'private, no-store')
    response.headers.set('Referrer-Policy', 'no-referrer')
    response.headers.set('X-Frame-Options', 'DENY')
    response.headers.set('X-Robots-Tag', 'noindex, nofollow')
    return response
  }
  request.headers.delete('x-planit-participant-page')
  return updateSession(request)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
