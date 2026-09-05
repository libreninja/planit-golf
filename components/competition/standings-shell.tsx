'use client'

// Unified client shell for the standings workspace (P1-1 / P1-2).
//
// The server preloads EVERYTHING the user can toggle without a network hop:
//   - seasonRows (the Season Points table) — for the Season Points view
//   - weekly workspace props + initialByScoring (BOTH gross and net for a
//     finalized week; the live path preloads the current scoring and the shell
//     prefetches the other scoring's live URL so the first toggle is warm)
//
// View (Season Points ↔ Weekly/Live) and scoring (Gross ↔ Net) are pure CLIENT
// state here. Toggling either calls setView/setScoring and updates the URL via
// history.replaceState — NO router navigation, NO server round-trip, so the
// switch is instant. The URL stays correct for refresh/bookmark. Week (occurrence)
// navigation remains a real router navigation because a different week needs
// different data; the workspace builds those URLs preserving the current
// scoring/view (see standings-workspace.tsx).

import { useEffect, useReducer } from 'react'
import type {
  LiveResponse,
  OccurrenceCapabilities,
  ScoringMode,
  View,
} from '@/lib/competition/types'
import type { SeasonPointsRow } from '@/lib/competition/reconcile/season-points'
import { writeScoringPref } from '@/lib/competition/scoring-prefs'
import { ViewTabs } from './view-tabs'
import { SeasonPointsView } from './season-points-view'
import { StandingsWorkspace } from './standings-workspace'
import { LeaderboardControlPanel } from './leaderboard-control-panel'
import { hasActiveLeaderboardFilters, leaderboardControlReducer } from './leaderboard-control-state'
import { LeaderboardClearFilters } from './leaderboard-clear-filters'

export interface StandingsShellProps {
  competitionKey: string
  configViews: View[]
  initialView: View
  initialScoring: ScoringMode
  defaultScoring: ScoringMode
  initialPlacedOnly: boolean
  scoringModes: ScoringMode[]
  // null when the competition has no 'season' view (e.g. women's).
  seasonRows: SeasonPointsRow[] | null
  golferIdsByMemberCard: Record<string, string>
  weekly: {
    occurrences: { id: string; label: string; resultStatus: LiveResponse['resultStatus'] }[]
    selectedOccurrenceId: string | null
    latestResultsOccurrenceId: string | null
    queryParam: string
    grouping: string | null
    capabilities: OccurrenceCapabilities
    initialByScoring: Record<string, LiveResponse | null>
    pollUrl: string | null
    initialIsHistoricalFinal: boolean
    awaitingOfficialFlights?: boolean
    // true when the selected occurrence renders via the live path — the shell
    // prefetches the non-selected scoring's live URL in that case only.
    useLivePath: boolean
  }
}

export function StandingsShell(props: StandingsShellProps) {
  const [controls, dispatch] = useReducer(leaderboardControlReducer, {
    view: props.initialView,
    scoring: props.initialScoring,
    grouping: props.weekly.grouping ?? 'all',
    placedOnly: props.initialPlacedOnly,
  })
  const { view, scoring, grouping, placedOnly } = controls

  // Update the URL without navigating — keeps refresh/bookmark correct while
  // the toggle itself is an instant client state change.
  const updateUrl = (next: { view?: View; scoring?: ScoringMode; grouping?: string; placedOnly?: boolean }) => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    if (next.view) url.searchParams.set('view', next.view)
    if (next.scoring) url.searchParams.set('scoring', next.scoring)
    if (next.grouping) url.searchParams.set('grouping', next.grouping)
    if (next.placedOnly === true) url.searchParams.set('placed', 'only')
    if (next.placedOnly === false) url.searchParams.delete('placed')
    window.history.replaceState(null, '', `${url.pathname}${url.search}`)
  }

  const onSelectView = (v: string) => {
    if (v === view) return
    dispatch({ type: 'select-view', view: v as View })
    updateUrl({ view: v as View })
  }

  const onSelectScoring = (m: ScoringMode) => {
    if (m === scoring) return
    dispatch({ type: 'select-scoring', scoring: m })
    writeScoringPref(props.competitionKey, m, window.localStorage)
    updateUrl({ scoring: m })
  }

  const onSelectPlacedOnly = (nextPlacedOnly: boolean) => {
    if (nextPlacedOnly === placedOnly) return
    dispatch({ type: 'select-placed-only', placedOnly: nextPlacedOnly })
    updateUrl({ placedOnly: nextPlacedOnly })
  }

  const onClearFilters = () => {
    dispatch({ type: 'clear-filters', defaultScoring: props.defaultScoring })
    writeScoringPref(props.competitionKey, props.defaultScoring, window.localStorage)
    updateUrl({ scoring: props.defaultScoring, grouping: 'all', placedOnly: false })
  }

  // P1-2 (live): prefetch the OTHER scoring's live URL so the first Gross/Net
  // toggle on a live round hits a warm server cache (the live getLiveResults
  // cache is keyed by scoring). Finalized weeks preload both server-side, so
  // this only runs on the live path. Re-runs when scoring changes so the
  // just-left scoring is re-warmed for the toggle back.
  const { pollUrl, useLivePath } = props.weekly
  useEffect(() => {
    if (!useLivePath || !pollUrl) return
    for (const m of props.scoringModes) {
      if (m === scoring) continue
      const sep = pollUrl.includes('?') ? '&' : '?'
      const u = `${pollUrl}${sep}scoring=${encodeURIComponent(m)}`
      void fetch(u, { cache: 'no-store' }).catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useLivePath, pollUrl, scoring])

  const seasonAvailable = props.configViews.includes('season') && props.seasonRows !== null
  const showSeason = view === 'season' && seasonAvailable
  const weeklyInitial = props.weekly.initialByScoring[scoring] ?? null
  const filtersActive = hasActiveLeaderboardFilters({ scoring, grouping, placedOnly }, props.defaultScoring)

  return (
    <section className="space-y-4">
      {showSeason ? (
        <>
          <LeaderboardControlPanel summary="Season Points">
            <div className="flex flex-nowrap items-center justify-between gap-2">
              <ViewTabs
                views={props.configViews}
                selectedView={view}
                onSelectView={onSelectView}
              />
              <LeaderboardClearFilters active={filtersActive} onClear={onClearFilters} />
            </div>
          </LeaderboardControlPanel>
          <SeasonPointsView rows={props.seasonRows!} golferIdsByMemberCard={props.golferIdsByMemberCard} />
        </>
      ) : (
        <StandingsWorkspace
          key={props.weekly.selectedOccurrenceId ?? 'none'}
          competitionKey={props.competitionKey}
          occurrences={props.weekly.occurrences}
          selectedOccurrenceId={props.weekly.selectedOccurrenceId}
          latestResultsOccurrenceId={props.weekly.latestResultsOccurrenceId}
          queryParam={props.weekly.queryParam}
          scoring={scoring}
          view={view}
          grouping={grouping}
          placedOnly={placedOnly}
          defaultScoring={props.defaultScoring}
          golferIdsByMemberCard={props.golferIdsByMemberCard}
          capabilities={props.weekly.capabilities}
          initial={weeklyInitial}
          pollUrl={props.weekly.pollUrl}
          initialIsHistoricalFinal={props.weekly.initialIsHistoricalFinal}
          awaitingOfficialFlights={props.weekly.awaitingOfficialFlights}
          onSelectScoring={onSelectScoring}
          onSelectGrouping={(nextGrouping) => dispatch({ type: 'select-grouping', grouping: nextGrouping })}
          onSelectPlacedOnly={onSelectPlacedOnly}
          onClearFilters={onClearFilters}
          viewControl={(
            <ViewTabs
              views={props.configViews}
              selectedView={view}
              onSelectView={onSelectView}
            />
          )}
        />
      )}
    </section>
  )
}
