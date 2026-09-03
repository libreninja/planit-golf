'use client'

import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, SlidersHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { LEADERBOARD_CONTROL_STICKY_CLASSES, nextLeaderboardPanelState } from './leaderboard-control-layout'

export function LeaderboardControlPanel({
  summary,
  children,
}: {
  summary: string
  children: ReactNode
}) {
  const [expanded, setExpanded] = useState(true)
  const toggle = () => setExpanded((value) => nextLeaderboardPanelState(value, 'toggle'))

  return (
    <div
      data-leaderboard-controls
      data-expanded={expanded ? 'true' : 'false'}
      className={cn(
        LEADERBOARD_CONTROL_STICKY_CLASSES,
        'rounded-lg border border-border bg-card/95 shadow-sm backdrop-blur',
      )}
    >
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls="leaderboard-control-content"
          onClick={toggle}
          className={cn(
            'flex min-h-12 w-full items-center justify-between gap-3 px-3 text-left sm:min-h-9',
            expanded && 'border-b border-border',
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            <SlidersHorizontal aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="line-clamp-2 text-xs font-medium leading-tight">{summary}</span>
          </span>
          {expanded ? (
            <ChevronUp aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <span className="sr-only">{expanded ? 'Collapse leaderboard controls' : 'Expand leaderboard controls'}</span>
        </button>

        <div
          id="leaderboard-control-content"
          className={cn('p-2.5 sm:p-3', expanded ? 'block' : 'hidden')}
        >
          {children}
        </div>
    </div>
  )
}
