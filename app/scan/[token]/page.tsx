import Link from 'next/link'
import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'

import { confirmPaceScan } from '@/app/scan/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  formatDateLabel,
  finishPaceTimingRun,
  getActivePaceEvent,
  getCheckpointByToken,
  getPaceTimingRunByToken,
} from '@/lib/public-pace'

const paceRunCookieName = 'public_pace_run'

function statusCopy(status?: string) {
  if (status === 'started') return 'Start time recorded. Scan the next QR code when your group finishes the hole.'
  if (status === 'no-event') return 'No active tee sheet is configured for this checkpoint yet.'
  if (status === 'invalid') return 'This scan could not be recorded. Check the GGID and try again.'
  if (status === 'invalid-finish') return 'That continuation link is invalid or expired.'
  return null
}

export default async function ScanPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ status?: string }>
}) {
  const [{ token }, { status }, cookieStore] = await Promise.all([params, searchParams, cookies()])
  const checkpoint = await getCheckpointByToken(token)

  if (!checkpoint) notFound()

  const event = await getActivePaceEvent(checkpoint)
  const activeRunToken = cookieStore.get(paceRunCookieName)?.value || null
  const activeRun = activeRunToken ? await getPaceTimingRunByToken(activeRunToken) : null
  const shouldFinishActiveRun = Boolean(
    activeRun &&
    !activeRun.finished_at &&
    activeRun.checkpoint_id !== checkpoint.id,
  )

  if (shouldFinishActiveRun && activeRunToken) {
    const finishedRun = await finishPaceTimingRun({ checkpoint, finishToken: activeRunToken })
    if (!finishedRun) redirect(`/scan/${token}?status=invalid-finish`)
    redirect('/leaderboard?status=finished')
  }

  if (activeRun?.finished_at && activeRun.finished_checkpoint_id === checkpoint.id) {
    redirect('/leaderboard?status=finished')
  }

  const checkpointIsFinishOnly = checkpoint.label.toLowerCase() === 'checkpoint 2'
  const showActiveRun = Boolean(activeRun && !activeRun.finished_at)
  const message = statusCopy(status)

  return (
    <main className="min-h-screen px-4 py-6 text-foreground sm:py-10">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
        <section className="rounded-[2rem] border border-emerald-900/10 bg-white/80 p-6 shadow-xl shadow-emerald-950/10 backdrop-blur sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-primary">planit.golf public checkpoint</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">{checkpoint.label}</h1>
          <p className="mt-3 max-w-xl text-base text-muted-foreground">
            Enter the GGID assigned to your foursome. This starts the timer; scan the next QR code to finish.
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

        {showActiveRun ? (
          <Card className="border-primary/20 bg-primary/10">
            <CardHeader>
              <CardTitle>Timer is running</CardTitle>
              <CardDescription>
                Active GGID {activeRun?.group_ggid}. Scan the next QR code when your foursome finishes the hole.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : null}

        {event && !showActiveRun && checkpointIsFinishOnly ? (
          <Card className="bg-white/95">
            <CardHeader>
              <CardTitle>No timer running</CardTitle>
              <CardDescription>
                Scan the first QR code at the tee before scanning this finish checkpoint.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : null}

        {event && !showActiveRun && !checkpointIsFinishOnly ? (
          <Card className="bg-white/95">
            <CardHeader>
              <CardTitle>Start hole timer</CardTitle>
              <CardDescription>Use the GGID your foursome received at tee-off.</CardDescription>
            </CardHeader>
            <CardContent>
              <form action={confirmPaceScan.bind(null, token)} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="groupGgid">Foursome GGID</Label>
                  <div className="flex items-center gap-2 rounded-2xl border border-input bg-background p-1 shadow-sm focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
                    <Input
                      id="groupGgid"
                      name="groupGgid"
                      autoCapitalize="characters"
                      autoComplete="off"
                      inputMode="text"
                      placeholder="Enter GGID"
                      required
                      className="h-12 flex-1 border-0 bg-transparent text-lg uppercase shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                    />
                    <Button type="submit" className="h-12 rounded-xl px-5 text-base">
                      Send
                    </Button>
                  </div>
                </div>
              </form>
            </CardContent>
          </Card>
        ) : null}

        {!checkpointIsFinishOnly ? (
          <Button asChild variant="outline" className="self-start rounded-full bg-white/80">
            <Link href="/leaderboard">View leaderboard</Link>
          </Button>
        ) : null}
      </div>
    </main>
  )
}
