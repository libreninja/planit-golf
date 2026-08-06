'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import type { LiveResponse, OccurrenceCapabilities, ScoringMode, View } from '@/lib/competition/types'
import { OccurrenceNav } from './occurrence-nav'
import { ScoringToggle } from './scoring-toggle'
import { GroupingFilter } from './grouping-filter'
import { Leaderboard } from './leaderboard'
import { StatusBadge } from './status-badge'
import { LoadingSkeleton, UnavailableState, TeamEventState, RefreshingIndicator } from './states'
import { useLivePoll } from './use-live-poll'
import { filterLeaderboardByGrouping } from './leaderboard-filter'
import { sortAllViewEntries } from './leaderboard-sort'

export interface StandingsWorkspaceProps {
  competitionKey: string
  occurrences: { id: string; label: string }[]
  selectedOccurrenceId: string | null
  queryParam: string
  scoring: ScoringMode
  view: View
  grouping: string | null
  capabilities: OccurrenceCapabilities
  initial: LiveResponse | null
  pollUrl: string | null
  initialIsHistoricalFinal: boolean
  // P1-2: scoring is controlled by the shell (instant client toggle, no server
  // navigation). The workspace reports a scoring click up to the shell, which
  // updates state + history.replaceState and remounts this component (keyed by
  // scoring) with the new `initial`.
  onSelectScoring: (mode: ScoringMode) => void
}

export function StandingsWorkspace(props: StandingsWorkspaceProps) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [grouping, setGrouping] = useState<string | null>(props.grouping)

  const { data, refreshing, showingLastKnown, refresh } = useLivePoll({
    initial: props.initial,
    pollUrl: props.pollUrl,
    scoring: props.scoring,
    supportsLive: props.capabilities.supportsLiveResults,
    initialIsHistoricalFinal: props.initialIsHistoricalFinal,
  })

  // Week navigation is a REAL server navigation (a different occurrence needs
  // different data). The URL is built here so it preserves the shell's CURRENT
  // scoring + view — which the shell tracks in client state and writes via
  // history.replaceState, and which next/navigation's useSearchParams would not
  // otherwise reflect (P1-1/P1-2). Other params (grouping, any extras) are
  // carried over from the last navigated URL via useSearchParams.
  const weekUrlFor = (id: string) => {
    const next = new URLSearchParams(params.toString())
    next.set(props.queryParam, id)
    next.set('scoring', props.scoring)
    next.set('view', props.view)
    return `${pathname}?${next.toString()}`
  }
  const onSelectWeek = (id: string) => {
    router.replace(weekUrlFor(id), { scroll: false })
  }

  const lb = data?.leaderboard ?? null
  // Apply the flight/grouping filter (P6). Only reached for finalized men's
  // weeks (groupings.kind === 'multi'); live weeks and women's render no filter.
  const filteredLb = filterLeaderboardByGrouping(lb, grouping)
  // FIX 1 / P1-4: the "All" view sorts position-ascending then flight-DESCENDING
  // (1/F3, 1/F2, 1/F1, 2/F3, …; the server default is position-then-name). A
  // specific flight keeps the server sort. 'all' is only ever the grouping for
  // a finalized multi-flight week, so this never touches live (unflighted) or
  // women's (single) leaderboards.
  const displayLb =
    grouping === 'all' && filteredLb
      ? { ...filteredLb, entries: sortAllViewEntries(filteredLb.entries) }
      : filteredLb
  // FIX 2: render the Flight column only for the finalized Men's "All" view —
  // a specific flight makes the column redundant, live weeks are unflighted,
  // and women's is single Overall. Driven by grouping + capability state.
  const showFlight = grouping === 'all' && props.capabilities.groupings.kind === 'multi'
  // P1-3: colorize rows/badges for any finalized Men's multi-flight week (All
  // or a specific flight). Live (unflighted) and women's (single) stay neutral.
  const colorizeFlights = props.capabilities.groupings.kind === 'multi'
  const isInitialEmpty = !props.initial?.leaderboard && !props.initial
  const eventFormat = data?.eventFormat ?? props.initial?.eventFormat ?? 'unknown'
  const discoveryState = data?.discoveryState ?? props.initial?.discoveryState ?? 'pending'

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <div className="flex items-center gap-2">
          <StatusBadge status={data?.resultStatus ?? props.initial?.resultStatus ?? 'unknown'} />
          <RefreshingIndicator refreshing={refreshing} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {props.capabilities.supportsEventNavigation && (
          <OccurrenceNav
            occurrences={props.occurrences}
            selectedId={props.selectedOccurrenceId}
            onSelect={onSelectWeek}
            urlFor={weekUrlFor}
          />
        )}
        <ScoringToggle
          modes={props.capabilities.scoring.modes.map((m) => ({ key: m, label: m }))}
          selected={props.scoring}
          onSelect={(m) => props.onSelectScoring(m as ScoringMode)}
        />
      </div>

      {props.capabilities.groupings.kind === 'multi' && (
        <GroupingFilter
          groupings={props.capabilities.groupings}
          selected={grouping ?? 'all'}
          onSelect={setGrouping}
        />
      )}

      {isInitialEmpty && refreshing ? (
        <LoadingSkeleton />
      ) : eventFormat === 'team' && discoveryState === 'discovered' ? (
        <TeamEventState label={props.occurrences.find((o) => o.id === props.selectedOccurrenceId)?.label ?? ''} />
      ) : displayLb ? (
        <Leaderboard leaderboard={displayLb} showFlight={showFlight} colorizeFlights={colorizeFlights} />
      ) : showingLastKnown ? (
        <UnavailableState message="Live results are temporarily unavailable. Showing the last known standings." onRetry={() => void refresh()} retrying={refreshing} />
      ) : (
        <UnavailableState message="Results aren&apos;t available for this round yet." onRetry={() => void refresh()} retrying={refreshing} />
      )}
    </section>
  )
}