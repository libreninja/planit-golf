import type { ResultStatus } from '../../lib/competition/types.ts'
import type { WeeklyTeeSheetStatus } from '../../lib/competition/weekly-tee-sheet.ts'

export type WeeklyStage = 'upcoming' | 'pairings' | 'live' | 'final' | 'unavailable'

export function weeklyStageUsesLeaderboardControls(stage: WeeklyStage): boolean {
  return stage === 'live' || stage === 'final'
}

// Strong scoring state always outranks pairings. A tee sheet may remain
// published after play starts, so its existence can establish the upcoming
// pairings state but can never demote authoritative live/final scoring.
export function resolveWeeklyStage(input: {
  resultStatus: ResultStatus
  historicalFinal: boolean
  teeSheetStatus: WeeklyTeeSheetStatus
}): WeeklyStage {
  if (input.historicalFinal || input.resultStatus === 'final') return 'final'
  if (input.resultStatus === 'live') return 'live'
  if (input.teeSheetStatus === 'published') return 'pairings'
  if (input.teeSheetStatus === 'unavailable') return 'unavailable'
  return 'upcoming'
}
