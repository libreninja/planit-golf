'use client'

// Primary Season Points / Weekly-Live view switch. Always rendered by the
// server wrapper (above the conditional body) so the switch is visible from
// BOTH the season and weekly views — previously the tabs lived inside the
// weekly workspace and vanished on the season view (P1). Returns null for a
// single-view competition (e.g. women's) so it never renders a one-item bar.
//
// Snappy segmented control (FIX 3): exactly ONE tab is ever visually selected.
// On click the filled background immediately moves to the clicked tab and
// leaves the previous tab — BEFORE the server re-renders — so the two tabs
// never both appear selected at once. The selection logic lives in the pure
// `tabSelectionState` helper (see view-tabs-selection.ts) and is unit-tested
// there. `pendingView` is never cleared in an effect: it is inert once the
// server catches up because `pendingView !== selectedView` is then false, so
// the spinner/disabled state falls out of the render with no effect.

import { useState } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils/cn'
import { tabSelectionState } from './view-tabs-selection'

const VIEW_LABELS: Record<string, string> = {
  season: 'Season Points',
  weekly: 'Weekly / Live',
}

export function ViewTabs({
  views, selectedView,
}: { views: string[]; selectedView: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [pendingView, setPendingView] = useState<string | null>(null)

  if (views.length <= 1) return null

  // In flight until the server re-render catches up to the requested view.
  const inFlight = pendingView !== null && pendingView !== selectedView

  const navigate = (view: string) => {
    if (view === selectedView) return            // already there
    if (inFlight && view === pendingView) return  // duplicate of the pending switch
    setPendingView(view)
    const next = new URLSearchParams(params.toString())
    next.set('view', view)
    router.replace(`${pathname}?${next.toString()}`, { scroll: false })
  }

  return (
    <div className="inline-flex rounded-md border border-border p-0.5">
      {views.map((v) => {
        const label = VIEW_LABELS[v] ?? v.charAt(0).toUpperCase() + v.slice(1)
        // FIX 3: a single displayed selection. While a navigation is in flight,
        // the PENDING view is the sole filled tab (the previous server view
        // loses its fill immediately); otherwise the server-confirmed view is.
        // Only one tab is ever active — never both. See view-tabs-selection.ts.
        const { active, pending } = tabSelectionState(selectedView, pendingView, v)
        return (
          <button
            key={v}
            type="button"
            onClick={() => navigate(v)}
            aria-pressed={active}
            disabled={inFlight && !pending}
            className={cn(
              'inline-flex items-center gap-1.5 rounded px-3 py-1 text-sm transition-colors',
              active
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground',
              pending && 'cursor-progress',
            )}
          >
            {label}
            {pending && (
              <span
                aria-label="Loading"
                className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-background/40 border-t-background"
              />
            )}
          </button>
        )
      })}
    </div>
  )
}