import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowRight } from 'lucide-react'

import { Button } from '@/components/ui/button'

export const dynamic = 'force-dynamic'

interface LegacyLeagueProps {
  searchParams: Promise<{ league?: string; week?: string }>
}

// Legacy /igc/league route. Men's and Women's League used to share this one
// route behind a ?league= toggle, with Men's as the implicit default. That
// modeled the leagues as a single toggleable thing and arbitrarily favored
// Men's. They are now peer entities with their own direct routes:
//   /igc/mens-league   /igc/womens-league
//
// To preserve existing links/bookmarks that used the old query-param model, a
// ?league=mens|womens (optionally with &week=N) request redirects to the
// corresponding direct route. Anything else lands on a neutral league index
// that lists both leagues equally — it never silently picks Men's.
export default async function LegacyLeagueRoute({ searchParams }: LegacyLeagueProps) {
  const { league, week } = await searchParams

  if (league === 'mens' || league === 'womens') {
    const target = league === 'mens' ? '/igc/mens-league' : '/igc/womens-league'
    const qs = week ? `?week=${encodeURIComponent(week)}` : ''
    redirect(`${target}${qs}`)
  }

  return (
    <div>
      <div className="py-2">
        <div className="mb-8">
          <h1 className="text-3xl font-bold">Interbay Golf Club leagues</h1>
          <p className="text-muted-foreground">
            Choose a league to view standings and results.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Link
            href="/igc/mens-league"
            className="grid gap-3 rounded-md border border-border bg-white/80 p-5 shadow-sm transition hover:border-primary/50 sm:grid-cols-[1fr_auto] sm:items-center"
          >
            <div>
              <h2 className="text-xl font-semibold">Men&apos;s League</h2>
              <p className="mt-1 text-sm text-muted-foreground">Weekly standings and results.</p>
            </div>
            <div className="flex items-center gap-2 text-sm font-medium text-primary">
              Standings
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </div>
          </Link>

          <Link
            href="/igc/womens-league"
            className="grid gap-3 rounded-md border border-border bg-white/80 p-5 shadow-sm transition hover:border-primary/50 sm:grid-cols-[1fr_auto] sm:items-center"
          >
            <div>
              <h2 className="text-xl font-semibold">Women&apos;s League</h2>
              <p className="mt-1 text-sm text-muted-foreground">Weekly standings and results.</p>
            </div>
            <div className="flex items-center gap-2 text-sm font-medium text-primary">
              Standings
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </div>
          </Link>
        </div>

        <div className="mt-6">
          <Button asChild variant="ghost" size="sm" className="gap-2">
            <Link href="/igc">Back to Interbay Golf Club</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}