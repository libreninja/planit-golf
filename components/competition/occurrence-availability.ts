import type { Occurrence } from '../../lib/competition/types.ts'

export interface OccurrenceAvailabilityEvidence {
  hasResults: Set<string>
  liveScoredOccurrenceIds: Set<string>
}

// Leaderboard navigation is intentionally narrower than the league schedule:
// only occurrences with stored scoring or meaningful current live scoring.
export function availableLeaderboardOccurrences(
  occurrences: Occurrence[],
  evidence: OccurrenceAvailabilityEvidence,
): Occurrence[] {
  return occurrences.filter((occurrence) => (
    evidence.hasResults.has(occurrence.id)
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
