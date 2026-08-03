'use client'

import type { ResultStatus } from '@/lib/competition/types'

export function StatusBadge({ status }: { status: ResultStatus }) {
  if (status === 'live') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
        LIVE
      </span>
    )
  }
  if (status === 'final') {
    return <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Final</span>
  }
  return null
}
