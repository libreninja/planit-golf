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
  const fullRound = segments.length > 1
  const sum = (values: (number | null)[], requireAll = false) =>
    (requireAll ? values.every(value => value !== null) : values.some(value => value !== null))
      ? values.reduce<number>((total, value) => total + (value ?? 0), 0) : null
  return (
    <div role="group" aria-label={`${card.label} scorecard`} className="border-t border-border bg-muted/20 px-2 pb-1 pt-3 sm:px-3">
      <div className="mb-2 text-xs text-muted-foreground">
        {card.label} <span className="font-semibold text-foreground tabular-nums">{card.total ?? '—'}</span> ({formatToPar(card.toPar)})
      </div>
      {segments.map((holes, segment) => {
        const pars = holes.map(h => h.par)
        const scores = holes.map(h => h.strokes)
        const parTotal = pars.every(p => p !== null) ? pars.reduce<number>((sum, p) => sum + p!, 0) : null
        const actualTotal = scores.some(s => s !== null) ? scores.reduce<number>((sum, s) => sum + (s ?? 0), 0) : null
        return (
          <table key={segment} aria-label={`${card.label} ${fullRound ? segment === 0 ? 'outward nine' : 'inward nine' : 'nine-hole round'}`} className="mb-1 w-full table-fixed border-collapse text-center text-[11px] tabular-nums sm:text-xs">
            <thead>
              <tr className="border-y border-border bg-muted/70">
                <th scope="row" className="w-9 py-2 text-left pl-1 font-medium text-muted-foreground">Hole</th>
                {holes.map(hole => (
                  <th key={hole.hole} scope="col" aria-label={`Hole ${hole.hole}`} className="py-2 font-medium">
                    {hole.hole}
                  </th>
                ))}
                <th scope="col" className="w-10 border-l border-border font-medium">{fullRound ? segment === 0 ? 'Out' : 'In' : 'Total'}</th>
                {fullRound && segment === 1 && <th scope="col" className="w-10 border-l border-border font-medium">Total</th>}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border/60 text-muted-foreground">
                <th scope="row" className="py-1.5 pl-1 text-left font-normal">Par</th>
                {holes.map(hole => <td key={hole.hole}>{hole.par ?? '—'}</td>)}
                <td className="border-l border-border">{parTotal ?? '—'}</td>
                {fullRound && segment === 1 && <td className="border-l border-border">{sum(card.holes.map(hole => hole.par), true) ?? '—'}</td>}
              </tr>
              <tr className="border-b border-border">
                <th scope="row" className="py-2 pl-1 text-left font-medium">Score</th>
                {holes.map(hole => (
                  <td key={hole.hole} className="py-1.5">
                    <span className="relative inline-flex align-middle">
                      <span
                        aria-label={`Hole ${hole.hole}: ${hole.strokes === null ? 'actual score unavailable' : `${hole.strokes} actual strokes`}${hole.toPar === null ? '' : `, ${card.label} ${markNames[hole.mark]}`}${card.showHandicap ? `, ${hole.handicapStrokes === null ? 'handicap allocation unknown' : `${hole.handicapStrokes} handicap strokes`}` : ''}`}
                        data-score-hole={hole.hole}
                        data-score-mark={hole.mark}
                        className={`flex h-[22px] items-center justify-center font-semibold leading-none sm:h-7 ${hole.mark === 'plain' || hole.strokes === null ? 'min-w-3' : `w-[22px] sm:w-7 ${markClasses[hole.mark]}`}`}
                      >{hole.strokes ?? ''}</span>
                      {card.showHandicap && hole.handicapStrokes !== 0 && (
                        <span aria-hidden data-handicap-hole={hole.hole} className="absolute left-full top-0 ml-px flex -translate-y-1/2 flex-col gap-px text-[9px] leading-[4px] text-muted-foreground">
                          {hole.handicapStrokes === null ? '?' : Array.from({ length: hole.handicapStrokes }, (_, index) => <span key={index} className="h-0.5 w-0.5 rounded-full bg-current text-[0px]">•</span>)}
                        </span>
                      )}
                    </span>
                  </td>
                ))}
                <td aria-label={fullRound ? "Recorded stroke subtotal" : "Recorded stroke total"} className="border-l border-border font-semibold">{actualTotal ?? '—'}</td>
                {fullRound && segment === 1 && <td aria-label="Recorded stroke total" className="border-l border-border font-semibold">{sum(card.holes.map(hole => hole.strokes)) ?? '—'}</td>}
              </tr>
            </tbody>
          </table>
        )
      })}
    </div>
  )
}
