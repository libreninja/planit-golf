import { notFound } from 'next/navigation'

import {
  IGC_LEAGUES,
  getLeagueEvents,
  getLeagueLastSyncedAt,
  getLeagueWeeksWithResults,
} from '@/lib/igc/league'
import {
  resolveStandingsEvent,
  toDateKey,
} from '@/lib/igc/event-selection'
import {
  getLeagueSeasonPointsFromDB,
  hasSeasonPoints,
  getLeagueWeeklyResultsFromDB,
  fetchLeagueLiveResults,
  type SeasonPointsRow,
} from '@/lib/igc/weekly-results'
import { pacificToday } from '@/lib/pacific-time'
import { SeasonPointsTable } from '@/components/igc/season-points-table'
import { WeeklyResultsView, type EligibleWeek } from '@/components/igc/weekly-results-view'

// Render the GG sync timestamp (a TIMESTAMPTZ string from updated_at) as a
// readable Pacific date/time. Falls back to the raw value if parsing fails so
// we never show a blank provenance line.
function formatSyncedAt(value: string): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d)
}

function formatEventDate(value: string | null): string {
  if (!value) return ''
  const d = new Date(value.slice(0, 10) + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

// Shared standings view for a single league. Men's and Women's League are peer
// domain entities, each with its own direct route; there is no Men's/Women's
// toggle. Sub-views are exposed as sections within the Standings page:
//
//   Men's:
//     - Season Points: the cumulative points race (rank, movement, wins,
//       points behind) read from the persisted season_points snapshot. GG
//       provides no standings endpoint; the sync derives rank from total
//       points. Birdie/double aggregates are not a season-points concept.
//     - Weekly / Live Results: the selected round's flighted results with
//       expandable hole-by-hole scorecards. An active round (event_date is
//       today) is shown live and polled; otherwise the most recent completed
//       round with results is the default.
//
//   Women's:
//     - Weekly / Live Results only. GG provides no cumulative season points
//       for the Women's league, so no Season Points section is fabricated.
//       Individual weeks render flighted (here: single Overall field) results;
//       team/scramble weeks render an honest team-event state (no invented
//       individual attribution).
//
// The week selector lists only eligible weeks: an active scoring round (if
// today) plus completed rounds (individual results OR team events). Future /
// unplayed rounds are excluded — they are schedule, not results.
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

  const explicitWeek = week ? Number.parseInt(week, 10) : undefined
  const today = pacificToday()
  const basePath = leagueKey === 'mens' ? '/igc/mens-league' : '/igc/womens-league'

  // Season points exist for Men's only; gate the section on real data rather
  // than the league key so a not-yet-synced Men's season also hides it.
  type PointsResult = { rows: SeasonPointsRow[]; exists: boolean }
  const pointsPromise: Promise<PointsResult> = leagueKey === 'mens'
    ? Promise.all([getLeagueSeasonPointsFromDB(leagueKey), hasSeasonPoints(leagueKey)]).then(
        ([rows, exists]) => ({ rows, exists }),
      )
    : Promise.resolve({ rows: [], exists: false })

  const [events, weeksWithResults, lastSyncedAt, points] = await Promise.all([
    getLeagueEvents(leagueKey),
    getLeagueWeeksWithResults(leagueKey),
    getLeagueLastSyncedAt(leagueKey),
    pointsPromise,
  ])

  const selectedEvent = resolveStandingsEvent(
    Number.isFinite(explicitWeek) ? explicitWeek : undefined,
    events,
    weeksWithResults,
    today,
  )
  const selectedWeek = Number.isFinite(explicitWeek)
    ? explicitWeek
    : selectedEvent?.week_number

  // Resolve the selected week's results. An active (today) individual round is
  // served live from Golf Genius and polled client-side; everything else
// (completed rounds, team events, no round selected) is read from the
  // persisted sync data.
  const isTeamEvent = selectedEvent?.gg_tournament_id === null
  const isActiveToday =
    selectedEvent != null && toDateKey(selectedEvent.event_date) === today
  const liveEligible = isActiveToday && !isTeamEvent && selectedWeek !== undefined

  let initial = null
  let live = null
  if (selectedWeek !== undefined) {
    if (liveEligible) {
      try {
        initial = await fetchLeagueLiveResults(leagueKey, selectedWeek)
      } catch (err) {
        console.error(`[standings] live fetch failed for ${leagueKey} wk${selectedWeek}:`, err)
      }
      // If the live fetch found nothing (round not yet scored in GG), fall back
      // to whatever is persisted so the user still sees an honest state.
      if (!initial) {
        initial = await getLeagueWeeklyResultsFromDB(leagueKey, selectedWeek).catch(() => null)
      }
      live = { weekNumber: selectedWeek, pollUrl: `/api/igc/league/live?league=${leagueKey}&week=${selectedWeek}` }
    } else {
      initial = await getLeagueWeeklyResultsFromDB(leagueKey, selectedWeek).catch(() => null)
    }
  }

  // Selector weeks: active (today) + all past events (individual results OR
  // team events), most-recent first. Future/unplayed rounds are excluded.
  const eventByWeek = new Map(events.map((e) => [e.week_number, e]))
  const todayKey = toDateKey(today) ?? today
  const eligibleWeekList: EligibleWeek[] = events
    .filter((e) => {
      const key = toDateKey(e.event_date)
      return key !== null && key <= todayKey
    })
    .sort((a, b) => (toDateKey(b.event_date) ?? '') < (toDateKey(a.event_date) ?? '') ? -1 : 1)
    .map((e) => ({
      weekNumber: e.week_number,
      label: e.event_name ?? `Week ${e.week_number}`,
      date: e.event_date ?? null,
      isTeamEvent: e.gg_tournament_id === null,
    }))

  const selectedEventName =
    selectedEvent?.event_name ?? initial?.eventName ?? (selectedWeek ? `Week ${selectedWeek}` : null)
  const selectedEventDate = selectedEvent?.event_date ?? initial?.eventDate ?? null

  return (
    <div className="space-y-10 py-2">
      <div>
        <h1 className="mb-1 text-3xl font-bold">{config.name} Standings</h1>
        <p className="text-muted-foreground">
          {leagueKey === 'mens'
            ? 'Season points race and weekly results for the Men’s league.'
            : 'Weekly results for the Women’s league.'}
        </p>
        {lastSyncedAt ? (
          <p className="mt-2 text-xs text-muted-foreground/80">
            Last synced from Golf Genius: {formatSyncedAt(lastSyncedAt)}
          </p>
        ) : null}
      </div>

      {leagueKey === 'mens' && points.exists && (
        <section className="space-y-3">
          <div>
            <h2 className="text-xl font-semibold">Season Points</h2>
            <p className="text-sm text-muted-foreground">
              Cumulative points race — rank, movement, wins, and points behind the leader.
            </p>
          </div>
          <SeasonPointsTable rows={points.rows} />
        </section>
      )}

      <section className="space-y-3">
        <div>
          <h2 className="text-xl font-semibold">
            {leagueKey === 'mens' ? 'Weekly / Live Results' : 'Weekly Results'}
          </h2>
          <p className="text-sm text-muted-foreground">
            {selectedEventName
              ? `${selectedEventName}${selectedEventDate ? ` · ${formatEventDate(selectedEventDate)}` : ''}`
              : 'No completed rounds yet.'}
          </p>
        </div>
        <WeeklyResultsView
          basePath={basePath}
          selectedWeek={selectedWeek}
          eligibleWeeks={eligibleWeekList}
          initial={initial}
          live={live}
        />
      </section>
    </div>
  )
}