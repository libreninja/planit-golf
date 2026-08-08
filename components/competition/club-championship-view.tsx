'use client'

// Client view for the Club Championship aggregate (/igc/club-championship).
//
// The championship is a CROSS-OCCURRENCE view: Monday Round 1 + Tuesday Round 2
// summed. That doesn't fit the occurrence-nav-based StandingsWorkspace (which
// assumes one selected week), so this is a dedicated, trimmed client component
// that reuses the same primitives: useLivePoll, ScoringToggle, StatusBadge,
// and the shared Leaderboard. Gross/Net is a pure client toggle with
// history.replaceState (no server round-trip) — both scorings are preloaded by
// the server page, so a click is an instant state swap. The poll keeps the
// aggregate fresh while Tuesday's live scores arrive; the live URL for the
// non-selected scoring is prefetched so the first toggle is warm (mirrors
// StandingsShell P1-2).
//
// Week numbers 101/102 are STORAGE ids and never appear here — the round
// labels and the "Round X of Y complete" subtitle come from the aggregate's
// own counts/label.

import { useEffect, useState } from 'react'
import type { ChampionshipAggregate } from '@/lib/competition/aggregate-reader'
import { championshipSubtitle, type RoundScheduleItem } from '@/lib/competition/championship-subtitle'
import type { ScoringMode } from '@/lib/competition/types'
import { writeScoringPref } from '@/lib/competition/scoring-prefs'
import { useLivePoll } from './use-live-poll'
import { ScoringToggle } from './scoring-toggle'
import { StatusBadge } from './status-badge'
import { Leaderboard } from './leaderboard'
import { LoadingSkeleton, UnavailableState, RefreshingIndicator } from './states'

export interface ClubChampionshipViewProps {
  competitionKey: string
  scoringModes: ScoringMode[]
  initialScoring: ScoringMode
  initialByScoring: Record<string, ChampionshipAggregate | null>
  pollUrl: string | null
  roundSchedule: RoundScheduleItem[]
}

export function ClubChampionshipView(props: ClubChampionshipViewProps) {
  const [scoring, setScoring] = useState<ScoringMode>(props.initialScoring)

  const updateUrl = (next: { scoring?: ScoringMode }) => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    if (next.scoring) url.searchParams.set('scoring', next.scoring)
    window.history.replaceState(null, '', `${url.pathname}${url.search}`)
  }

  const onSelectScoring = (m: string) => {
    const mode = m as ScoringMode
    if (mode === scoring) return
    setScoring(mode)
    writeScoringPref(props.competitionKey, mode, window.localStorage)
    updateUrl({ scoring: mode })
  }

  // Prefetch the other scoring's live URL so the first Gross/Net toggle on a
  // live aggregate hits a warm server cache (the live getChampionshipAggregate
  // cache is keyed by scoring). Mirrors StandingsShell P1-2.
  useEffect(() => {
    if (!props.pollUrl) return
    for (const m of props.scoringModes) {
      if (m === scoring) continue
      const sep = props.pollUrl.includes('?') ? '&' : '?'
      const u = `${props.pollUrl}${sep}scoring=${encodeURIComponent(m)}`
      void fetch(u, { cache: 'no-store' }).catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.pollUrl, scoring])

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <div className="flex items-center gap-2">
          <StatusBadge status={props.initialByScoring[scoring]?.resultStatus ?? 'unknown'} />
          <RefreshingIndicator refreshing={false} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <ScoringToggle
          modes={props.scoringModes.map((m) => ({ key: m, label: m }))}
          selected={scoring}
          onSelect={onSelectScoring}
        />
      </div>

      {/* Keyed by scoring so a toggle remounts the board with the preloaded
          other-scoring initial — useLivePoll's useState(initial) only seeds
          on mount, exactly like StandingsWorkspace. */}
      <ClubChampionshipBoard
        key={scoring}
        initial={props.initialByScoring[scoring] ?? null}
        pollUrl={props.pollUrl}
        scoring={scoring}
        roundSchedule={props.roundSchedule}
      />
    </section>
  )
}

function ClubChampionshipBoard({
  initial,
  pollUrl,
  scoring,
  roundSchedule,
}: {
  initial: ChampionshipAggregate | null
  pollUrl: string | null
  scoring: ScoringMode
  roundSchedule: RoundScheduleItem[]
}) {
  const { data, refreshing, showingLastKnown, refresh } = useLivePoll({
    initial,
    pollUrl,
    scoring,
    supportsLive: true,
    initialIsHistoricalFinal: initial?.resultStatus === 'final',
  })

  const agg = data as ChampionshipAggregate | null
  const lb = agg?.leaderboard ?? null
  const roundCount = agg?.roundCount ?? initial?.roundCount ?? 0
  const roundsComplete = agg?.roundsComplete ?? initial?.roundsComplete ?? 0
  const roundsLive = agg?.roundsLive ?? initial?.roundsLive ?? 0
  const isInitialEmpty = !initial?.leaderboard

  // One concise, state-aware subtitle. Driven by the live aggregate so it
  // updates as Tuesday's scores arrive: "Starts Monday, Aug 17" →
  // "LIVE · Round 1 in progress" → "LIVE · Round 2 in progress" → "FINAL".
  const subtitle = championshipSubtitle(
    {
      resultStatus: agg?.resultStatus ?? initial?.resultStatus ?? 'unknown',
      roundsComplete,
      roundsLive,
      roundCount,
    },
    roundSchedule,
  )

  return (
    <>
      <p className="text-sm text-muted-foreground">{subtitle}</p>
      <RoundProgress
        roundCount={roundCount}
        roundsComplete={roundsComplete}
        roundsLive={roundsLive}
      />
      {isInitialEmpty && refreshing ? (
        <LoadingSkeleton />
      ) : lb ? (
        <Leaderboard leaderboard={lb} />
      ) : showingLastKnown ? (
        <UnavailableState
          message="Live results are temporarily unavailable. Showing the last known standings."
          onRetry={() => void refresh()}
          retrying={refreshing}
        />
      ) : (
        <UnavailableState
          message="Results aren&apos;t available for this championship yet."
          onRetry={() => void refresh()}
          retrying={refreshing}
        />
      )}
    </>
  )
}

function RoundProgress({
  roundCount,
  roundsComplete,
  roundsLive,
}: {
  roundCount: number
  roundsComplete: number
  roundsLive: number
}) {
  if (roundCount === 0) return null
  // "Round 1 of 2 complete" once a round is final; while a round is live, say
  // so. Before any golf posts, neither line shows — the empty state covers it.
  const parts: string[] = []
  if (roundsComplete > 0) parts.push(`Round ${roundsComplete} of ${roundCount} complete`)
  if (roundsLive > 0) parts.push(`${roundsLive} live`)
  if (parts.length === 0) {
    return (
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {roundCount} rounds
      </p>
    )
  }
  return (
    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {parts.join(' · ')}
    </p>
  )
}