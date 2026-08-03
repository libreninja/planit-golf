'use client'

// Primary Season Points / Weekly-Live view switch. Always rendered by the
// server wrapper (above the conditional body) so the switch is visible from
// BOTH the season and weekly views — previously the tabs lived inside the
// weekly workspace and vanished on the season view (P1). Returns null for a
// single-view competition (e.g. women's) so it never renders a one-item bar.

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils/cn'

const VIEW_LABELS: Record<string, string> = {
  season: 'Season Points',
  weekly: 'Weekly / Live',
}

export function ViewTabs({
  views, selectedView,
}: { views: string[]; selectedView: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  if (views.length <= 1) return null

  const navigate = (view: string) => {
    const next = new URLSearchParams(params.toString())
    next.set('view', view)
    router.replace(`${pathname}?${next.toString()}`, { scroll: false })
  }

  return (
    <div className="inline-flex rounded-md border border-border p-0.5">
      {views.map((v) => {
        const label = VIEW_LABELS[v] ?? v.charAt(0).toUpperCase() + v.slice(1)
        const active = selectedView === v
        return (
          <button
            key={v}
            type="button"
            onClick={() => navigate(v)}
            aria-pressed={active}
            className={cn(
              'rounded px-3 py-1 text-sm',
              active ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
