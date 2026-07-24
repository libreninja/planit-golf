import { notFound } from 'next/navigation';
import { IGC_LEAGUES, getLeagueEvents, getLeagueWeeklyResults, getLeagueEvent } from '@/lib/igc/league';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { LeagueLeaderboard } from './league-leaderboard';

interface LeaguePageProps {
  searchParams: Promise<{ league?: string; week?: string }>;
}

// Pacific-tz calendar today (YYYY-MM-DD), matching the convention
// lib/app-shell/dashboard uses for registration buckets.
function pacificToday(): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = Object.fromEntries(
    formatter
      .formatToParts(new Date())
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, p.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}`
}

export default async function LeaguePage({ searchParams }: LeaguePageProps) {
  const { league = 'mens', week } = await searchParams;

  const config = IGC_LEAGUES[league];
  if (!config) {
    notFound();
  }

  const weekNumber = week ? parseInt(week) : undefined;

  // Fetch events (and an explicitly-selected week) in parallel. Weekly results
  // are fetched separately, scoped to the resolved week — see below.
  const [events, currentEvent] = await Promise.all([
    getLeagueEvents(league),
    weekNumber ? getLeagueEvent(league, weekNumber) : Promise.resolve(null),
  ]);

  // Choose the week to show when none is selected. Prefer a live week, then the
  // next upcoming week (today or later), then the most recent finalized week.
  // We deliberately do NOT fall back to the first event in the list when that
  // event is stale synced data from a past week — there is simply nothing
  // current to show, and the leaderboard renders an honest empty state.
  const today = pacificToday();
  const liveEvent = events.find((e) => e.status === 'live');
  const nextUpcoming = events
    .filter((e) => e.status === 'upcoming' && e.event_date && e.event_date >= today)
    .sort((a, b) => (a.event_date! < b.event_date! ? -1 : 1))[0];
  const latestFinalized = events.find((e) => e.status === 'finalized');
  const selectedEvent =
    currentEvent || liveEvent || nextUpcoming || latestFinalized || null;

  const selectedWeek = weekNumber || selectedEvent?.week_number;

  // Only load results for a concrete week. Without a resolved week we show no
  // results rather than dumping every week's stale performances at once.
  const results = selectedWeek
    ? await getLeagueWeeklyResults(league, selectedWeek)
    : [];

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
            Weekly standings and results for the {config.name.toLowerCase()}.
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
