import type { Scorecard, ScoringMode } from '../../lib/competition/types.ts'

type ScorecardFacts = Pick<Scorecard, 'grossTotal' | 'netTotal' | 'toParGross' | 'toParNet' | 'holes'>

// Project the shared authoritative facts into ONE scoring context before
// rendering. Actual strokes are independent of the selected scoring result.
// Net strokes and deltas are upstream facts, never handicap reconstructions.
export function buildScorecardContext(card: ScorecardFacts, mode: ScoringMode) {
  const isGross = mode === 'gross'
  let running: number | null = 0
  return {
    label: isGross ? 'Gross' : 'Net',
    showHandicap: !isGross,
    total: isGross ? card.grossTotal : card.netTotal,
    toPar: isGross ? card.toParGross : card.toParNet,
    holes: card.holes.map((hole) => {
      const strokes = hole.actualStrokes === undefined ? hole.gross : hole.actualStrokes
      const selected = isGross ? hole.gross : hole.net
      const toPar = strokes === null || selected === null ? null : isGross
        ? (hole.toParGross ?? (hole.par !== null ? selected - hole.par : null))
        : hole.toPar
      // Do not invent a running score across missing annotations.
      running = running !== null && toPar !== null ? running + toPar : null
      return { hole: hole.hole, par: hole.par, strokes, toPar, mark: scoreMark(toPar), handicapStrokes: hole.handicapStrokes ?? null, cumulativeToPar: running }
    }),
  }
}

export type ScorecardContext = ReturnType<typeof buildScorecardContext>

export function scoreMark(toPar: number | null): 'plain' | 'circle' | 'double-circle' | 'square' | 'double-square' {
  if (toPar === null || toPar === 0) return 'plain'
  if (toPar <= -2) return 'double-circle'
  if (toPar === -1) return 'circle'
  return toPar === 1 ? 'square' : 'double-square'
}
