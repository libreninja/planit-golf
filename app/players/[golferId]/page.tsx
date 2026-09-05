import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, ChevronRight } from 'lucide-react'
import { FollowControl } from '@/components/players/follow-control'
import { getMensPlayerDetail } from '@/lib/players/data'
import {
  playerDetailHref,
  playerPerformanceHref,
  safeInternalReturnTo,
  scoringFromPlayerSource,
} from '@/lib/players/links'
import {
  playerRoundPresentation,
  type PlayerResultFocus,
} from '@/lib/players/player-detail-presentation'
import type { PlayerDetailModel, PlayerRound } from '@/lib/players/player-detail'
import type { PlayerHolePerformance } from '@/lib/players/igc-mens-2026-hole-performance'

export const dynamic = 'force-dynamic'

function formatDate(value: string | null, includeYear = false): string {
  if (!value) return 'Date unavailable'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', ...(includeYear ? { year: 'numeric' as const } : {}), timeZone: 'UTC',
  }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`))
}

function formatToPar(value: number | null): string {
  if (value === null) return ''
  if (value === 0) return 'E'
  return value > 0 ? `+${value}` : String(value)
}

function formatPoints(value: number | null): string {
  if (value === null) return ''
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '')
}

function comparisonLabel(value: number): string {
  if (value === 0) return 'Matches season avg'
  return `${Math.abs(value).toFixed(1)} ${value < 0 ? 'lower' : 'higher'} than season avg`
}

function eventLabel(value: string): string {
  return value.replace(/^Points Season\s*-\s*/i, '')
}

function StateLabel({ round }: { round: PlayerRound }) {
  if (round.state === 'live') {
    return <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[11px] font-semibold text-white">LIVE · thru {round.holesCompleted}</span>
  }
  if (round.state === 'incomplete') {
    return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">Incomplete · {round.holesCompleted}</span>
  }
  if (round.state === 'participation') {
    return <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">Participation</span>
  }
  return <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">Final</span>
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
    <details className="group mt-3 border-t border-border pt-2.5">
      <summary className="cursor-pointer list-none text-sm font-semibold text-primary marker:hidden">
        <span className="inline-flex items-center gap-0.5">Scorecard <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" aria-hidden /></span>
      </summary>
      <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1" aria-label="Hole-by-hole scorecard">
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

function SelectedRound({ round, resultFocus, grossVsSeasonAverage, isSeasonLow }: {
  round: PlayerRound | null
  resultFocus: PlayerResultFocus | null
  grossVsSeasonAverage: number | null
  isSeasonLow: boolean
}) {
  if (!round) {
    return (
      <section className="border-y border-border py-4">
        <p className="text-sm text-muted-foreground">No supported 2026 Men&apos;s League result is available for this golfer.</p>
      </section>
    )
  }

  const selected = playerRoundPresentation(round, resultFocus)
  const position = selected.result?.positionLabel?.trim() ?? ''
  const points = selected.result?.points ?? null
  const meaning = selected.competition === 'gross'
    ? [isSeasonLow ? 'Season best' : null, grossVsSeasonAverage !== null ? comparisonLabel(grossVsSeasonAverage) : null].filter(Boolean)
    : []

  return (
    <section className="border-y border-border py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-xl font-semibold">{eventLabel(round.eventName)}</h2>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {formatDate(round.eventDate)}{round.flight ? ` · ${round.flight}` : ''}
          </p>
        </div>
        <StateLabel round={round} />
      </div>

      {round.format === 'team' && selected.total === null ? (
        <p className="mt-3 text-sm text-muted-foreground">Team-format appearance · no authoritative individual score</p>
      ) : selected.total !== null || selected.toPar !== null ? (
        <>
          <div className="mt-3 flex items-end gap-2">
            <span className="font-display text-4xl leading-none tabular-nums">{selected.total}</span>
            {selected.toPar !== null ? <span className="pb-0.5 text-lg font-semibold tabular-nums text-muted-foreground">{formatToPar(selected.toPar)}</span> : null}
            <span className="pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{selected.competition}</span>
          </div>
          {position || points !== null ? (
            <p className="mt-1.5 text-sm font-medium">
              {position ? <><strong>{position}</strong> {selected.competition === 'gross' ? 'Gross' : 'Net'}</> : null}
              {position && points !== null ? <span className="text-muted-foreground"> · </span> : null}
              {points !== null ? <>{formatPoints(points)} pts</> : null}
            </p>
          ) : null}
          {meaning.length ? <p className="mt-1 text-sm font-semibold text-primary">{meaning.join(' · ')}</p> : null}
          <ScorecardEvidence round={round} />
        </>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">No authoritative individual {selected.competition} score</p>
      )}
    </section>
  )
}

function RecentForm({ model }: { model: PlayerDetailModel }) {
  const form = model.form
  return (
    <section className="min-w-0">
      <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Recent form</h2>
      {form.recentGross.length ? (
        <>
          <div className="mt-2 grid grid-cols-5 gap-1" aria-label="Recent completed gross scores">
            {form.recentGross.map((round) => (
              <div key={round.week} className="min-w-0 text-center">
                <div className="text-2xl font-semibold leading-none tabular-nums">{round.gross}</div>
                <div className="mt-1 truncate text-[10px] uppercase tracking-wide text-muted-foreground">{round.eventDate ? formatDate(round.eventDate) : `#${round.week}`}</div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs tabular-nums text-muted-foreground">
            <strong className="text-foreground">{form.recentAverageGross?.toFixed(1)}</strong> last {form.recentGross.length}
            {form.seasonAverageGross !== null ? <> · <strong className="text-foreground">{form.seasonAverageGross.toFixed(1)}</strong> season</> : null}
            {form.seasonLowGross !== null ? <> · <strong className="text-foreground">{form.seasonLowGross}</strong> low</> : null}
          </p>
        </>
      ) : <p className="mt-2 text-sm text-muted-foreground">No completed comparable rounds yet.</p>}
    </section>
  )
}

function InterbayPerformanceEntry({ golferId, returnTo, performance }: {
  golferId: string
  returnTo: string
  performance: PlayerHolePerformance
}) {
  return (
    <Link href={playerPerformanceHref({ golferId, returnTo })} className="flex items-center justify-between gap-3 border-y border-border py-3 text-sm hover:bg-muted/25">
      <span><strong>Performance at Interbay</strong> <span className="text-muted-foreground">· {performance.comparableRounds} rounds</span></span>
      <ChevronRight className="h-4 w-4 shrink-0 text-primary" aria-hidden />
    </Link>
  )
}

export default async function PlayerDetailPage({ params, searchParams }: {
  params: Promise<{ golferId: string }>
  searchParams: Promise<{ week?: string; from?: string; all?: string; intent?: string; scoring?: string }>
}) {
  const [{ golferId }, query] = await Promise.all([params, searchParams])
  const parsedWeek = query.week ? Number(query.week) : null
  const selectedWeek = parsedWeek !== null && Number.isInteger(parsedWeek) ? parsedWeek : null
  const data = await getMensPlayerDetail(golferId, selectedWeek)
  if (!data) notFound()

  const returnTo = safeInternalReturnTo(query.from) ?? '/igc/mens-league?view=weekly'
  const resultFocus = scoringFromPlayerSource(query.scoring, query.from)
  const visibleRounds = query.all === '1' ? data.model.rounds : data.model.rounds.slice(0, 5)
  const playerReturnTo = playerDetailHref({ golferId, week: query.week, scoring: resultFocus, returnTo, allRounds: query.all === '1' })

  return (
    <article className="mx-auto max-w-2xl space-y-5 sm:space-y-6">
      <Link href={returnTo} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Back to leaderboard
      </Link>

      <header className="flex min-w-0 items-center gap-1">
        <h1 title={data.displayName} className="min-w-0 truncate whitespace-nowrap text-[clamp(1.5rem,7vw,2rem)] font-semibold leading-none">{data.displayName}</h1>
        <FollowControl
          golferId={data.golferId}
          signedIn={data.viewer.signedIn}
          isSelf={data.viewer.isSelf}
          initialFollowing={data.viewer.isFollowing}
          followIntent={query.intent === 'follow'}
        />
      </header>

      <SelectedRound
        round={data.model.selectedRound}
        resultFocus={resultFocus}
        grossVsSeasonAverage={data.model.selectedRoundComparison.grossVsSeasonAverage}
        isSeasonLow={data.model.selectedRoundComparison.isSeasonLow}
      />

      <RecentForm model={data.model} />

      {data.holePerformance ? <InterbayPerformanceEntry golferId={golferId} returnTo={playerReturnTo} performance={data.holePerformance} /> : null}

      <section className="flex items-center justify-between gap-3 text-sm">
        <p className="tabular-nums">
          <strong>{data.model.season.rank ? `#${data.model.season.rank}` : 'Unranked'}</strong>{data.model.season.rank ? ' rank' : ''}
          {data.model.season.points !== null ? <> <span className="text-muted-foreground">·</span> <strong>{formatPoints(data.model.season.points)}</strong> points</> : null}
        </p>
        <Link href="/igc/mens-league?view=season" className="shrink-0 font-semibold text-primary hover:underline">Full standings <ChevronRight className="inline h-3.5 w-3.5" aria-hidden /></Link>
      </section>

      <section className="border-t border-border pt-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">Recent rounds</h2>
          {data.model.rounds.length > 5 ? (
            <Link className="text-xs font-semibold text-primary hover:underline" href={playerDetailHref({ golferId, week: query.week, scoring: resultFocus, returnTo, allRounds: query.all !== '1' })}>
              {query.all === '1' ? 'Recent only' : `All ${data.model.rounds.length}`}
            </Link>
          ) : null}
        </div>
        <div className="mt-2 divide-y divide-border border-y border-border">
          {visibleRounds.map((round) => {
            const shown = playerRoundPresentation(round, resultFocus)
            const position = shown.result?.positionLabel?.trim()
            return (
              <Link
                key={round.week}
                href={playerDetailHref({ golferId, week: String(round.week), scoring: shown.competition, returnTo, allRounds: query.all === '1' })}
                aria-current={round.week === data.model.selectedRound?.week ? 'true' : undefined}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-1 py-2 text-sm hover:bg-muted/35"
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{eventLabel(round.eventName)}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{formatDate(round.eventDate, true)} · {round.state === 'final' ? 'Final' : round.state}</span>
                </span>
                <span className="text-right tabular-nums">
                  {shown.total !== null ? <span className="font-semibold">{shown.competition === 'gross' ? 'G' : 'N'} {shown.total}</span> : null}
                  {position ? <span className="ml-2 text-xs text-muted-foreground">{position}</span> : null}
                </span>
              </Link>
            )
          })}
          {visibleRounds.length === 0 ? <p className="px-1 py-3 text-sm text-muted-foreground">No supported rounds.</p> : null}
        </div>
      </section>
    </article>
  )
}
