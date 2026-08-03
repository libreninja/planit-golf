'use client'

import { cn } from '@/lib/utils/cn'
import type { GroupingAvailability } from '@/lib/competition/types'

export function GroupingFilter({
  groupings, selected, onSelect,
}: { groupings: Extract<GroupingAvailability, { kind: 'multi' }>; selected: string; onSelect: (g: string) => void }) {
  if (groupings.kind !== 'multi') return null
  const options = [{ key: 'all', label: 'All' }, ...groupings.groupings]
  return (
    <div className="inline-flex flex-wrap gap-1.5">
      {options.map((g) => (
        <button key={g.key} type="button" onClick={() => onSelect(g.key)}
          className={cn('rounded-md border px-2.5 py-1 text-sm', selected === g.key ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground hover:text-foreground')}>
          {g.label}
        </button>
      ))}
    </div>
  )
}
