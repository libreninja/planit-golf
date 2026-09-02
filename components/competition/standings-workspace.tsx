'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { Info } from 'lucide-react'
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
  awaitingOfficialFlights?: boolean
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
  const [grouping, setGrouping] = useState<string>(props.grouping ?? 'all')

  const { data, refreshing, showingLastKnown, refresh } = useLivePoll({
    initial: props.initial,
    pollUrl: props.pollUrl,
    scoring: props.scoring,
    supportsLive: props.capabilities.supportsLiveResults,
    initialIsHistoricalFinal: props.initialIsHistoricalFinal,
    awaitingOfficialFlights: props.awaitingOfficialFlights,
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
    next.set('grouping', grouping)
    return `${pathname}?${next.toString()}`
  }
  const onSelectWeek = (id: string) => {
    router.replace(weekUrlFor(id), { scroll: false })
  }

  const lb = data?.leaderboard ?? null
  // Flight membership arrives with every live response so normal polling can
  // replace projected membership with official membership independently from
  // the LIVE/FINAL scoring state. Static capabilities remain the fallback for
  // an old cached response during a rolling deployment.
  const responseFlightMembership = data?.flightMembership ?? props.initial?.flightMembership
  const fallbackGroupings = props.capabilities.groupings.kind === 'multi'
    ? props.capabilities.groupings.groupings
    : []
  const flightMembership = responseFlightMembership ?? (
    fallbackGroupings.length > 0
      ? { status: 'official' as const, groupings: fallbackGroupings }
      : { status: 'unavailable' as const, groupings: [] as [] }
  )
  const hasFlightFilter = flightMembership.status !== 'unavailable'
  const effectiveGrouping = hasFlightFilter ? grouping : 'all'
  const filteredLb = filterLeaderboardByGrouping(lb, effectiveGrouping, flightMembership.status)
  // The Overall view sorts position-ascending then flight-DESCENDING
  // (1/F3, 1/F2, 1/F1, 2/F3, …; the server default is position-then-name). A
  // specific flight keeps the source sort. Women's single-group leaderboards
  // never reach this branch.
  const displayLb =
    effectiveGrouping === 'all' && filteredLb
      ? { ...filteredLb, entries: sortAllViewEntries(filteredLb.entries) }
      : filteredLb
  // Render the flight column only for Men's Overall; a specific flight makes
  // it redundant and women's is single Overall.
  const showFlight = effectiveGrouping === 'all' && hasFlightFilter
  // Keep the existing flight colors in projected and official states.
  const colorizeFlights = hasFlightFilter
  const isInitialEmpty = !props.initial?.leaderboard && !props.initial
  const eventFormat = data?.eventFormat ?? props.initial?.eventFormat ?? 'unknown'
  const discoveryState = data?.discoveryState ?? props.initial?.discoveryState ?? 'pending'

  const onSelectGrouping = (nextGrouping: string) => {
    setGrouping(nextGrouping)
    if (typeof window === 'undefined') return
    const next = new URLSearchParams(window.location.search)
    next.set('grouping', nextGrouping)
    window.history.replaceState(null, '', `${pathname}?${next.toString()}`)
  }

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

      {flightMembership.status === 'projected' && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">Projected results</span>
          <span>Flights based on the current tee sheet.</span>
          <details className="basis-full sm:basis-auto">
            <summary
              aria-label="About projected flights"
              className="inline-flex cursor-pointer list-none items-center gap-1 text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden"
            >
              <Info aria-hidden="true" className="h-3.5 w-3.5" />
              <span className="sr-only">About projected flights</span>
            </summary>
            <p className="mt-1 max-w-xl leading-relaxed">
              Projected flights are approximate and may change as the field changes. They are replaced once official flights are available.
            </p>
          </details>
        </div>
      )}

      {hasFlightFilter && (
        <GroupingFilter
          groupings={{ kind: 'multi', groupings: flightMembership.groupings, defaultAll: true }}
          selected={effectiveGrouping}
          onSelect={onSelectGrouping}
        />
      )}

      {isInitialEmpty && refreshing ? (
        <LoadingSkeleton />
      ) : eventFormat === 'team' && discoveryState === 'discovered' ? (
        <TeamEventState label={props.occurrences.find((o) => o.id === props.selectedOccurrenceId)?.label ?? ''} />
      ) : displayLb ? (
        <Leaderboard
          leaderboard={displayLb}
          showFlight={showFlight}
          colorizeFlights={colorizeFlights}
          projectedFlights={flightMembership.status === 'projected'}
        />
      ) : showingLastKnown ? (
        <UnavailableState message="Live results are temporarily unavailable. Showing the last known standings." onRetry={() => void refresh()} retrying={refreshing} />
      ) : (
        <UnavailableState message="Results aren&apos;t available for this round yet." onRetry={() => void refresh()} retrying={refreshing} />
      )}
    </section>
  )
}
