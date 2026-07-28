import { LeagueStandingsView } from '@/components/igc/league-standings-view'

export const dynamic = 'force-dynamic'

interface MensStandingsProps {
  searchParams: Promise<{ week?: string }>
}

// Men's League standings — a direct route, peer to /igc/womens-league. There
// is no Men's/Women's toggle and no default league; each league has its own
// navigation entry and route.
export default async function MensStandingsPage({ searchParams }: MensStandingsProps) {
  const { week } = await searchParams
  return <LeagueStandingsView leagueKey="mens" week={week} />
}