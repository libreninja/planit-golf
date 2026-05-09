import Link from 'next/link'
import { ArrowLeft, ArrowRight, CalendarDays, MapPin } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { getIgcEventsIndex, type IgcEventSummary } from '@/lib/igc/data'

export const dynamic = 'force-dynamic'

function formatDateRange(event: IgcEventSummary) {
  if (!event.starts_on) return 'Dates coming soon'

  const startLabel = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${event.starts_on}T00:00:00Z`))

  if (!event.ends_on || event.ends_on === event.starts_on) return startLabel

  const endLabel = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${event.ends_on}T00:00:00Z`))

  return `${startLabel} - ${endLabel}`
}

export default async function IgcEventsPage() {
  const { setupRequired, community, events } = await getIgcEventsIndex()

  return (
    <main className="min-h-screen bg-background">
      <div className="border-b border-border bg-foreground text-background">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link href="/igc" className="font-display text-2xl leading-none">
            {community?.short_name || 'IGC'}
          </Link>
          <Button asChild variant="outline" size="sm" className="gap-2 border-white/30 bg-transparent text-background hover:bg-white/10 hover:text-background">
            <Link href="/igc">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Hub
            </Link>
          </Button>
        </div>
      </div>

      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:py-10">
        <div className="mb-5">
          <Badge className="rounded-md bg-primary/10 text-primary hover:bg-primary/10">
            Interbay Golf Club
          </Badge>
          <h1 className="mt-4 text-4xl font-semibold leading-tight">Events</h1>
        </div>

        {events.length > 0 ? (
          <div className="grid gap-3">
            {events.map((event) => (
              <Link
                key={event.id}
                href={`/igc/events/${event.slug}`}
                className="grid gap-4 rounded-md border border-border bg-white/80 p-4 shadow-sm transition hover:border-primary/50 sm:grid-cols-[1fr_auto] sm:items-center"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <CalendarDays className="h-4 w-4" aria-hidden="true" />
                      {formatDateRange(event)}
                    </span>
                    {event.location_name ? (
                      <span className="inline-flex items-center gap-1.5">
                        <MapPin className="h-4 w-4" aria-hidden="true" />
                        {event.location_name}
                      </span>
                    ) : null}
                  </div>
                  <h2 className="mt-2 text-2xl font-semibold">{event.name}</h2>
                  {event.description ? (
                    <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{event.description}</p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2 text-sm font-medium text-primary">
                  Open
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-border bg-white/80 p-5 text-sm text-muted-foreground">
            {setupRequired ? 'Apply the IGC companion migration to create the first event shell.' : 'No IGC events are configured yet.'}
          </div>
        )}
      </div>
    </main>
  )
}
