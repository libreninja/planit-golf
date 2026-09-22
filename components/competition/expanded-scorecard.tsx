import { formatToPar, toParClass } from './leaderboard-format'
import type { ScorecardContext } from './scorecard-context'

export function ExpandedScorecard({ card, narrate = false }: { card: ScorecardContext; narrate?: boolean }) {
  return (
    <div role="group" aria-label={`${card.label} scorecard`} className="border-t border-border bg-muted/20 px-3 py-3">
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>{card.label} <span className="font-semibold text-foreground tabular-nums">{card.total ?? '—'}</span> ({formatToPar(card.toPar)})</span>
      </div>
      <div className="flex gap-1 overflow-x-auto pb-1">
        {card.holes.map((hole) => (
          <div
            key={hole.hole}
            role="group"
            aria-label={`Hole ${hole.hole}`}
            className={[
              'min-w-[3.25rem] shrink-0 rounded-md border px-1.5 py-1 text-center text-[11px] leading-tight',
              hole.strokes !== null ? 'border-border bg-background' : 'border-dashed border-border/60 bg-transparent text-muted-foreground/50',
            ].join(' ')}
          >
            <div className="text-muted-foreground">{hole.hole}</div>
            <div className="tabular-nums text-muted-foreground/80">par {hole.par ?? '—'}</div>
            <div aria-label={`${card.label} strokes`} className="tabular-nums font-semibold">{hole.strokes ?? '—'}</div>
            <div aria-label={`${card.label} to par`} className={`tabular-nums ${toParClass(hole.toPar)}`}>
              {formatToPar(hole.toPar)}
            </div>
          </div>
        ))}
      </div>
      {narrate && card.holes.length > 1 && (
        <p className="mt-2 text-[11px] text-muted-foreground">{toParNarration(card)}</p>
      )}
    </div>
  )
}

function toParNarration(card: ScorecardContext): string {
  const played = card.holes.filter((hole) => hole.cumulativeToPar !== null)
  if (played.length < 2) return ''
  const first = played[0]
  const last = played[played.length - 1]
  const allPlayed = card.holes.filter((hole) => hole.strokes !== null).length
  const state = first.cumulativeToPar === last.cumulativeToPar && played.length === allPlayed ? 'finished' : 'now'
  return `Through ${first.hole}: ${formatToPar(first.cumulativeToPar)} · ${state} ${formatToPar(last.cumulativeToPar)} through ${last.hole}`
}
