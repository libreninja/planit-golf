import { notFound } from 'next/navigation'

import {
  IGC_LEAGUES,
  getLeagueEvents,
  getLeagueWeeklyResults,
  getLeagueWeeksWithResults,
} from '@/lib/igc/league'
import { resolveStandingsEvent } from '@/lib/igc/event-selection'
import { pacificToday } from '@/lib/pacific-time'
import { LeagueLeaderboard } from '@/app/igc/league/league-leaderboard'

// Shared standings view for a single league. Men's and Women's League are peer
// domain entities, each with its own direct route (/igc/mens-league,
// /igc/womens-league); there is no Men's/Women's toggle and no default league.
// The heading names the league explicitly so the current context is obvious.
//
// The default event shown is chosen from real source data (event dates + which
// weeks actually have scored results), never from the unreliable status column
// or from hardcoded dates/week numbers. See lib/igc/event-selection.ts.
export async function LeagueStandingsView({
  leagueKey,
  week,
}: {
  leagueKey: 'mens' | 'womens'
  week?: string
}) {
  const config = IGC_LEAGUES[leagueKey]
  if (!config) {
    notFound()
  }

  const weekNumber = week ? Number.parseInt(week, 10) : undefined
  const today = pacificToday()

  const [events, weeksWithResults] = await Promise.all([
    getLeagueEvents(leagueKey),
    getLeagueWeeksWithResults(leagueKey),
  ])

  const selectedEvent = resolveStandingsEvent(
    Number.isFinite(weekNumber) ? weekNumber : undefined,
    events,
    weeksWithResults,
    today,
  )

  const selectedWeek =
    Number.isFinite(weekNumber) ? weekNumber : selectedEvent?.week_number

  // Only load results for a concrete week. Without a resolved week we show no
  // results rather than dumping every week's performances at once.
  const results = selectedWeek
    ? await getLeagueWeeklyResults(leagueKey, selectedWeek)
    : []

  const basePath = leagueKey === 'mens' ? '/igc/mens-league' : '/igc/womens-league'

  return (
    <div>
      <div className="py-2">
        <div className="mb-8">
          <h1 className="mb-2 text-3xl font-bold">{config.name} Standings</h1>
          <p className="text-muted-foreground">
            Weekly standings and results for the {config.name.toLowerCase()}.
          </p>
        </div>

        <LeagueLeaderboard
          basePath={basePath}
          events={events}
          results={results}
          selectedEvent={selectedEvent}
          selectedWeek={selectedWeek}
          hasFlights={config.hasFlights}
        />
      </div>
    </div>
  )
}