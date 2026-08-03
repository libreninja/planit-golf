// Thin async wrapper: maps a league key to its competition key and delegates
// to the generic competition shell's server component. The old
// WeeklyResultsView / SeasonPointsTable / getLeagueSeasonPointsFromDB plumbing
// is replaced by the shared competition layer (task 26F).

import { StandingsWorkspaceServer } from '@/components/competition/standings-workspace-server'

export async function LeagueStandingsView({
  leagueKey,
  searchParams,
}: {
  leagueKey: 'mens' | 'womens'
  searchParams: Record<string, string | string[] | undefined>
}) {
  const competitionKey = leagueKey === 'mens' ? 'mens-league' : 'womens-league'
  return <StandingsWorkspaceServer competitionKey={competitionKey} searchParams={searchParams} />
}
