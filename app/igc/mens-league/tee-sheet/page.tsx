import Link from 'next/link'
import { ArrowLeft, CalendarDays } from 'lucide-react'
import { WeeklyTeeSheet } from '@/components/competition/weekly-tee-sheet'
import { getCurrentMensWeeklyTeeSheet } from '@/lib/competition/weekly-tee-sheet-data'
import { getMensLeaderboardPlayerState } from '@/lib/players/data'

export const dynamic = 'force-dynamic'

function formatDate(value: string | null): string {
  if (!value) return 'Date TBD'
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${value}T12:00:00Z`))
}

function eventLabel(value: string | null, week: number): string {
  return value?.replace(/^Points Season\s*-\s*/i, '') || `Week ${week}`
}

export default async function MensLeagueTeeSheetPage() {
  const [teeSheet, playerState] = await Promise.all([
    getCurrentMensWeeklyTeeSheet(),
    getMensLeaderboardPlayerState(),
  ])
  const occurrence = teeSheet.occurrence

  return (
    <article className="mx-auto max-w-3xl space-y-5">
      <Link href="/igc/mens-league" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Back to standings
      </Link>

      <header>
        <h1 className="text-3xl font-semibold">Tee sheet</h1>
        {occurrence ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{eventLabel(occurrence.event_name, occurrence.week_number)}</span>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="h-3.5 w-3.5" aria-hidden /> {formatDate(occurrence.event_date)}
            </span>
          </div>
        ) : null}
      </header>

      {teeSheet.status === 'published' ? (
        <WeeklyTeeSheet
          groups={teeSheet.groups}
          golferIdsByMemberCard={playerState.golferIdsByMemberCard}
          playerFollowState={{
            signedIn: playerState.signedIn,
            followedGolferIds: playerState.followedGolferIds,
            selfGolferIds: playerState.selfGolferIds,
          }}
          returnTo="/igc/mens-league/tee-sheet"
        />
      ) : (
        <section className="rounded-md border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
          {teeSheet.status === 'unavailable'
            ? 'The tee sheet is temporarily unavailable. Please try again shortly.'
            : occurrence
              ? 'Pairings have not been published for this week.'
              : 'No upcoming Men’s League occurrence is available.'}
        </section>
      )}
    </article>
  )
}
