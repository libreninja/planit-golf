'use client'

// Primary Season Points / Weekly-Live view switch (P1-1). Hoisted above the
// conditional body so the switch is visible from BOTH views. Returns null for a
// single-view competition (e.g. women's).
//
// INSTANT toggle (P1-1): the shell owns `view` state and preloads BOTH the
// season-points rows and the weekly workspace, so switching views is a pure
// client state change — no router navigation, no server round-trip, no pending
// spinner. The single-selection invariant lives in the shared SegmentedControl
// (one pill, square interior seam, constant geometry — see segmented-control).

import { SegmentedControl } from './segmented-control'

const VIEW_LABELS: Record<string, string> = {
  season: 'Season Points',
  weekly: 'Weekly / Live',
}

export function ViewTabs({
  views, selectedView, onSelectView,
}: { views: string[]; selectedView: string; onSelectView: (view: string) => void }) {
  return (
    <SegmentedControl
      ariaLabel="Standings view"
      options={views.map((v) => ({ key: v, label: VIEW_LABELS[v] ?? v.charAt(0).toUpperCase() + v.slice(1) }))}
      selected={selectedView}
      onSelect={onSelectView}
    />
  )
}