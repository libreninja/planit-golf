'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { occurrenceNavNeighbors, type NavOcc } from './occurrence-nav-neighbors'

// Occurrence (week) navigation: prev/next chevrons + a native <select>.
// Occurrences arrive chronological (oldest→newest): ‹ = older, › = newer (P3).
//
// The selection updates OPTIMISTICALLY on click (P5): the control reflects the
// new selection immediately without waiting for the server round-trip. The
// existing leaderboard stays mounted while the new occurrence's data loads
// (App Router keeps the old segment during a query-only navigation, and the
// workspace is keyed by occurrence+scoring so it remounts with fresh initial
// data when the new render arrives — no stale-data, no full skeleton).
export function OccurrenceNav({
  occurrences, selectedId, queryParam,
}: { occurrences: NavOcc[]; selectedId: string | null; queryParam: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [localId, setLocalId] = useState<string | null>(selectedId)
  const [navigating, setNavigating] = useState(false)

  // Sync optimistic state when the server-rendered selection arrives.
  useEffect(() => {
    setLocalId(selectedId)
    setNavigating(false)
  }, [selectedId])

  const { prev, next } = occurrenceNavNeighbors(occurrences, localId)

  const urlFor = (id: string) => {
    const np = new URLSearchParams(params.toString())
    np.set(queryParam, id)
    return `${pathname}?${np.toString()}`
  }

  const go = (id: string) => {
    if (!id || id === localId) return
    setLocalId(id)        // optimistic: the control acknowledges the click instantly
    setNavigating(true)
    router.replace(urlFor(id), { scroll: false })
  }

  // Prefetch the adjacent occurrence routes so the next chevron click swaps
  // without a cold fetch (P5).
  const searchString = params.toString()
  useEffect(() => {
    if (prev) router.prefetch(urlFor(prev.id))
    if (next) router.prefetch(urlFor(next.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prev?.id, next?.id, pathname, searchString])

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={!prev}
        onClick={() => prev && go(prev.id)}
        className="rounded-md border border-border px-2 py-1 text-sm disabled:opacity-40"
        aria-label="Previous week"
      >‹</button>
      <select
        value={localId ?? ''}
        onChange={(e) => go(e.target.value)}
        className="rounded-md border border-border bg-background px-2 py-1 text-sm"
      >
        {occurrences.map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
      <button
        type="button"
        disabled={!next}
        onClick={() => next && go(next.id)}
        className="rounded-md border border-border px-2 py-1 text-sm disabled:opacity-40"
        aria-label="Next week"
      >›</button>
      {navigating && <span className="text-xs text-muted-foreground/70">Loading…</span>}
    </div>
  )
}