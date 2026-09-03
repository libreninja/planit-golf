'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import { EyeOff } from 'lucide-react'
import type { LiveResponse, OccurrenceCapabilities, ResultStatus, ScoringMode, View } from '@/lib/competition/types'
import { OccurrenceNav } from './occurrence-nav'
import { ScoringToggle } from './scoring-toggle'
import { GroupingFilter } from './grouping-filter'
import { Leaderboard } from './leaderboard'
import { LoadingSkeleton, UnavailableState, TeamEventState } from './states'
import { useLivePoll } from './use-live-poll'
import { filterLeaderboardByGrouping, filterLeaderboardByPlacement } from './leaderboard-filter'
import { sortEntriesBySelectedScore } from './leaderboard-sort'
import { LeaderboardControlPanel } from './leaderboard-control-panel'
import { hasActiveLeaderboardFilters, resolveGroupingSelection } from './leaderboard-control-state'
import { occurrenceContextLabel } from './occurrence-context'
import { isOccurrenceNavigationPending, selectedOccurrenceContextId } from './occurrence-loading'
import { LeaderboardClearFilters } from './leaderboard-clear-filters'

export interface StandingsWorkspaceProps {
  competitionKey: string
  occurrences: { id: string; label: string; resultStatus: ResultStatus }[]
  selectedOccurrenceId: string | null
  latestResultsOccurrenceId: string | null
  queryParam: string
  scoring: ScoringMode
  view: View
  grouping: string | null
  placedOnly: boolean
  defaultScoring: ScoringMode
  capabilities: OccurrenceCapabilities
  initial: LiveResponse | null
  pollUrl: string | null
  initialIsHistoricalFinal: boolean
  awaitingOfficialFlights?: boolean
  // P1-2: scoring is controlled by the shell (instant client toggle, no server
  // navigation). The workspace reports a scoring click up to the shell, which
  // updates state + history.replaceState while this component stays mounted.
  onSelectScoring: (mode: ScoringMode) => void
  onSelectGrouping: (grouping: string) => void
  onSelectPlacedOnly: (placedOnly: boolean) => void
  onClearFilters: () => void
  viewControl: ReactNode
}

export function StandingsWorkspace(props: StandingsWorkspaceProps) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const grouping = props.grouping ?? 'all'
  const onSelectGroupingProp = props.onSelectGrouping
  const [pendingOccurrenceId, setPendingOccurrenceId] = useState<string | null>(null)
  const occurrenceChanging = isOccurrenceNavigationPending(props.selectedOccurrenceId, pendingOccurrenceId)
  const activeOccurrenceId = selectedOccurrenceContextId(props.selectedOccurrenceId, pendingOccurrenceId)

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
    if (props.placedOnly) next.set('placed', 'only')
    else next.delete('placed')
    return `${pathname}?${next.toString()}`
  }
  const onSelectWeek = (id: string) => {
    setPendingOccurrenceId(id)
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
  const effectiveGrouping = resolveGroupingSelection(grouping, flightMembership)
  // A null live initial means the destination membership is still loading, not
  // that the selected flight ceased to exist. Fall back only once a response
  // (or a non-live context) establishes that the grouping is unavailable.
  const membershipSettled = !!responseFlightMembership || !props.pollUrl
  useEffect(() => {
    if (membershipSettled && grouping !== effectiveGrouping) {
      onSelectGroupingProp(effectiveGrouping)
      if (typeof window !== 'undefined') {
        const next = new URLSearchParams(window.location.search)
        next.set('grouping', effectiveGrouping)
        window.history.replaceState(null, '', `${pathname}?${next.toString()}`)
      }
    }
  }, [effectiveGrouping, grouping, membershipSettled, onSelectGroupingProp, pathname])
  const groupedLb = filterLeaderboardByGrouping(lb, effectiveGrouping, flightMembership.status)
  const filteredLb = filterLeaderboardByPlacement(groupedLb, props.placedOnly)
  // Row order follows the selected score for both Overall and a flight subset.
  // Award placement remains exactly as supplied on each entry.
  const displayLb = filteredLb
    ? {
        ...filteredLb,
        entries: sortEntriesBySelectedScore(filteredLb.entries, filteredLb.scorecards, filteredLb.scoringMode),
      }
    : null
  // Render the flight column only for Men's Overall; a specific flight makes
  // it redundant and women's is single Overall.
  const showFlight = effectiveGrouping === 'all' && hasFlightFilter
  // Keep the existing flight colors in projected and official states.
  const colorizeFlights = hasFlightFilter
  const isInitialEmpty = !props.initial?.leaderboard && !props.initial
  const eventFormat = data?.eventFormat ?? props.initial?.eventFormat ?? 'unknown'
  const discoveryState = data?.discoveryState ?? props.initial?.discoveryState ?? 'pending'

  const onSelectGrouping = (nextGrouping: string) => {
    onSelectGroupingProp(nextGrouping)
    if (typeof window === 'undefined') return
    const next = new URLSearchParams(window.location.search)
    next.set('grouping', nextGrouping)
    window.history.replaceState(null, '', `${pathname}?${next.toString()}`)
  }

  const occurrence = props.occurrences.find((item) => item.id === activeOccurrenceId)
  const responseStatus = data?.resultStatus ?? props.initial?.resultStatus ?? 'unknown'
  const resultStatus = occurrenceChanging
    ? (occurrence?.resultStatus ?? 'unknown')
    : occurrence?.resultStatus === 'not_started' && responseStatus === 'unknown'
      ? 'not_started'
      : responseStatus
  const occurrenceLabel = occurrenceContextLabel(occurrence?.label ?? 'Leaderboard', resultStatus)
  // Flight availability/provenance belongs to the loaded response. Omit it
  // during navigation rather than pairing the new date with the old round's
  // membership state.
  const groupingSummary = !occurrenceChanging && hasFlightFilter
    ? (effectiveGrouping === 'all'
        ? 'All Flights'
        : flightMembership.status === 'projected'
          ? `Projected ${effectiveGrouping}`
          : effectiveGrouping)
    : null
  const controlSummary = [
    occurrenceLabel,
    props.scoring.charAt(0).toUpperCase() + props.scoring.slice(1),
    groupingSummary,
  ].filter(Boolean).join(' · ')
  const filtersActive = hasActiveLeaderboardFilters({
    scoring: props.scoring,
    grouping,
    placedOnly: props.placedOnly,
  }, props.defaultScoring)

  return (
    <section className="space-y-4">
      <LeaderboardControlPanel summary={controlSummary}>
        <div className="flex flex-col gap-2">
          <div className="flex flex-nowrap items-center justify-between gap-2">
            {props.viewControl}
            <LeaderboardClearFilters active={filtersActive} onClear={props.onClearFilters} />
          </div>
          <div className="flex min-w-0 items-center">
            {props.capabilities.supportsEventNavigation && (
              <OccurrenceNav
                occurrences={props.occurrences}
                selectedId={activeOccurrenceId}
                selectedStatus={resultStatus}
                latestResultsId={props.latestResultsOccurrenceId}
                onSelect={onSelectWeek}
                urlFor={weekUrlFor}
              />
            )}
          </div>
          <div className="flex w-full min-w-0 flex-nowrap items-center gap-2">
            <ScoringToggle
              modes={props.capabilities.scoring.modes.map((m) => ({ key: m, label: m }))}
              selected={props.scoring}
              onSelect={(m) => props.onSelectScoring(m as ScoringMode)}
            />
            {hasFlightFilter && (
              <GroupingFilter
                groupings={{ kind: 'multi', groupings: flightMembership.groupings, defaultAll: true }}
                selected={effectiveGrouping}
                onSelect={onSelectGrouping}
              />
            )}
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              aria-pressed={props.placedOnly}
              onClick={() => props.onSelectPlacedOnly(!props.placedOnly)}
              className={props.placedOnly
                ? 'inline-flex min-w-[7.75rem] items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-foreground bg-foreground px-2 py-1 text-xs font-medium text-background'
                : 'inline-flex min-w-[7.75rem] items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground'}
            >
              <EyeOff aria-hidden="true" className="h-3.5 w-3.5" />
              Hide unranked
            </button>
          </div>
        </div>
      </LeaderboardControlPanel>

      {occurrenceChanging ? (
        <LoadingSkeleton />
      ) : isInitialEmpty && refreshing ? (
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
