'use client'

import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, SlidersHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { LEADERBOARD_CONTROL_STICKY_CLASSES, nextLeaderboardPanelState } from './leaderboard-control-layout'

export function LeaderboardControlPanel({
  summary,
  action,
  children,
}: {
  summary: string
  action?: ReactNode
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
        <div className={cn('flex min-w-0 items-center', expanded && 'border-b border-border')}>
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls="leaderboard-control-content"
            onClick={toggle}
            className="flex min-h-10 min-w-0 flex-1 items-center justify-between gap-2 px-3 text-left sm:min-h-9"
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
          {action ? <div className="shrink-0 pr-2">{action}</div> : null}
        </div>

        <div
          id="leaderboard-control-content"
          className={cn('p-2.5', expanded ? 'block' : 'hidden')}
        >
          {children}
        </div>
    </div>
  )
}
