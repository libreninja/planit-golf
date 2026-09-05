export interface PlayerSourceContext {
  golferId: string
  week?: string | null
  returnTo?: string | null
  allRounds?: boolean
  scoring?: 'gross' | 'net' | null
}

export function safeInternalReturnTo(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null
  return value
}

export function scoringFromPlayerSource(
  value: string | null | undefined,
  returnTo: string | null | undefined,
): 'gross' | 'net' | null {
  if (value === 'gross' || value === 'net') return value
  const safeReturnTo = safeInternalReturnTo(returnTo)
  if (!safeReturnTo) return null
  const sourceScoring = new URL(safeReturnTo, 'https://planit.local').searchParams.get('scoring')
  return sourceScoring === 'gross' || sourceScoring === 'net' ? sourceScoring : null
}

export function playerDetailHref(input: PlayerSourceContext): string {
  const params = new URLSearchParams()
  if (input.week) params.set('week', input.week)
  if (input.scoring) params.set('scoring', input.scoring)
  const returnTo = safeInternalReturnTo(input.returnTo)
  if (returnTo) params.set('from', returnTo)
  if (input.allRounds) params.set('all', '1')
  const query = params.toString()
  return `/players/${encodeURIComponent(input.golferId)}${query ? `?${query}` : ''}`
}

export function playerDetailHrefForMemberCard(input: {
  memberCardId: string | null
  golferIdsByMemberCard: Record<string, string>
  week?: string | null
  returnTo?: string | null
  scoring?: 'gross' | 'net' | null
}): string | null {
  if (!input.memberCardId) return null
  const golferId = input.golferIdsByMemberCard[input.memberCardId]
  return golferId ? playerDetailHref({
    golferId,
    week: input.week,
    returnTo: input.returnTo,
    scoring: input.scoring,
  }) : null
}

export function playerPerformanceHref(input: {
  golferId: string
  returnTo?: string | null
  compare?: 'flight' | 'field' | null
}): string {
  const params = new URLSearchParams()
  if (input.compare) params.set('compare', input.compare)
  const returnTo = safeInternalReturnTo(input.returnTo)
  if (returnTo) params.set('from', returnTo)
  const query = params.toString()
  return `/players/${encodeURIComponent(input.golferId)}/performance${query ? `?${query}` : ''}`
}
