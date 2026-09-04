import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getMensPlayerDetail } from '@/lib/players/data'
import { playerDetailHref, safeInternalReturnTo } from '@/lib/players/links'
import type { PlayerHoleComparison } from '@/lib/players/igc-mens-2026-hole-performance'

export const dynamic = 'force-dynamic'

function formatAverage(value: number): string {
  return value.toFixed(2)
}

function formatMagnitude(value: number): string {
  return Math.abs(value).toFixed(2)
}

function formatSigned(value: number, digits = 2): string {
  if (Math.abs(value) < 0.005) return (0).toFixed(digits)
  return `${value > 0 ? '+' : '−'}${Math.abs(value).toFixed(digits)}`
}

function firstName(displayName: string): string {
  return displayName.split(',')[1]?.trim().split(' ')[0] ?? displayName.split(' ')[0]
}

function RelativeHole({ hole }: { hole: PlayerHoleComparison }) {
  const better = hole.differentialPerPlay < 0
  return (
    <div className="grid grid-cols-[2.75rem_1fr_auto] items-center gap-3 border-t border-border py-3 first:border-t-0">
      <div className="font-display text-2xl tabular-nums">#{hole.hole}</div>
      <div>
        <div className="text-sm tabular-nums"><strong>{formatAverage(hole.playerAverage)}</strong> player avg</div>
        <div className="text-xs tabular-nums text-muted-foreground">{formatAverage(hole.leagueAverage)} league avg</div>
      </div>
      <div className={`text-right text-sm font-semibold tabular-nums ${better ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}>
        <div>{formatMagnitude(hole.differentialPerPlay)} {better ? 'better' : 'worse'}</div>
        <div className="text-[11px] font-medium text-muted-foreground">per play</div>
      </div>
    </div>
  )
}

function RelativeGroup({ title, holes, empty }: { title: string; holes: PlayerHoleComparison[]; empty: string }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{title}</h3>
      <div className="mt-2">
        {holes.length ? holes.map((hole) => <RelativeHole key={hole.hole} hole={hole} />) : (
          <p className="border-t border-border py-3 text-sm text-muted-foreground">{empty}</p>
        )}
      </div>
    </div>
  )
}

export default async function PlayerPerformancePage({
  params,
  searchParams,
}: {
  params: Promise<{ golferId: string }>
  searchParams: Promise<{ from?: string }>
}) {
  const [{ golferId }, query] = await Promise.all([params, searchParams])
  const data = await getMensPlayerDetail(golferId, null)
  if (!data) notFound()

  const returnTo = safeInternalReturnTo(query.from) ?? playerDetailHref({ golferId })
  const performance = data.holePerformance
  const name = firstName(data.displayName)
  const hasBelowFieldHole = performance?.bestRelativeHoles.some((hole) => hole.differentialPerPlay < 0) ?? false

  return (
    <article className="mx-auto max-w-2xl space-y-8">
      <Link href={returnTo} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Back to player
      </Link>

      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">IGC Men&apos;s League · 2026 Planit coverage</p>
        <h1 className="mt-2 text-4xl font-semibold leading-tight sm:text-5xl">{data.displayName}</h1>
        <p className="mt-2 text-lg text-muted-foreground">Performance at Interbay</p>
      </header>

      {performance ? (
        <>
          <section className="border-y border-border py-6">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Performance vs league</p>
            <h2 className="mt-1 text-2xl font-semibold">How {name} plays these nine holes</h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
              {performance.roundsCompared} completed {performance.roundsCompared === 1 ? 'start' : 'starts'} compared with the other completed field cards from those same league weeks.
            </p>

            <div className="mt-6 grid gap-7 sm:grid-cols-2 sm:gap-8">
              <RelativeGroup
                title={hasBelowFieldHole ? 'Best vs field' : 'Closest to field'}
                holes={performance.bestRelativeHoles}
                empty="No comparable hole data yet."
              />
              <RelativeGroup
                title="Gives back most"
                holes={performance.givesBackMostHoles}
                empty="No hole is above the matched league average yet."
              />
            </div>
          </section>

          <section>
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">All 9 holes</p>
                <h2 className="mt-1 text-2xl font-semibold">Player vs league average</h2>
              </div>
              <p className="text-xs text-muted-foreground">Gross scoring · lower is better</p>
            </div>

            <div className="mt-4 border-y border-border">
              <div className="grid grid-cols-[3.7rem_1fr_1fr_1fr] gap-2 border-b border-border px-1 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:grid-cols-[5rem_1fr_1fr_1fr]">
                <span>Hole</span>
                <span className="text-right">Player</span>
                <span className="text-right">League</span>
                <span className="text-right">Vs league</span>
              </div>
              {performance.holes.map((hole) => {
                const better = hole.differentialPerPlay < 0
                const even = Math.abs(hole.differentialPerPlay) < 0.005
                return (
                  <div key={hole.hole} className="border-b border-border px-1 py-3 last:border-b-0">
                    <div className="grid grid-cols-[3.7rem_1fr_1fr_1fr] items-baseline gap-2 sm:grid-cols-[5rem_1fr_1fr_1fr]">
                      <span className="font-semibold tabular-nums">#{hole.hole} <span className="text-[10px] font-normal text-muted-foreground">par {hole.par}</span></span>
                      <span className="text-right font-semibold tabular-nums">{formatAverage(hole.playerAverage)}</span>
                      <span className="text-right tabular-nums text-muted-foreground">{formatAverage(hole.leagueAverage)}</span>
                      <span className={`text-right font-semibold tabular-nums ${even ? '' : better ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}>
                        {formatSigned(hole.differentialPerPlay)}
                      </span>
                    </div>
                    <div className="mt-1 text-right text-[11px] tabular-nums text-muted-foreground">
                      {hole.timesPlayed} plays · {formatSigned(hole.cumulativeDifferential, 1)} cumulative vs field
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          <section className="border-t border-border pt-5 text-xs leading-relaxed text-muted-foreground">
            <p className="font-semibold text-foreground">How this comparison works</p>
            <p className="mt-1">
              Each completed individual gross score is compared hole-by-hole with the average of the other completed cards in that same audited 2026 Points Season occurrence. The league value above is the average of those matched weekly field benchmarks. Negative is better than the field; positive is worse.
            </p>
            <p className="mt-2">
              {performance.comparisonCards.toLocaleString('en-US')} peer scorecards contribute across {performance.roundsCompared} matched {performance.roundsCompared === 1 ? 'week' : 'weeks'}. Only the verified Interbay Back 2023 Men, Hole 1 start contract is included.
            </p>
          </section>
        </>
      ) : (
        <section className="border-y border-border py-6">
          <p className="text-sm text-muted-foreground">No completed rounds satisfy the verified 2026 Interbay comparison contract for this golfer.</p>
        </section>
      )}
    </article>
  )
}
