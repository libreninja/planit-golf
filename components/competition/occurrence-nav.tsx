'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { occurrenceNavNeighbors, type NavOcc } from './occurrence-nav-neighbors'
import type { ResultStatus } from '@/lib/competition/types'
import { occurrenceContextLabel } from './occurrence-context'
import { isLatestResultsDisabled } from './occurrence-loading'

// Occurrence (week) navigation: prev/next chevrons + a native <select>.
// Occurrences arrive chronological (oldest→newest): ‹ = older, › = newer (P3).
//
// The selection updates OPTIMISTICALLY on click (P5): the control reflects the
// new selection immediately without waiting for the server round-trip. The
// parent immediately replaces the old leaderboard with its loading state
// while App Router resolves the selected occurrence.
//
// URL construction is delegated to the parent (`urlFor`) so a week change
// preserves the shell's CURRENT scoring/view — which the parent tracks in
// client state and writes via history.replaceState (P1-1/P1-2), and which
// next/navigation's useSearchParams would otherwise not reflect. `onSelect`
// performs the actual router.replace.
export function OccurrenceNav({
  occurrences, selectedId, selectedStatus, latestResultsId, onSelect, urlFor,
}: {
  occurrences: Array<NavOcc & { resultStatus: ResultStatus }>
  selectedId: string | null
  selectedStatus: ResultStatus
  latestResultsId: string | null
  onSelect: (id: string) => void
  urlFor: (id: string) => string
}) {
  const router = useRouter()
  const [localId, setLocalId] = useState<string | null>(selectedId)

  // Sync optimistic state when the server-rendered selection arrives.
  useEffect(() => {
    setLocalId(selectedId)
  }, [selectedId])

  const { prev, next } = occurrenceNavNeighbors(occurrences, localId)

  const go = (id: string) => {
    if (!id || id === localId) return
    setLocalId(id)        // optimistic: the control acknowledges the click instantly
    onSelect(id)
  }

  // Prefetch the adjacent occurrence routes so the next chevron click swaps
  // without a cold fetch (P5).
  useEffect(() => {
    // Next's development segment-cache prefetch can reject internally when a
    // dev server is reached over a LAN origin. Its public API returns void, so
    // callers cannot catch that optional prefetch failure. Keep production
    // prefetching intact and skip only this local-development optimization.
    if (process.env.NODE_ENV !== 'production') return
    if (prev) router.prefetch(urlFor(prev.id))
    if (next) router.prefetch(urlFor(next.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prev?.id, next?.id, urlFor])

  return (
    <div
      role="group"
      aria-label="Navigate league rounds"
      className="flex min-w-0 flex-1 overflow-hidden rounded-md border border-border sm:flex-none"
    >
      <button
        type="button"
        disabled={!prev}
        onClick={() => prev && go(prev.id)}
        className="w-9 shrink-0 py-1 text-sm hover:bg-muted/60 disabled:cursor-default disabled:opacity-40"
        aria-label="Previous round"
      >‹</button>
      <select
        value={localId ?? ''}
        onChange={(e) => go(e.target.value)}
        aria-label="Selected league round"
        className="min-w-0 flex-1 border-x border-border bg-background px-2 py-1 text-xs sm:w-64 sm:flex-none sm:text-sm"
      >
        {occurrences.map((o) => (
          <option key={o.id} value={o.id}>
            {occurrenceContextLabel(o.label, o.id === selectedId ? selectedStatus : o.resultStatus)}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={!next}
        onClick={() => next && go(next.id)}
        className="w-9 shrink-0 py-1 text-sm hover:bg-muted/60 disabled:cursor-default disabled:opacity-40"
        aria-label="Next round"
      >›</button>
      <button
        type="button"
        disabled={isLatestResultsDisabled(localId, latestResultsId)}
        onClick={() => latestResultsId && go(latestResultsId)}
        aria-label="Return to latest scored round"
        className="min-w-14 shrink-0 whitespace-nowrap border-l border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-muted/60 disabled:cursor-default disabled:opacity-40"
      >
        Latest
      </button>
    </div>
  )
}
