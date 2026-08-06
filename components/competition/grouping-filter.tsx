'use client'

import { cn } from '@/lib/utils/cn'
import type { GroupingAvailability } from '@/lib/competition/types'
import { flightColor } from './flight-color'

// Flight filter for finalized Men's multi-flight weeks (P1-3). The "All" tab
// stays neutral; each flight tab is tinted with its flightColor so the tab and
// the matching leaderboard rows/badges share one color per flight. Only renders
// for kind === 'multi' (women's single and live unflighted never reach here).
export function GroupingFilter({
  groupings, selected, onSelect,
}: { groupings: Extract<GroupingAvailability, { kind: 'multi' }>; selected: string; onSelect: (g: string) => void }) {
  if (groupings.kind !== 'multi') return null
  const options = [{ key: 'all', label: 'All' }, ...groupings.groupings]
  return (
    <div className="inline-flex flex-wrap gap-1.5">
      {options.map((g) => {
        const color = g.key === 'all' ? null : flightColor(g.key)
        const isActive = selected === g.key
        return (
          <button
            key={g.key}
            type="button"
            onClick={() => onSelect(g.key)}
            className={cn(
              'rounded-md border px-2.5 py-1 text-sm transition-colors',
              isActive
                ? (color
                    ? color.tabActive
                    : 'border-foreground bg-foreground text-background')
                : (color
                    ? color.tabIdle
                    : 'border-border text-muted-foreground hover:text-foreground'),
            )}
          >
            {g.label}
          </button>
        )
      })}
    </div>
  )
}