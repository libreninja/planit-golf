'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronRight, Clock3, Star } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { displayPersonName } from '@/lib/players/person-name'
import { playerDetailHref } from '@/lib/players/links'
import {
  initialTeeSheetView,
  personalizeTeeSheetGroups,
  type PersonalizedTeeSheetGroup,
  type WeeklyTeeSheetGroup,
} from '@/lib/competition/weekly-tee-sheet'
import type { LeaderboardFollowState } from '@/lib/players/leaderboard-interaction'

function TeeGroup({ group, returnTo }: { group: PersonalizedTeeSheetGroup; returnTo: string }) {
  const context = [
    group.startingTee ? `Tee ${group.startingTee}` : null,
    group.course,
    group.rotation,
    group.groupLabel,
  ].filter(Boolean).join(' · ')
  const relevance = group.containsSelf ? 'Your group' : group.containsFollowing ? 'Following' : null

  return (
    <article className={cn(
      'overflow-hidden rounded-md border bg-card',
      group.containsSelf ? 'border-primary/45' : group.containsFollowing ? 'border-primary/20' : 'border-border',
    )}>
      <header className="flex items-start justify-between gap-3 border-b border-border/70 px-3 py-2.5">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-semibold tabular-nums">
            <Clock3 className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
            {group.teeTime ?? 'Time TBD'}
          </p>
          {context ? <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{context}</p> : null}
        </div>
        {relevance ? (
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">{relevance}</span>
        ) : null}
      </header>
      <div className="grid grid-cols-2">
        {group.players.map((player, index) => {
          const name = displayPersonName({
            sourceName: player.sourceName,
            firstName: player.firstName,
            lastName: player.lastName,
          })
          const content = (
            <>
              <span className="min-w-0 truncate text-sm font-medium">{name}</span>
              {player.isSelf ? (
                <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-primary">You</span>
              ) : player.isFollowing ? (
                <Star className="h-3 w-3 shrink-0 fill-current text-primary" aria-label="Following" />
              ) : null}
              {player.golferId ? <ChevronRight className="h-3 w-3 shrink-0 text-primary/60" aria-hidden /> : null}
            </>
          )
          const className = cn(
            'flex min-w-0 items-center gap-1 border-t border-border/60 px-3 py-2.5 text-foreground first:border-t-0 [&:nth-child(2)]:border-t-0 odd:border-r',
            player.isSelf ? 'bg-primary/[0.09] font-semibold' : player.isFollowing ? 'bg-primary/[0.035]' : '',
            player.golferId && 'hover:text-primary',
          )
          return player.golferId ? (
            <Link
              key={`${player.memberCardId ?? player.sourceName}|${index}`}
              href={playerDetailHref({ golferId: player.golferId, returnTo })}
              title={name}
              className={className}
            >
              {content}
            </Link>
          ) : (
            <div key={`${player.memberCardId ?? player.sourceName}|${index}`} title={name} className={className}>
              {content}
            </div>
          )
        })}
      </div>
    </article>
  )
}

export function WeeklyTeeSheet({
  groups,
  golferIdsByMemberCard,
  playerFollowState,
  returnTo,
}: {
  groups: WeeklyTeeSheetGroup[]
  golferIdsByMemberCard: Record<string, string>
  playerFollowState: LeaderboardFollowState
  returnTo: string
}) {
  const { fullGroups, personalizedGroups } = personalizeTeeSheetGroups({
    groups, golferIdsByMemberCard, followState: playerFollowState,
  })
  const [view, setView] = useState<'for-you' | 'full'>(() => initialTeeSheetView(personalizedGroups.length))
  const hasPersonalizedGroups = personalizedGroups.length > 0
  const visibleGroups = view === 'for-you' && hasPersonalizedGroups ? personalizedGroups : fullGroups

  return (
    <section className="space-y-3">
      {hasPersonalizedGroups ? (
        <div className="inline-flex rounded-md bg-muted p-1" role="group" aria-label="Tee sheet view">
          <button
            type="button"
            aria-pressed={view === 'for-you'}
            onClick={() => setView('for-you')}
            className={cn('rounded px-3 py-1.5 text-sm font-semibold', view === 'for-you' ? 'bg-background shadow-sm' : 'text-muted-foreground')}
          >
            For you <span className="font-normal text-muted-foreground">· {personalizedGroups.length}</span>
          </button>
          <button
            type="button"
            aria-pressed={view === 'full'}
            onClick={() => setView('full')}
            className={cn('rounded px-3 py-1.5 text-sm font-semibold', view === 'full' ? 'bg-background shadow-sm' : 'text-muted-foreground')}
          >
            Full tee sheet <span className="font-normal text-muted-foreground">· {fullGroups.length}</span>
          </button>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {visibleGroups.map((group) => <TeeGroup key={group.id} group={group} returnTo={returnTo} />)}
      </div>
    </section>
  )
}
