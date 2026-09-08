export const MENS_LEAGUE_DESTINATIONS = [
  { key: 'season', label: 'Season', href: '/igc/mens-league?view=season', view: 'season' },
  { key: 'weekly', label: 'Weekly', href: '/igc/mens-league?view=weekly', view: 'weekly' },
  { key: 'tee-sheet', label: 'Tee Sheet', href: '/igc/mens-league/tee-sheet', view: null },
] as const

export type MensLeagueDestination = typeof MENS_LEAGUE_DESTINATIONS[number]['key']

export function isMensLeagueDestinationActive(
  destination: MensLeagueDestination,
  activeDestination: MensLeagueDestination,
): boolean {
  return destination === activeDestination
}
