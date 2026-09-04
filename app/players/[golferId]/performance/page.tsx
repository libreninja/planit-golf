import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getMensPlayerDetail } from '@/lib/players/data'
import { playerDetailHref, safeInternalReturnTo } from '@/lib/players/links'
import type { ScoringDistribution } from '@/lib/players/player-detail'

export const dynamic = 'force-dynamic'

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  )
}

function Distribution({ distribution }: { distribution: ScoringDistribution }) {
  const rows = [
    ['Birdie or better', distribution.birdieOrBetter],
    ['Par', distribution.par],
    ['Bogey', distribution.bogey],
    ['Double or worse', distribution.doubleOrWorse],
  ] as const

  return (
    <div className="space-y-2.5">
      {rows.map(([label, count]) => {
        const percent = Math.round((count / distribution.totalHoles) * 100)
        return (
          <div key={label} className="grid grid-cols-[7.5rem_1fr_3.5rem] items-center gap-2 text-xs">
            <span className="text-muted-foreground">{label}</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-muted">
              <span className="block h-full rounded-full bg-primary/70" style={{ width: `${percent}%` }} />
            </span>
            <span className="text-right tabular-nums">{count} · {percent}%</span>
          </div>
        )
      })}
      <p className="text-[11px] text-muted-foreground">
        Gross outcomes across {distribution.totalHoles} completed 9-hole league holes.
      </p>
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

  return (
    <article className="mx-auto max-w-2xl space-y-8">
      <Link href={returnTo} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Back to player
      </Link>

      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">IGC Men&apos;s League · 2026 Planit coverage</p>
        <h1 className="mt-2 text-4xl font-semibold leading-tight sm:text-5xl">{data.displayName}</h1>
        <p className="mt-2 text-lg text-muted-foreground">Performance</p>
      </header>

      <section className="border-y border-border py-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Round scoring</p>
        <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-6 sm:grid-cols-4">
          <Metric label={`Recent ${data.model.form.recentGross.length} avg`} value={data.model.form.recentAverageGross?.toFixed(1) ?? '—'} />
          <Metric label="Season average" value={data.model.form.seasonAverageGross?.toFixed(1) ?? '—'} />
          <Metric label="Season best" value={data.model.form.seasonLowGross?.toString() ?? '—'} />
          <Metric label="Completed rounds" value={String(data.model.completedComparableRounds.length)} />
        </div>
      </section>

      {data.model.scoringDistribution ? (
        <section>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Scoring outcomes</p>
          <h2 className="mt-1 text-2xl font-semibold">Gross hole results</h2>
          <div className="mt-4"><Distribution distribution={data.model.scoringDistribution} /></div>
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">No completed hole-level scoring is available.</p>
      )}
    </article>
  )
}
