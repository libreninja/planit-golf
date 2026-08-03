import { LeagueStandingsView } from '@/components/igc/league-standings-view'

export const dynamic = 'force-dynamic'

interface WomensStandingsProps {
  searchParams: Promise<{ week?: string; view?: string; scoring?: string; grouping?: string }>
}

// Women's League standings — a direct route, peer to /igc/mens-league. There
// is no Men's/Women's toggle and no default league; each league has its own
// navigation entry and route. The whole widened searchParams object is
// forwarded to the shared competition shell (task 26F).
export default async function WomensStandingsPage({ searchParams }: WomensStandingsProps) {
  const sp = await searchParams
  return <LeagueStandingsView leagueKey="womens" searchParams={sp} />
}
