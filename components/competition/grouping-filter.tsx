'use client'

import type { GroupingAvailability } from '@/lib/competition/types'
import { flightColor } from './flight-color'
import { SegmentedControl } from './segmented-control'

// Flight filter for Men's multi-flight weeks (P1-3). The "All Flights" tab
// stays neutral; each flight tab is tinted with its flightColor so the tab and
// the matching leaderboard rows/badges share one color per flight. Only renders
// for kind === 'multi' (women's single and live unflighted never reach here).
//
// Geometry/selection styling is owned by the shared SegmentedControl (one pill,
// square interior seams, constant geometry). Flight colors are applied as
// bg+text only (no per-segment border or radius) so the pill keeps its single
// border and the segments never read as individually rounded buttons (FIX 3).
export function GroupingFilter({
  groupings, selected, onSelect,
}: { groupings: Extract<GroupingAvailability, { kind: 'multi' }>; selected: string; onSelect: (g: string) => void }) {
  if (groupings.kind !== 'multi') return null
  const options = [{ key: 'all', label: 'All Flights' }, ...groupings.groupings].map((g) => {
    const color = g.key === 'all' ? null : flightColor(g.key)
    const flightNumber = /^Flight\s+(\d+)$/i.exec(g.key)?.[1]
    const projected = /^Projected\s+Flight\s+\d+$/i.test(g.label)
    return {
      key: g.key,
      label: g.label,
      // Keep provenance visible in the selector itself. The shorter projected
      // copy lets scoring and grouping remain on one mobile row.
      compactLabel: flightNumber
        ? (projected ? `Proj. F${flightNumber}` : `Flight ${flightNumber}`)
        : undefined,
      // bg+text only — no border, no radius (the SegmentedControl pill owns those).
      tint: color ? { idle: color.tabIdle, active: color.tabActive } : undefined,
    }
  })
  return (
    <SegmentedControl
      ariaLabel="Flight filter"
      options={options}
      selected={selected}
      onSelect={onSelect}
      fill
    />
  )
}
