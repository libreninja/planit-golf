import { LeagueStandingsView } from '@/components/igc/league-standings-view'

export const dynamic = 'force-dynamic'

interface WomensStandingsProps {
  searchParams: Promise<{ week?: string }>
}

// Women's League standings — a direct route, peer to /igc/mens-league. There
// is no Men's/Women's toggle and no default league; each league has its own
// navigation entry and route.
export default async function WomensStandingsPage({ searchParams }: WomensStandingsProps) {
  const { week } = await searchParams
  return <LeagueStandingsView leagueKey="womens" week={week} />
}