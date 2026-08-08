'use client'

// Shared segmented control: ONE pill-shaped container whose segment
// backgrounds change as the selection moves. Used by ViewTabs (Season Points
// ↔ Weekly/Live), ScoringToggle (Gross ↔ Net), and GroupingFilter
// (All | Flight 1 | Flight 2 | Flight 3) so every segmented control in the
// standings shell shares IDENTICAL geometry (FIX 3 / acceptance gate).
//
// Geometry rules (the visual contract):
//   - The OUTSIDE perimeter is rounded (the container: rounded-md + a single
//     border). Only the first segment's left edge and the last segment's right
//     edge are rounded — achieved via the container's `overflow-hidden`, which
//     clips each segment's background to the pill. The segments themselves
//     carry NO corner radius.
//   - The shared INTERIOR edges between segments are SQUARE. Segments sit
//     flush (no gap), separated by a single hairline divider that is part of
//     the pill (a left border on every segment but the first) — NOT a second
//     per-segment border, so there are no doubled borders and no visible gaps.
//   - GEOMETRY IS CONSTANT. Selection swaps a segment's background/foreground
//     classes only; it never adds/removes radius, borders, or padding. A
//     selected button does not become "more rectangular" and segments never
//     read as a row of individually rounded pills.
//   - Exactly one option is selected at a time (`aria-pressed` reflects it).
//
// `tint` (optional, per option) supplies colored idle/active classes (e.g. a
// flight's subtle bg+text). It MUST contain only background/text/hover classes
// — no border, no radius — so the single-container-border + constant-geometry
// invariants hold. "All" / neutral options pass no tint and use the neutral
// treatment.

import { cn } from '@/lib/utils/cn'

export interface SegmentedOption {
  key: string
  label: string
  /** Colored idle/active classes (bg+text only, no border/radius). Null = neutral. */
  tint?: { idle: string; active: string }
}

export function SegmentedControl({
  options, selected, onSelect, ariaLabel,
}: {
  options: SegmentedOption[]
  selected: string
  onSelect: (key: string) => void
  ariaLabel?: string
}) {
  if (options.length <= 1) return null
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex overflow-hidden rounded-md border border-border"
    >
      {options.map((o, i) => {
        const active = selected === o.key
        const isFirst = i === 0
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onSelect(o.key)}
            aria-pressed={active}
            className={cn(
              'px-3 py-1 text-sm whitespace-nowrap transition-colors',
              // Single hairline seam between segments (part of the pill, not a
              // second border). First segment has no left divider.
              !isFirst && 'border-l border-border/70',
              active
                ? (o.tint ? o.tint.active : 'bg-foreground text-background')
                : (o.tint
                    ? o.tint.idle
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'),
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}