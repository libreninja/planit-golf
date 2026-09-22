import { formatToPar } from './leaderboard-format'
import type { ScorecardContext } from './scorecard-context'

const markClasses = {
  plain: '',
  circle: 'rounded-full border border-foreground/70',
  'double-circle': 'rounded-full border-[3px] border-double border-foreground/70',
  square: 'border border-foreground/70',
  'double-square': 'border-[3px] border-double border-foreground/70',
}
const markNames = { plain: 'par', circle: 'birdie', 'double-circle': 'eagle or better', square: 'bogey', 'double-square': 'double bogey or worse' }

export function ExpandedScorecard({ card }: { card: ScorecardContext; narrate?: boolean }) {
  const segments = [card.holes.slice(0, 9), card.holes.slice(9, 18)].filter(holes => holes.length)
  return (
    <div role="group" aria-label={`${card.label} scorecard`} className="border-t border-border bg-muted/20 px-2 py-3 sm:px-3">
      <div className="mb-2 text-xs text-muted-foreground">
        {card.label} <span className="font-semibold text-foreground tabular-nums">{card.total ?? '—'}</span> ({formatToPar(card.toPar)})
      </div>
      {segments.map((holes, segment) => {
        const pars = holes.map(h => h.par)
        const scores = holes.map(h => h.strokes)
        const parTotal = pars.every(p => p !== null) ? pars.reduce<number>((sum, p) => sum + p!, 0) : null
        const actualTotal = scores.some(s => s !== null) ? scores.reduce<number>((sum, s) => sum + (s ?? 0), 0) : null
        return (
          <table key={segment} aria-label={`${card.label} ${segment === 0 ? 'outward' : 'inward'} nine`} className="mb-1 w-full table-fixed border-collapse text-center text-[11px] tabular-nums sm:text-xs">
            <thead>
              <tr className="border-y border-border bg-muted/70">
                <th scope="row" className="w-9 py-2 text-left pl-1 font-medium text-muted-foreground">Hole</th>
                {holes.map(hole => (
                  <th key={hole.hole} scope="col" aria-label={`Hole ${hole.hole}${card.showHandicap ? `, ${hole.handicapStrokes === null ? 'handicap allocation unknown' : `${hole.handicapStrokes} handicap strokes`}` : ''}`} className="relative py-2 font-medium">
                    {hole.hole}
                    {card.showHandicap && hole.handicapStrokes !== 0 && (
                      <span aria-hidden className="absolute right-0.5 top-0 text-[9px] leading-none text-muted-foreground">
                        {hole.handicapStrokes === null ? '?' : hole.handicapStrokes <= 3 ? '•'.repeat(hole.handicapStrokes) : `•${hole.handicapStrokes}`}
                      </span>
                    )}
                  </th>
                ))}
                <th scope="col" className="w-8 border-l border-border font-medium">{segment === 0 ? 'Out' : 'In'}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border/60 text-muted-foreground">
                <th scope="row" className="py-1.5 pl-1 text-left font-normal">Par</th>
                {holes.map(hole => <td key={hole.hole}>{hole.par ?? '—'}</td>)}
                <td className="border-l border-border">{parTotal ?? '—'}</td>
              </tr>
              <tr className="border-b border-border">
                <th scope="row" className="py-2 pl-1 text-left font-medium">Score</th>
                {holes.map(hole => (
                  <td key={hole.hole} className="py-1.5">
                    <span
                      aria-label={`Hole ${hole.hole}: ${hole.strokes === null ? 'actual score unavailable' : `${hole.strokes} actual strokes`}${hole.toPar === null ? '' : `, ${card.label} ${markNames[hole.mark]}`}`}
                      data-score-hole={hole.hole}
                      data-score-mark={hole.mark}
                      className={`mx-auto flex h-[22px] w-[22px] items-center justify-center font-semibold leading-none sm:h-7 sm:w-7 ${hole.strokes === null ? '' : markClasses[hole.mark]}`}
                    >{hole.strokes ?? ''}</span>
                  </td>
                ))}
                <td aria-label="Recorded stroke subtotal" className="border-l border-border font-semibold">{actualTotal ?? '—'}</td>
              </tr>
            </tbody>
          </table>
        )
      })}
      <p className="mt-1.5 text-[10px] text-muted-foreground">Actual strokes · Circles under par · Squares over par{card.showHandicap ? ' · Dots: handicap' : ''}</p>
    </div>
  )
}
