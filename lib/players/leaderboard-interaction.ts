import { playerDetailHrefForMemberCard } from './links.ts'

export interface LeaderboardFollowState {
  signedIn: boolean
  followedGolferIds: string[]
  selfGolferIds: string[]
}

export interface LeaderboardPlayerInteraction {
  golferId: string
  playerHref: string
  signedIn: boolean
  initialFollowing: boolean
  isSelf: boolean
}

export function resolveLeaderboardPlayerInteraction(input: {
  memberCardId: string | null
  golferIdsByMemberCard: Record<string, string>
  followState: LeaderboardFollowState
  week?: string | null
  returnTo?: string | null
  scoring?: 'gross' | 'net' | null
}): LeaderboardPlayerInteraction | null {
  if (!input.memberCardId) return null
  const golferId = input.golferIdsByMemberCard[input.memberCardId]
  if (!golferId) return null
  const playerHref = playerDetailHrefForMemberCard({
    memberCardId: input.memberCardId,
    golferIdsByMemberCard: input.golferIdsByMemberCard,
    week: input.week,
    returnTo: input.returnTo,
    scoring: input.scoring,
  })
  if (!playerHref) return null
  return {
    golferId,
    playerHref,
    signedIn: input.followState.signedIn,
    initialFollowing: input.followState.followedGolferIds.includes(golferId),
    isSelf: input.followState.selfGolferIds.includes(golferId),
  }
}
