import { EventScoringError } from './scoring.ts'

export const scorecardCookie = 'planit_scorecard'
export const privateHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
}

export function requireScorecardOrigin(request: Request) {
  const target = new URL(request.url)
  // Next may use the listener address internally (e.g. 0.0.0.0). Host is
  // browser-controlled routing metadata, never a client-selected JSON field.
  target.host = request.headers.get('host') ?? target.host
  if (request.headers.get('origin') !== target.origin
    || request.headers.get('content-type')?.split(';')[0] !== 'application/json') {
    throw new EventScoringError('P1011', 'Invalid request origin')
  }
}

export function scorecardError(error: unknown) {
  const code = error instanceof EventScoringError ? error.code : 'unavailable'
  const status = code === 'P1010' ? 401 : code === 'P1011' ? 403
    : ['P1002', 'P1003'].includes(code) ? 409 : ['22023', 'P1001'].includes(code) ? 400 : 503
  const message = status === 401 ? 'This scorecard link has expired or is no longer available. Ask your organizer for a new link.'
    : code === 'P1002' ? 'Another scorer changed this score. Review the latest score before saving your correction.'
      : status === 403 ? 'This link cannot score that group or player.'
        : status === 400 ? 'Unable to save. Check the score and whether this round is still open.'
          : status === 409 ? 'This save conflicts with an earlier request. Reload current scores before trying again.'
            : 'Unable to reach scoring. Your entries are still here; try again.'
  return Response.json({ code, error: message }, { status, headers: privateHeaders })
}

export async function scorecardJson(request: Request): Promise<unknown> {
  // Bound even chunked requests; no arbitrary payload retained or logged.
  const reader = request.body?.getReader()
  if (!reader) throw new EventScoringError('22023', 'Missing body')
  const chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > 2048) {
      await reader.cancel()
      throw new EventScoringError('22023', 'Body too large')
    }
    chunks.push(value)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString()) }
  catch { throw new EventScoringError('22023', 'Invalid JSON') }
}
