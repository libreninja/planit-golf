export const MENS_LEAGUE_DESTINATIONS = [
  { key: 'weekly', label: 'Weekly', href: '/igc/mens-league?view=weekly', view: 'weekly' },
  { key: 'season', label: 'Season', href: '/igc/mens-league?view=season', view: 'season' },
] as const

export type MensLeagueDestination = typeof MENS_LEAGUE_DESTINATIONS[number]['key']

export function isMensLeagueDestinationActive(
  destination: MensLeagueDestination,
  activeDestination: MensLeagueDestination,
): boolean {
  return destination === activeDestination
}

export function mensLeagueTeeSheetCompatibilityHref(
  searchParams: Record<string, string | string[] | undefined>,
): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === 'string') params.set(key, value)
    else if (Array.isArray(value)) value.forEach((item) => params.append(key, item))
  }
  params.set('view', 'weekly')
  return `/igc/mens-league?${params.toString()}`
}
