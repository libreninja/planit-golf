import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getMensPlayerDetail } from '@/lib/players/data'
import { playerDetailHref, playerPerformanceHref, safeInternalReturnTo } from '@/lib/players/links'
import {
  resolvePlayerPerformanceComparator,
  type PlayerHoleComparison,
  type PlayerPerformanceComparator,
} from '@/lib/players/igc-mens-2026-hole-performance'

export const dynamic = 'force-dynamic'

function formatAverage(value: number): string {
  return value.toFixed(2)
}

function formatSigned(value: number, digits = 2): string {
  if (Math.abs(value) < 0.005) return (0).toFixed(digits)
  return `${value > 0 ? '+' : '−'}${Math.abs(value).toFixed(digits)}`
}

function firstName(displayName: string): string {
  return displayName.split(',')[1]?.trim().split(' ')[0] ?? displayName.split(' ')[0]
}

function SummaryGroup({
  title,
  holes,
  comparator,
}: {
  title: string
  holes: PlayerHoleComparison[]
  comparator: PlayerPerformanceComparator
}) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{title}</h3>
      <div className="mt-1">
        {holes.map((hole) => (
          <div key={hole.hole} className="flex items-baseline justify-between gap-2 border-t border-border py-2 first:border-t-0">
            <span className="font-display text-xl tabular-nums">#{hole.hole}</span>
            <span className="text-xs font-semibold tabular-nums">
              {formatSigned(hole.differentialPerPlay)} <span className="font-normal text-muted-foreground">vs {comparator}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ComparatorControl({
  golferId,
  returnTo,
  active,
  flightAvailable,
  fieldAvailable,
}: {
  golferId: string
  returnTo: string
  active: PlayerPerformanceComparator
  flightAvailable: boolean
  fieldAvailable: boolean
}) {
  const optionClass = (selected: boolean, available: boolean) => [
    'flex-1 rounded-md px-3 py-1.5 text-center text-sm font-semibold transition-colors',
    selected ? 'bg-background text-foreground shadow-sm' : available ? 'text-muted-foreground hover:text-foreground' : 'cursor-not-allowed text-muted-foreground/50',
  ].join(' ')

  return (
    <nav aria-label="Performance comparator" className="flex rounded-lg bg-muted p-1">
      {flightAvailable ? (
        <Link
          href={playerPerformanceHref({ golferId, returnTo, compare: 'flight' })}
          aria-current={active === 'flight' ? 'page' : undefined}
          className={optionClass(active === 'flight', true)}
        >
          Vs Flight
        </Link>
      ) : (
        <span aria-disabled="true" className={optionClass(false, false)}>Vs Flight</span>
      )}
      {fieldAvailable ? (
        <Link
          href={playerPerformanceHref({ golferId, returnTo, compare: 'field' })}
          aria-current={active === 'field' ? 'page' : undefined}
          className={optionClass(active === 'field', true)}
        >
          Vs Field
        </Link>
      ) : (
        <span aria-disabled="true" className={optionClass(false, false)}>Vs Field</span>
      )}
    </nav>
  )
}

export default async function PlayerPerformancePage({
  params,
  searchParams,
}: {
  params: Promise<{ golferId: string }>
  searchParams: Promise<{ from?: string; compare?: string }>
}) {
  const [{ golferId }, query] = await Promise.all([params, searchParams])
  const data = await getMensPlayerDetail(golferId, null)
  if (!data) notFound()

  const returnTo = safeInternalReturnTo(query.from) ?? playerDetailHref({ golferId })
  const requested: PlayerPerformanceComparator | null = query.compare === 'flight' || query.compare === 'field'
    ? query.compare
    : null
  const performance = data.holePerformance
  const resolved = performance ? resolvePlayerPerformanceComparator(performance, requested) : null
  const name = firstName(data.displayName)
  const comparatorLabel = resolved?.comparator === 'flight' ? 'Flight' : 'Field'

  return (
    <article className="mx-auto max-w-2xl space-y-5 sm:space-y-6">
      <Link href={returnTo} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Back to player
      </Link>

      <header className="min-w-0">
        <h1 title={data.displayName} className="truncate whitespace-nowrap text-[clamp(1.5rem,7vw,2rem)] font-semibold leading-none">{data.displayName}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Interbay performance</p>
      </header>

      {performance && resolved ? (
        <>
          <section>
            <ComparatorControl
              golferId={golferId}
              returnTo={returnTo}
              active={resolved.comparator}
              flightAvailable={!!performance.flight}
              fieldAvailable={!!performance.field}
            />

            {!performance.flight && performance.field ? (
              <p className="mt-2 text-xs text-muted-foreground">Official flight comparison unavailable · showing Vs Field</p>
            ) : null}
            <p className="mt-2 text-xs text-muted-foreground">
              {resolved.lens.roundsCompared} {resolved.lens.roundsCompared === 1 ? 'round' : 'rounds'} · {resolved.lens.comparisonCards.toLocaleString('en-US')} peer {resolved.lens.comparisonCards === 1 ? 'card' : 'cards'}
            </p>

            <div className="mt-4 grid grid-cols-2 gap-5 sm:gap-8">
              <SummaryGroup title="Relative strengths" holes={resolved.lens.relativeStrengths} comparator={resolved.comparator} />
              <SummaryGroup title="Largest gaps" holes={resolved.lens.largestGaps} comparator={resolved.comparator} />
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">All 9 holes</h2>
              <p className="text-[11px] text-muted-foreground">Gross vs {resolved.comparator}</p>
            </div>

            <div className="mt-2 border-y border-border">
              <div className="grid grid-cols-[3.7rem_1fr_1fr_1fr] gap-2 border-b border-border px-1 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:grid-cols-[5rem_1fr_1fr_1fr]">
                <span>Hole</span>
                <span className="text-right">Player</span>
                <span className="text-right">{comparatorLabel}</span>
                <span className="text-right">Vs {resolved.comparator}</span>
              </div>
              {resolved.lens.holes.map((hole) => (
                <div key={hole.hole} className="border-b border-border px-1 py-2 last:border-b-0">
                  <div className="grid grid-cols-[3.7rem_1fr_1fr_1fr] items-baseline gap-2 sm:grid-cols-[5rem_1fr_1fr_1fr]">
                    <span className="font-semibold tabular-nums">#{hole.hole} <span className="text-[10px] font-normal text-muted-foreground">par {hole.par}</span></span>
                    <span className="text-right font-semibold tabular-nums">{formatAverage(hole.playerAverage)}</span>
                    <span className="text-right tabular-nums text-muted-foreground">{formatAverage(hole.comparatorAverage)}</span>
                    <span className="text-right font-semibold tabular-nums">{formatSigned(hole.differentialPerPlay)}</span>
                  </div>
                  <div className="mt-0.5 text-right text-[10px] tabular-nums text-muted-foreground">
                    {hole.timesPlayed} plays · {formatSigned(hole.cumulativeDifferential, 1)} total vs {resolved.comparator}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <details className="border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
            <summary className="cursor-pointer font-semibold text-foreground">Methodology &amp; sample</summary>
            <div className="mt-2">
              <p>Negative means lower gross scoring than the comparator; positive means higher.</p>
              {resolved.comparator === 'flight' ? (
                <p className="mt-2">
                  For each eligible start, {name}&apos;s official flight is selected independently from that occurrence&apos;s final gross and net result rows. Those memberships must agree. The comparison uses completed individual gross hole scores from other golfers in that same official flight and occurrence; missing, ambiguous, projected, or conflicting flight evidence is excluded.
                </p>
              ) : (
                <p className="mt-2">
                  Each completed individual gross score is compared hole-by-hole with the average of the other completed field cards in that same audited 2026 Points Season occurrence. The Field value is the average of those matched weekly benchmarks.
                </p>
              )}
              <p className="mt-2">Only the verified Interbay Back 2023 Men, Hole 1 start contract is included. This is an occurrence-matched gross scoring differential.</p>
            </div>
          </details>
        </>
      ) : (
        <section className="border-y border-border py-6">
          <p className="text-sm text-muted-foreground">No completed rounds satisfy the verified 2026 Interbay comparison contract for this golfer.</p>
        </section>
      )}
    </article>
  )
}
