import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, ChevronRight } from 'lucide-react'
import { FollowControl } from '@/components/players/follow-control'
import { Button } from '@/components/ui/button'
import { getMensPlayerDetail } from '@/lib/players/data'
import { playerDetailHref, playerPerformanceHref, safeInternalReturnTo } from '@/lib/players/links'
import type { PlayerRound } from '@/lib/players/player-detail'

export const dynamic = 'force-dynamic'

function formatDate(value: string | null): string {
  if (!value) return 'Date unavailable'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`))
}

function formatSnapshotDate(value: string | null): string | null {
  if (!value) return null
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(value))
}

function formatToPar(value: number | null): string {
  if (value === null) return '—'
  if (value === 0) return 'E'
  return value > 0 ? `+${value}` : String(value)
}

function formatPoints(value: number | null): string {
  if (value === null) return '—'
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '')
}

function formatAverage(value: number): string {
  return value.toFixed(1)
}

function comparisonLabel(value: number): string {
  if (value === 0) return 'Matches season average'
  return `${formatAverage(Math.abs(value))} strokes ${value < 0 ? 'lower' : 'higher'} than season average`
}

function eventLabel(value: string): string {
  return value.replace(/^Points Season\s*-\s*/i, '')
}

function StateLabel({ round }: { round: PlayerRound }) {
  if (round.state === 'live') {
    return <span className="rounded-full bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white">LIVE · thru {round.holesCompleted}</span>
  }
  if (round.state === 'incomplete') {
    return <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900">Incomplete · {round.holesCompleted} holes</span>
  }
  if (round.state === 'participation') {
    return <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">Participation</span>
  }
  return <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">Final</span>
}

function ScoreFact({ label, total, toPar, marker }: { label: string; total: number | null; toPar: number | null; marker?: string }) {
  if (total === null && toPar === null) return null
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="font-display text-4xl tabular-nums">{total ?? '—'}</span>
        <span className="text-lg font-semibold tabular-nums text-muted-foreground">{formatToPar(toPar)}</span>
      </div>
      {marker ? <div className="mt-1 text-xs font-semibold text-primary">{marker}</div> : null}
    </div>
  )
}

function ScorecardEvidence({ round }: { round: PlayerRound }) {
  const holes = Math.min(9, Math.max(
    round.grossScores.length,
    round.netScores.length,
    round.toParGross.length,
    round.holesCompleted,
  ))
  if (holes === 0) return null
  return (
    <details className="group border-t border-border pt-3">
      <summary className="cursor-pointer list-none text-sm font-semibold text-primary marker:hidden">
        <span className="inline-flex items-center gap-1">Scorecard <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" aria-hidden /></span>
      </summary>
      <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1" aria-label="Hole-by-hole scorecard">
        {Array.from({ length: holes }, (_, index) => {
          const gross = round.grossScores[index] ?? null
          const net = round.netScores[index] ?? null
          const grossToPar = round.toParGross[index] ?? null
          const par = gross !== null && grossToPar !== null ? gross - grossToPar : null
          return (
            <div key={index} className="min-w-[3.5rem] shrink-0 rounded-md border bg-background px-1.5 py-1.5 text-center text-[11px]">
              <div className="font-semibold text-muted-foreground">{index + 1}</div>
              <div className="text-muted-foreground">par {par ?? '—'}</div>
              <div className="mt-1 font-semibold tabular-nums">G {gross ?? '—'}</div>
              <div className="tabular-nums text-muted-foreground">N {net ?? '—'}</div>
            </div>
          )
        })}
      </div>
    </details>
  )
}

function SelectedResult({
  round,
  seasonAverageGross,
  grossVsSeasonAverage,
  isSeasonLow,
}: {
  round: PlayerRound | null
  seasonAverageGross: number | null
  grossVsSeasonAverage: number | null
  isSeasonLow: boolean
}) {
  if (!round) {
    return (
      <section className="border-y border-border py-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Selected result</p>
        <p className="mt-3 text-sm text-muted-foreground">No supported 2026 Men&apos;s League result is available for this golfer.</p>
      </section>
    )
  }

  return (
    <section className="border-y border-border py-5 sm:py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Selected result</p>
          <h2 className="mt-1 text-2xl font-semibold">{eventLabel(round.eventName)}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{formatDate(round.eventDate)}{round.flight ? ` · ${round.flight}` : ''}</p>
        </div>
        <StateLabel round={round} />
      </div>

      {round.format === 'team' && round.grossTotal === null ? (
        <div className="mt-5 rounded-md bg-muted/45 p-4 text-sm">
          This was a team-format appearance. No authoritative individual score is available, so no individual performance is inferred.
        </div>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-2 gap-6 sm:max-w-md">
            <ScoreFact label="Gross" total={round.grossTotal} toPar={round.toParGrossTotal} marker={isSeasonLow ? 'Season best' : undefined} />
            <ScoreFact label="Net" total={round.netTotal} toPar={round.toParNetTotal} />
          </div>
          {grossVsSeasonAverage !== null && seasonAverageGross !== null ? (
            <p className="mt-4 text-sm">
              <strong>{comparisonLabel(grossVsSeasonAverage)}</strong>
              <span className="text-muted-foreground"> ({formatAverage(seasonAverageGross)})</span>
            </p>
          ) : null}
          <div className="mt-5 grid gap-2 text-sm sm:grid-cols-2">
            {round.grossResult ? (
              <div><span className="text-muted-foreground">Gross finish</span> <strong>{round.grossResult.positionLabel ?? '—'}</strong>{round.grossResult.points !== null ? ` · ${formatPoints(round.grossResult.points)} pts` : ''}</div>
            ) : null}
            {round.netResult ? (
              <div><span className="text-muted-foreground">Net finish</span> <strong>{round.netResult.positionLabel ?? '—'}</strong>{round.netResult.points !== null ? ` · ${formatPoints(round.netResult.points)} pts` : ''}</div>
            ) : null}
          </div>
          {round.state !== 'final' ? (
            <p className="mt-4 text-xs text-muted-foreground">Partial rounds are shown as evidence here but excluded from completed-round comparisons.</p>
          ) : null}
          <div className="mt-5"><ScorecardEvidence round={round} /></div>
        </>
      )}
    </section>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  )
}

export default async function PlayerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ golferId: string }>
  searchParams: Promise<{ week?: string; from?: string; all?: string; intent?: string }>
}) {
  const [{ golferId }, query] = await Promise.all([params, searchParams])
  const parsedWeek = query.week ? Number(query.week) : null
  const selectedWeek = parsedWeek !== null && Number.isInteger(parsedWeek) ? parsedWeek : null
  const data = await getMensPlayerDetail(golferId, selectedWeek)
  if (!data) notFound()

  const returnTo = safeInternalReturnTo(query.from) ?? '/igc/mens-league?view=weekly'
  const visibleRounds = query.all === '1' ? data.model.rounds : data.model.rounds.slice(0, 5)
  const handicapDate = formatSnapshotDate(data.handicapSnapshot?.asOf ?? null)
  const playerReturnTo = playerDetailHref({ golferId, week: query.week, returnTo, allRounds: query.all === '1' })

  return (
    <article className="mx-auto max-w-2xl space-y-8">
      <Link href={returnTo} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Back to leaderboard
      </Link>

      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">IGC Men&apos;s League · 2026 Planit coverage</p>
          <h1 className="mt-2 text-4xl font-semibold leading-tight sm:text-5xl">{data.displayName}</h1>
          {data.handicapSnapshot ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Handicap Index snapshot <span className="font-semibold text-foreground">{data.handicapSnapshot.value}</span>{handicapDate ? ` · as of ${handicapDate}` : ''}
            </p>
          ) : null}
        </div>
        <FollowControl
          golferId={data.golferId}
          signedIn={data.viewer.signedIn}
          isSelf={data.viewer.isSelf}
          initialFollowing={data.viewer.isFollowing}
          followIntent={query.intent === 'follow'}
        />
      </header>

      <SelectedResult
        round={data.model.selectedRound}
        seasonAverageGross={data.model.form.seasonAverageGross}
        grossVsSeasonAverage={data.model.selectedRoundComparison.grossVsSeasonAverage}
        isSeasonLow={data.model.selectedRoundComparison.isSeasonLow}
      />

      <section className="min-w-0">
        <div className="flex flex-col items-start gap-1 sm:flex-row sm:items-end sm:justify-between sm:gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Current form</p>
            <h2 className="mt-1 text-2xl font-semibold">How {data.displayName.split(',')[1]?.trim().split(' ')[0] ?? data.displayName.split(' ')[0]} has been playing</h2>
          </div>
          <p className="text-xs text-muted-foreground">Completed 9-hole individual rounds</p>
        </div>
        {data.model.form.recentGross.length ? (
          <>
            <div className="mt-5 grid grid-cols-2 gap-5 border-y border-border py-4">
              <Metric label={`Recent ${data.model.form.recentGross.length} average`} value={data.model.form.recentAverageGross?.toFixed(1) ?? '—'} />
              <Metric label="Season average" value={data.model.form.seasonAverageGross?.toFixed(1) ?? '—'} />
            </div>
            {data.model.form.recentVsSeasonAverage !== null ? (
              <p className="mt-3 text-sm font-medium">{comparisonLabel(data.model.form.recentVsSeasonAverage)}</p>
            ) : null}
            <div className="mt-5 flex gap-2 overflow-x-auto pb-1" aria-label="Recent completed gross scores">
              {data.model.form.recentGross.map((round) => (
                <div key={round.week} className="min-w-[4.5rem] rounded-md border bg-card px-2 py-2 text-center">
                  <div className="text-2xl font-semibold tabular-nums">{round.gross}</div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{round.eventDate ? formatDate(round.eventDate).replace(/, 2026$/, '') : `#${round.week}`}</div>
                </div>
              ))}
            </div>
            {data.model.form.seasonLowRound ? (
              <p className="mt-4 text-sm">
                <span className="text-muted-foreground">Season best</span>{' '}
                <strong className="tabular-nums">{data.model.form.seasonLowRound.gross}</strong>
                {data.model.form.seasonLowRound.eventDate ? ` · ${formatDate(data.model.form.seasonLowRound.eventDate)}` : ''}
              </p>
            ) : null}
          </>
        ) : <p className="mt-4 text-sm text-muted-foreground">No completed comparable rounds yet.</p>}
        <Button asChild variant="outline" className="mt-5">
          <Link href={playerPerformanceHref({ golferId, returnTo: playerReturnTo })}>
            See performance <ChevronRight className="ml-1 h-4 w-4" aria-hidden />
          </Link>
        </Button>
      </section>

      <section className="flex flex-wrap items-center justify-between gap-3 border-y border-border py-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">2026 season context</p>
          <p className="mt-1 text-sm">
            <strong className="tabular-nums">{data.model.season.rank ? `#${data.model.season.rank}` : '—'}</strong> rank
            <span className="mx-2 text-muted-foreground">·</span>
            <strong className="tabular-nums">{formatPoints(data.model.season.points)}</strong> points
          </p>
        </div>
        <Link href="/igc/mens-league?view=season" className="text-sm font-semibold text-primary hover:underline">Full standings</Link>
      </section>

      <section className="border-t border-border pt-6">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Evidence</p>
            <h2 className="mt-1 text-2xl font-semibold">Recent rounds</h2>
          </div>
          {data.model.rounds.length > 5 ? (
            <Button asChild variant="ghost" size="sm">
              <Link href={playerDetailHref({ golferId, week: query.week, returnTo, allRounds: query.all !== '1' })}>
                {query.all === '1' ? 'Recent only' : `All ${data.model.rounds.length}`}
              </Link>
            </Button>
          ) : null}
        </div>
        <div className="mt-3 divide-y divide-border border-y border-border">
          {visibleRounds.map((round) => (
            <Link
              key={round.week}
              href={playerDetailHref({ golferId, week: String(round.week), returnTo, allRounds: query.all === '1' })}
              aria-current={round.week === data.model.selectedRound?.week ? 'true' : undefined}
              className="grid grid-cols-[1fr_auto] items-center gap-3 px-1 py-3 text-sm hover:bg-muted/35"
            >
              <span>
                <span className="font-semibold">{eventLabel(round.eventName)}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{formatDate(round.eventDate)} · {round.state === 'final' ? 'Final' : round.state}</span>
              </span>
              <span className="text-right tabular-nums">
                <span className="font-semibold">G {round.grossTotal ?? '—'}</span>
                <span className="ml-3 text-muted-foreground">N {round.netTotal ?? '—'}</span>
              </span>
            </Link>
          ))}
          {visibleRounds.length === 0 ? <p className="px-1 py-4 text-sm text-muted-foreground">No supported rounds.</p> : null}
        </div>
      </section>
    </article>
  )
}
