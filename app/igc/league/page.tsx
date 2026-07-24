import { notFound } from 'next/navigation';
import { IGC_LEAGUES, getLeagueEvents, getLeagueWeeklyResults, getLeagueEvent } from '@/lib/igc/league';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { LeagueLeaderboard } from './league-leaderboard';

interface LeaguePageProps {
  searchParams: Promise<{ league?: string; week?: string }>;
}

export default async function LeaguePage({ searchParams }: LeaguePageProps) {
  const { league = 'mens', week } = await searchParams;

  const config = IGC_LEAGUES[league];
  if (!config) {
    notFound();
  }

  const weekNumber = week ? parseInt(week) : undefined;

  // Fetch data in parallel
  const [events, results, currentEvent] = await Promise.all([
    getLeagueEvents(league),
    getLeagueWeeklyResults(league, weekNumber),
    weekNumber ? getLeagueEvent(league, weekNumber) : Promise.resolve(null),
  ]);

  // Default to latest finalized event if none selected
  const selectedEvent =
    currentEvent ||
    events.find((e) => e.status === 'finalized' || e.status === 'live') ||
    events[0];

  const selectedWeek = weekNumber || selectedEvent?.week_number;

  return (
    <div>
      <div className="py-2">
        <div className="mb-8">
          <div className="mb-6 flex gap-2">
            <Button
              variant={league === 'mens' ? 'default' : 'outline'}
              size="sm"
              asChild
            >
              <Link href="/igc/league?league=mens">Men's League</Link>
            </Button>
            <Button
              variant={league === 'womens' ? 'default' : 'outline'}
              size="sm"
              asChild
            >
              <Link href="/igc/league?league=womens">Women's League</Link>
            </Button>
          </div>

          <h1 className="text-3xl font-bold mb-2">{config.name} Leaderboard</h1>
          <p className="text-muted-foreground">
            Live scores and weekly standings for the {config.name.toLowerCase()}.
          </p>
        </div>

        <LeagueLeaderboard
          leagueKey={league}
          events={events}
          results={results}
          selectedEvent={selectedEvent}
          selectedWeek={selectedWeek}
          hasFlights={config.hasFlights}
        />
      </div>
    </div>
  );
}
