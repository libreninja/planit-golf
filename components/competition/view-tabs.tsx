'use client'

// Primary Season Points / Weekly-Live view switch. Always rendered by the
// server wrapper (above the conditional body) so the switch is visible from
// BOTH the season and weekly views — previously the tabs lived inside the
// weekly workspace and vanished on the season view (P1). Returns null for a
// single-view competition (e.g. women's) so it never renders a one-item bar.
//
// Optimistic (§7): the click is acknowledged IMMEDIATELY — the selected-tab
// styling flips and a subtle pending spinner appears on the chosen tab before
// the server re-renders. Because this is a query-param navigation, the old
// view stays mounted during the transition (no flash), and a second click of
// the SAME tab while that switch is already pending is a no-op (no duplicate
// navigation). `pendingView` is never cleared in an effect: it is inert once
// the server catches up because `pendingView !== selectedView` is then false,
// so the spinner/disabled state falls out of the render with no effect.

import { useState } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils/cn'

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
        const active = selectedView === v
        const pending = inFlight && pendingView === v
        return (
          <button
            key={v}
            type="button"
            onClick={() => navigate(v)}
            aria-pressed={active}
            disabled={inFlight && !pending}
            className={cn(
              'inline-flex items-center gap-1.5 rounded px-3 py-1 text-sm transition-colors',
              (active || pending)
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