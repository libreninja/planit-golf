'use client'

import { SegmentedControl } from './segmented-control'

// Gross ↔ Net segmented control. Instant client toggle (P1-2): the shell
// preloads both scorings, so a click is a state swap with no server round-trip.
// Geometry/selection styling is owned by the shared SegmentedControl (one pill,
// square seam, constant geometry — see segmented-control).
export function ScoringToggle({
  modes, selected, onSelect,
}: { modes: { key: string; label: string }[]; selected: string; onSelect: (m: string) => void }) {
  return (
    <SegmentedControl
      ariaLabel="Scoring"
      options={modes.map((m) => ({ key: m.key, label: m.label.charAt(0).toUpperCase() + m.label.slice(1) }))}
      selected={selected}
      onSelect={onSelect}
    />
  )
}