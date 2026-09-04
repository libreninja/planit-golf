export interface PlayerSourceContext {
  golferId: string
  week?: string | null
  returnTo?: string | null
  allRounds?: boolean
}

export function safeInternalReturnTo(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null
  return value
}

export function playerDetailHref(input: PlayerSourceContext): string {
  const params = new URLSearchParams()
  if (input.week) params.set('week', input.week)
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
}): string | null {
  if (!input.memberCardId) return null
  const golferId = input.golferIdsByMemberCard[input.memberCardId]
  return golferId ? playerDetailHref({ golferId, week: input.week, returnTo: input.returnTo }) : null
}
