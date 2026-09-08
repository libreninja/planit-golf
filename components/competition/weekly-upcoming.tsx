'use client'

import { WeeklyTeeSheet } from './weekly-tee-sheet'
import type { WeeklyTeeSheetData } from '@/lib/competition/weekly-tee-sheet'
import type { LeaderboardFollowState } from '@/lib/players/leaderboard-interaction'

export function WeeklyUpcoming({
  teeSheet,
  golferIdsByMemberCard,
  playerFollowState,
  returnTo,
}: {
  teeSheet: WeeklyTeeSheetData
  golferIdsByMemberCard: Record<string, string>
  playerFollowState: LeaderboardFollowState
  returnTo: string
}) {
  const published = teeSheet.status === 'published'

  return (
    <section className="max-w-3xl space-y-3" aria-label="Upcoming weekly occurrence">
      <header className="space-y-0.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">Upcoming</p>
        <p className="text-xs text-muted-foreground">
          {published ? 'Pairings posted' : 'Pairings have not been posted.'}
        </p>
      </header>

      {published ? (
        <WeeklyTeeSheet
          groups={teeSheet.groups}
          golferIdsByMemberCard={golferIdsByMemberCard}
          playerFollowState={playerFollowState}
          returnTo={returnTo}
        />
      ) : null}
    </section>
  )
}
