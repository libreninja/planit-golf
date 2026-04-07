import Link from 'next/link'
import { notFound } from 'next/navigation'

import { confirmPaceScan } from '@/app/scan/actions'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  fetchLiveFoursomes,
  formatDateLabel,
  formatTimeLabel,
  getActivePaceEvent,
  getCheckpointByToken,
  type TeeSheetFoursome,
} from '@/lib/public-pace'

function statusCopy(status?: string) {
  if (status === 'recorded') return 'Timestamp recorded. You can close this page or check the leaderboard.'
  if (status === 'stale') return 'That tee group is no longer available. Choose the current group below.'
  if (status === 'no-event') return 'No active tee sheet is configured for this checkpoint yet.'
  if (status === 'invalid') return 'This scan could not be recorded. Try scanning the QR code again.'
  if (status === 'lookup-error') return 'The live tee sheet could not be loaded. Try again in a moment.'
  return null
}

export default async function ScanPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ status?: string }>
}) {
  const [{ token }, { status }] = await Promise.all([params, searchParams])
  const checkpoint = await getCheckpointByToken(token)

  if (!checkpoint) notFound()

  const event = await getActivePaceEvent(checkpoint)
  let foursomes: TeeSheetFoursome[] = []
  let lookupError = false
  if (event) {
    try {
      foursomes = await fetchLiveFoursomes(event, checkpoint)
    } catch {
      lookupError = true
    }
  }
  const message = statusCopy(status)

  return (
    <main className="min-h-screen px-4 py-6 text-foreground sm:py-10">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
        <section className="rounded-[2rem] border border-emerald-900/10 bg-white/80 p-6 shadow-xl shadow-emerald-950/10 backdrop-blur sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-primary">planit.golf public checkpoint</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">{checkpoint.label}</h1>
          <p className="mt-3 max-w-xl text-base text-muted-foreground">
            Select your foursome to record the checkpoint timestamp. This page does not require member sign-in.
          </p>
          {event ? (
            <div className="mt-5 flex flex-wrap gap-2 text-sm">
              <span className="rounded-full bg-primary px-3 py-1 font-medium text-primary-foreground">
                {formatDateLabel(event.event_date)}
              </span>
              <span className="rounded-full bg-secondary px-3 py-1 font-medium text-secondary-foreground">
                {event.course_name}
              </span>
              {event.league ? (
                <span className="rounded-full bg-accent px-3 py-1 font-medium text-accent-foreground">
                  {event.league === 'mens' ? "Men's league" : "Women's league"}
                </span>
              ) : null}
            </div>
          ) : null}
        </section>

        {message ? (
          <Card className="border-primary/20 bg-primary/10">
            <CardContent className="p-4 text-sm font-medium text-primary">{message}</CardContent>
          </Card>
        ) : null}

        {!event ? (
          <Card>
            <CardHeader>
              <CardTitle>No active event</CardTitle>
              <CardDescription>
                Add or sync an upcoming event with Golf Genius event and round IDs before using this checkpoint.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : null}

        {event && lookupError ? (
          <Card>
            <CardHeader>
              <CardTitle>Tee sheet unavailable</CardTitle>
              <CardDescription>
                The live tee sheet could not be loaded from Golf Genius. Confirm the API key, event ID, and round ID.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : null}

        {event && !lookupError && foursomes.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No recent groups</CardTitle>
              <CardDescription>
                No tee groups are inside the checkpoint window yet. If your group just teed off, refresh this page.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : null}

        <div className="grid gap-3">
          {foursomes.map((foursome) => (
            <form key={foursome.key} action={confirmPaceScan.bind(null, token)}>
              <input type="hidden" name="foursomeKey" value={foursome.key} />
              <button
                type="submit"
                className="group w-full rounded-[1.5rem] border border-border bg-white/90 p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg hover:shadow-emerald-950/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <span className="flex items-start justify-between gap-4">
                  <span>
                    <span className="block text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                      Teed off {formatTimeLabel(foursome.actualStartAt)}
                    </span>
                    <span className="mt-2 block text-2xl font-semibold text-foreground">
                      {foursome.playerNames.length > 0 ? foursome.playerNames.join(' / ') : `Tee time ${foursome.teeTime}`}
                    </span>
                  </span>
                  <span className="rounded-full bg-primary px-3 py-1 text-sm font-semibold text-primary-foreground transition group-hover:bg-foreground">
                    Record
                  </span>
                </span>
              </button>
            </form>
          ))}
        </div>

        <Button asChild variant="outline" className="self-start rounded-full bg-white/80">
          <Link href="/leaderboard">View leaderboard</Link>
        </Button>
      </div>
    </main>
  )
}
