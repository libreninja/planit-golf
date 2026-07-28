import Link from 'next/link'
import { ArrowRight, CalendarDays, MapPin, Trophy } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { getIgcEventsIndex, type IgcEventSummary } from '@/lib/igc/data'
import { pacificToday } from '@/lib/pacific-time'

export const dynamic = 'force-dynamic'

function formatDateRange(event: IgcEventSummary) {
  if (!event.starts_on) return 'Dates coming soon'

  const start = new Date(`${event.starts_on}T00:00:00Z`)
  const startLabel = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(start)

  if (!event.ends_on || event.ends_on === event.starts_on) return startLabel

  const end = new Date(`${event.ends_on}T00:00:00Z`)
  const endLabel = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(end)

  return `${startLabel} - ${endLabel}`
}

// Only treat an event as current/upcoming if its start date is today or later,
// or it is actively running. Past events (including the seeded "Upcoming IGC
// Event" companion shell from migration 014, dated 2026-05-30 with no Golf
// Genius linkage) must not be presented as current.
function isCurrentOrUpcoming(event: IgcEventSummary, today: string): boolean {
  if (event.status === 'active') return true
  return Boolean(event.starts_on) && event.starts_on! >= today
}

export default async function IgcPage() {
  const { setupRequired, community, events } = await getIgcEventsIndex()
  const today = pacificToday()
  const currentEvents = events.filter((e) => isCurrentOrUpcoming(e, today))
  const featuredEvent = currentEvents[0] ?? null

  return (
    <div>
      <div className="py-2">
        <section className="grid gap-5 sm:grid-cols-[1.1fr_0.9fr] sm:items-end">
          <div>
            <Badge className="rounded-md bg-primary/10 text-primary hover:bg-primary/10">
              {community?.short_name || 'IGC'}
            </Badge>
            <h1 className="mt-4 text-4xl font-semibold leading-tight sm:text-6xl">
              {community?.name || 'Interbay Golf Club'}
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
              {community?.description || 'The IGC event hub for schedules, tee times, leaderboard updates, logistics, and event memory.'}
            </p>
          </div>

          <div className="grid gap-2 rounded-md border border-border bg-white/75 p-4 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Trophy className="h-4 w-4 text-primary" aria-hidden="true" />
              Current Companion
            </div>
            {featuredEvent ? (
              <>
                <h2 className="text-2xl font-semibold leading-tight">{featuredEvent.name}</h2>
                <div className="space-y-1 text-sm text-muted-foreground">
                  <p className="flex items-center gap-2">
                    <CalendarDays className="h-4 w-4" aria-hidden="true" />
                    {formatDateRange(featuredEvent)}
                  </p>
                  {featuredEvent.location_name ? (
                    <p className="flex items-center gap-2">
                      <MapPin className="h-4 w-4" aria-hidden="true" />
                      {featuredEvent.location_name}
                    </p>
                  ) : null}
                </div>
                <Button asChild className="mt-2 gap-2">
                  <Link href={`/igc/events/${featuredEvent.slug}`}>
                    Open Event
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                {setupRequired
                  ? 'No Interbay companion events are configured yet.'
                  : 'No current Interbay event right now.'}
              </p>
            )}
          </div>
        </section>

        {currentEvents.length > 0 ? (
          <section className="mt-8">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-2xl font-semibold">Upcoming events</h2>
              <Button asChild variant="ghost" size="sm" className="gap-2">
                <Link href="/igc/events">
                  View All
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </Button>
            </div>
            <div className="grid gap-3">
              {currentEvents.map((event) => (
                <Link
                  key={event.id}
                  href={`/igc/events/${event.slug}`}
                  className="grid gap-3 rounded-md border border-border bg-white/80 p-4 shadow-sm transition hover:border-primary/50 sm:grid-cols-[1fr_auto] sm:items-center"
                >
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      {formatDateRange(event)}
                    </p>
                    <h3 className="mt-1 text-xl font-semibold">{event.name}</h3>
                    {event.description ? (
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{event.description}</p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2 text-sm font-medium text-primary">
                    Open
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  )
}
