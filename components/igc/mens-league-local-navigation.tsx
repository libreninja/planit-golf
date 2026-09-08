'use client'

import Link from 'next/link'
import type { MouseEvent } from 'react'
import { cn } from '@/lib/utils/cn'
import {
  MENS_LEAGUE_DESTINATIONS,
  isMensLeagueDestinationActive,
  type MensLeagueDestination,
} from '@/lib/igc/mens-league-navigation'
import type { View } from '@/lib/competition/types'

export function MensLeagueLocalNavigation({
  activeDestination,
  onSelectStandingsView,
}: {
  activeDestination: MensLeagueDestination
  onSelectStandingsView?: (view: View) => void
}) {
  const onClick = (
    event: MouseEvent<HTMLAnchorElement>,
    view: 'season' | 'weekly' | null,
  ) => {
    if (!view || !onSelectStandingsView) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return

    // Season and Weekly are already preloaded in the standings shell. Preserve
    // the current week/filter query while retaining a real link for refresh,
    // copy-link, open-in-new-tab, and no-JavaScript navigation.
    event.preventDefault()
    onSelectStandingsView(view)
  }

  return (
    <header className="space-y-2.5">
      <h1 className="text-2xl font-semibold leading-tight sm:text-3xl">Men&apos;s League</h1>
      <nav aria-label="Men's League">
        <div className="grid w-full grid-cols-3 border-b border-border">
          {MENS_LEAGUE_DESTINATIONS.map((destination) => {
            const active = isMensLeagueDestinationActive(destination.key, activeDestination)
            return (
              <Link
                key={destination.key}
                href={destination.href}
                aria-current={active ? 'page' : undefined}
                onClick={(event) => onClick(event, destination.view)}
                className={cn(
                  '-mb-px min-h-9 border-b-2 px-2 py-2 text-center text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  active
                    ? 'border-foreground text-foreground'
                    : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
                )}
              >
                {destination.label}
              </Link>
            )
          })}
        </div>
      </nav>
    </header>
  )
}
