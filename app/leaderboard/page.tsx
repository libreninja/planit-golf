import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  formatDateLabel,
  formatElapsedMinutes,
  formatTimeLabel,
  getLeaderboardRows,
} from '@/lib/public-pace'

export default async function LeaderboardPage() {
  const rows = await getLeaderboardRows()

  return (
    <main className="min-h-screen px-4 py-6 sm:py-10">
      <div className="mx-auto w-full max-w-4xl">
        <section className="overflow-hidden rounded-[2rem] border border-emerald-900/10 bg-emerald-950 text-primary-foreground shadow-xl">
          <div className="bg-[radial-gradient(circle_at_top_left,rgba(250,220,130,0.38),transparent_28rem)] p-6 sm:p-9">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-100/80">public pace board</p>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-6xl">Fastest foursomes</h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-emerald-50/75 sm:text-base">
              Rankings use the official clubhouse tee-off time and the QR checkpoint scan timestamp.
            </p>
          </div>
        </section>

        <div className="mt-5 grid gap-3">
          {rows.length === 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>No scans yet</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                The leaderboard will populate after the first foursome records a public checkpoint scan.
              </CardContent>
            </Card>
          ) : null}

          {rows.map((row, index) => (
            <Card key={row.id} className="bg-white/90">
              <CardContent className="grid gap-4 p-5 sm:grid-cols-[4rem_1fr_auto] sm:items-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-xl font-bold text-primary-foreground">
                  {index + 1}
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                    {row.checkpointLabel} · {formatDateLabel(row.eventDate)}
                  </p>
                  <h2 className="mt-1 text-2xl font-semibold">
                    {row.playerNames.length > 0 ? row.playerNames.join(' / ') : `Tee time ${row.teeTime}`}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Start {formatTimeLabel(row.actualStartAt)} · Scan {formatTimeLabel(row.scannedAt)}
                  </p>
                </div>
                <div className="rounded-2xl bg-accent px-4 py-3 text-center text-accent-foreground">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em]">Elapsed</p>
                  <p className="text-2xl font-bold">{formatElapsedMinutes(row.elapsedMinutes)}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Button asChild variant="outline" className="mt-5 rounded-full bg-white/80">
          <Link href="/">Member sign in</Link>
        </Button>
      </div>
    </main>
  )
}
