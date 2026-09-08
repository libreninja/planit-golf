import type { Occurrence } from '../../lib/competition/types.ts'

export interface OccurrenceAvailabilityEvidence {
  hasResults: Set<string>
  liveScoredOccurrenceIds: Set<string>
}

export function availableLeaderboardOccurrences(
  occurrences: Occurrence[],
  evidence: OccurrenceAvailabilityEvidence,
): Occurrence[] {
  return occurrences.filter((occurrence) => (
    evidence.hasResults.has(occurrence.id)
    || evidence.liveScoredOccurrenceIds.has(occurrence.id)
  ))
}

// Weekly owns the selected occurrence's whole lifecycle. Regular league weeks
// therefore remain navigable before scores exist so they can show an honest
// upcoming/pairings state. Special occurrences retain the prior rule because
// they have their own primary product destination.
export function availableWeeklyOccurrences(
  occurrences: Occurrence[],
  evidence: OccurrenceAvailabilityEvidence,
): Occurrence[] {
  return occurrences.filter((occurrence) => (
    (occurrence.number !== null && occurrence.number < 100)
    || evidence.hasResults.has(occurrence.id)
    || evidence.liveScoredOccurrenceIds.has(occurrence.id)
  ))
}

export function latestResultsOccurrenceId(
  occurrences: Occurrence[],
  hasResults: Set<string>,
  currentScoredOccurrenceIds: Set<string>,
): string | null {
  const currentScored = occurrences.filter((occurrence) => currentScoredOccurrenceIds.has(occurrence.id))
  if (currentScored.length > 0) return currentScored[currentScored.length - 1].id
  const scored = occurrences.filter((occurrence) => hasResults.has(occurrence.id))
  return scored.length > 0 ? scored[scored.length - 1].id : null
}
