import type { Scorecard, ScoringMode } from '../../lib/competition/types.ts'

type ScorecardFacts = Pick<Scorecard, 'grossTotal' | 'netTotal' | 'toParGross' | 'toParNet' | 'holes'>

// Project the shared authoritative facts into ONE scoring context before
// rendering. The expanded card cannot reach the alternate mode's values.
// Net strokes and deltas are upstream facts, never handicap reconstructions.
export function buildScorecardContext(card: ScorecardFacts, mode: ScoringMode) {
  const isGross = mode === 'gross'
  let running: number | null = 0
  return {
    label: isGross ? 'Gross' : 'Net',
    total: isGross ? card.grossTotal : card.netTotal,
    toPar: isGross ? card.toParGross : card.toParNet,
    holes: card.holes.map((hole) => {
      const strokes = isGross ? hole.gross : hole.net
      const toPar = strokes === null ? null : isGross
        ? (hole.par !== null ? strokes - hole.par : hole.toParGross)
        : hole.toPar
      // Do not invent a running score across missing annotations.
      running = running !== null && toPar !== null ? running + toPar : null
      return { hole: hole.hole, par: hole.par, strokes, toPar, cumulativeToPar: running }
    }),
  }
}

export type ScorecardContext = ReturnType<typeof buildScorecardContext>
