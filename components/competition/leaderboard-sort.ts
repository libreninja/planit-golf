// Score-relative ordering is independent from authoritative award placement.
// This sorter changes row order only: position labels, points, purse, and flight
// membership remain untouched.

import type { ResultEntry, Scorecard, ScoringMode } from '../../lib/competition/types.ts'

function selectedScore(card: Scorecard | undefined, scoring: ScoringMode): number | null {
  if (!card) return null
  const toPar = scoring === 'gross' ? card.toParGross : card.toParNet
  if (toPar !== null) return toPar
  return scoring === 'gross' ? card.grossTotal : card.netTotal
}

export function hasValidSelectedScore(card: Scorecard | undefined, scoring: ScoringMode): boolean {
  return selectedScore(card, scoring) !== null
}

export function sortEntriesBySelectedScore(
  entries: ResultEntry[],
  scorecards: Scorecard[],
  scoring: ScoringMode,
): ResultEntry[] {
  const cards = new Map(scorecards.map((card) => [card.key, card]))
  return [...entries].sort((a, b) => {
    const aScore = selectedScore(cards.get(a.key), scoring)
    const bScore = selectedScore(cards.get(b.key), scoring)
    if (aScore !== null && bScore !== null) return aScore - bScore
    if (aScore !== null) return -1
    if (bScore !== null) return 1
    // Alphabetical order is now only the fallback for rows that truly have no
    // score in the selected mode, never for valid scored/non-awarded players.
    return a.name.localeCompare(b.name)
  })
}
