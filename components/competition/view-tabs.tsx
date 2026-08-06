'use client'

// Primary Season Points / Weekly-Live view switch (P1-1). Hoisted above the
// conditional body so the switch is visible from BOTH views. Returns null for a
// single-view competition (e.g. women's).
//
// INSTANT toggle (P1-1): the shell owns `view` state and preloads BOTH the
// season-points rows and the weekly workspace, so switching views is a pure
// client state change — no router navigation, no server round-trip, no pending
// spinner. The active tab is driven solely by `selectedView`; the pure
// `tabSelectionState` helper (with a null pendingView) computes active, keeping
// the single-selection invariant unit-tested in view-tabs-selection.test.ts.

import { cn } from '@/lib/utils/cn'
import { tabSelectionState } from './view-tabs-selection'

const VIEW_LABELS: Record<string, string> = {
  season: 'Season Points',
  weekly: 'Weekly / Live',
}

export function ViewTabs({
  views, selectedView, onSelectView,
}: { views: string[]; selectedView: string; onSelectView: (view: string) => void }) {
  if (views.length <= 1) return null

  return (
    <div className="inline-flex rounded-md border border-border p-0.5">
      {views.map((v) => {
        const label = VIEW_LABELS[v] ?? v.charAt(0).toUpperCase() + v.slice(1)
        const { active } = tabSelectionState(selectedView, null, v)
        return (
          <button
            key={v}
            type="button"
            onClick={() => onSelectView(v)}
            aria-pressed={active}
            className={cn(
              'inline-flex items-center gap-1.5 rounded px-3 py-1 text-sm transition-colors',
              active
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}