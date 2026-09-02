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

import { useEffect, useState } from 'react'
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

export interface StandingsShellProps {
  competitionKey: string
  configViews: View[]
  initialView: View
  initialScoring: ScoringMode
  scoringModes: ScoringMode[]
  // null when the competition has no 'season' view (e.g. women's).
  seasonRows: SeasonPointsRow[] | null
  weekly: {
    occurrences: { id: string; label: string }[]
    selectedOccurrenceId: string | null
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
  const [view, setView] = useState<View>(props.initialView)
  const [scoring, setScoring] = useState<ScoringMode>(props.initialScoring)

  // Update the URL without navigating — keeps refresh/bookmark correct while
  // the toggle itself is an instant client state change.
  const updateUrl = (next: { view?: View; scoring?: ScoringMode }) => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    if (next.view) url.searchParams.set('view', next.view)
    if (next.scoring) url.searchParams.set('scoring', next.scoring)
    window.history.replaceState(null, '', `${url.pathname}${url.search}`)
  }

  const onSelectView = (v: string) => {
    if (v === view) return
    setView(v as View)
    updateUrl({ view: v as View })
  }

  const onSelectScoring = (m: ScoringMode) => {
    if (m === scoring) return
    setScoring(m)
    writeScoringPref(props.competitionKey, m, window.localStorage)
    updateUrl({ scoring: m })
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

  return (
    <section className="space-y-4">
      <ViewTabs
        views={props.configViews}
        selectedView={view}
        onSelectView={onSelectView}
      />
      {showSeason ? (
        <SeasonPointsView rows={props.seasonRows!} />
      ) : (
        // Keyed by occurrence + scoring so a scoring toggle (or a week
        // navigation) remounts the workspace with the new initial data —
        // useLivePoll's useState(initial) only seeds on mount.
        <StandingsWorkspace
          key={`${props.weekly.selectedOccurrenceId ?? 'none'}-${scoring}`}
          competitionKey={props.competitionKey}
          occurrences={props.weekly.occurrences}
          selectedOccurrenceId={props.weekly.selectedOccurrenceId}
          queryParam={props.weekly.queryParam}
          scoring={scoring}
          view={view}
          grouping={props.weekly.grouping}
          capabilities={props.weekly.capabilities}
          initial={weeklyInitial}
          pollUrl={props.weekly.pollUrl}
          initialIsHistoricalFinal={props.weekly.initialIsHistoricalFinal}
          awaitingOfficialFlights={props.weekly.awaitingOfficialFlights}
          onSelectScoring={onSelectScoring}
        />
      )}
    </section>
  )
}
