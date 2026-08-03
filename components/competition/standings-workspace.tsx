'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import type { LiveResponse, OccurrenceCapabilities } from '@/lib/competition/types'
import { writeScoringPref } from '@/lib/competition/scoring-prefs'
import { OccurrenceNav } from './occurrence-nav'
import { ScoringToggle } from './scoring-toggle'
import { GroupingFilter } from './grouping-filter'
import { Leaderboard } from './leaderboard'
import { StatusBadge } from './status-badge'
import { LoadingSkeleton, UnavailableState, TeamEventState, RefreshingIndicator } from './states'
import { useLivePoll } from './use-live-poll'

export interface StandingsWorkspaceProps {
  competitionKey: string
  occurrences: { id: string; label: string }[]
  selectedOccurrenceId: string | null
  queryParam: string
  view: string
  scoring: string
  grouping: string | null
  capabilities: OccurrenceCapabilities
  initial: LiveResponse | null
  pollUrl: string | null
  initialIsHistoricalFinal: boolean
}

export function StandingsWorkspace(props: StandingsWorkspaceProps) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [grouping, setGrouping] = useState<string | null>(props.grouping)

  const { data, refreshing, showingLastKnown, refresh } = useLivePoll({
    initial: props.initial,
    pollUrl: props.pollUrl,
    scoring: props.scoring as 'gross' | 'net',
    supportsLive: props.capabilities.supportsLiveResults,
    initialIsHistoricalFinal: props.initialIsHistoricalFinal,
  })

  const navigate = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(updates)) v == null ? next.delete(k) : next.set(k, v)
    router.replace(`${pathname}?${next.toString()}`, { scroll: false })
  }

  const onSelectScoring = (m: string) => {
    writeScoringPref(props.competitionKey, m as never, window.localStorage)
    navigate({ scoring: m })
  }

  const lb = data?.leaderboard ?? null
  const isInitialEmpty = !props.initial?.leaderboard && !props.initial
  const eventFormat = data?.eventFormat ?? props.initial?.eventFormat ?? 'unknown'
  const discoveryState = data?.discoveryState ?? props.initial?.discoveryState ?? 'pending'

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {props.capabilities.views.length > 1 && (
          <div className="inline-flex rounded-md border border-border p-0.5">
            {props.capabilities.views.map((v) => (
              <button key={v} type="button" onClick={() => navigate({ view: v })}
                className={`rounded px-3 py-1 text-sm capitalize ${props.view === v ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'}`}>{v}</button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <StatusBadge status={data?.resultStatus ?? props.initial?.resultStatus ?? 'unknown'} />
          <RefreshingIndicator refreshing={refreshing} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {props.capabilities.supportsEventNavigation && (
          <OccurrenceNav occurrences={props.occurrences} selectedId={props.selectedOccurrenceId} queryParam={props.queryParam} />
        )}
        <ScoringToggle
          modes={props.capabilities.scoring.modes.map((m) => ({ key: m, label: m }))}
          selected={props.scoring}
          onSelect={onSelectScoring}
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
      ) : lb ? (
        <Leaderboard leaderboard={lb} />
      ) : showingLastKnown ? (
        <UnavailableState message="Live results are temporarily unavailable. Showing the last known standings." onRetry={() => void refresh()} retrying={refreshing} />
      ) : (
        <UnavailableState message="Results aren&apos;t available for this round yet." onRetry={() => void refresh()} retrying={refreshing} />
      )}
    </section>
  )
}
