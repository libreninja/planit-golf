import type { Leaderboard, Scorecard } from '../competition/types.ts'
import type { LeaderboardFollowState } from './leaderboard-interaction.ts'

export interface LeaderboardForYouItem {
  key: string
  golferId: string
  sourceName: string
  isSelf: boolean
  position: string
  score: string
  progress: string
}

function selectedScore(card: Scorecard | null, scoring: Leaderboard['scoringMode']): string {
  if (!card) return '—'
  const toPar = scoring === 'gross' ? card.toParGross : card.toParNet
  if (toPar !== null) return toPar === 0 ? 'E' : toPar > 0 ? `+${toPar}` : String(toPar)
  const total = scoring === 'gross' ? card.grossTotal : card.netTotal
  return total === null ? '—' : String(total)
}

function explicitProgress(card: Scorecard | null, resultStatus: Leaderboard['resultStatus']): string {
  const rawStatus = card?.scorecardStatus?.trim().toLowerCase() ?? ''
  if (rawStatus.includes('withdraw')) return 'WD'
  if (rawStatus.includes('disqual')) return 'DQ'
  if (rawStatus.includes('no_show') || rawStatus.includes('no show')) return 'NS'
  if (!card || card.holesCompleted === 0) return 'Not started'
  if (resultStatus === 'final' || !card.isLive) return 'F'
  return `Thru ${card.holesCompleted}`
}

// Input entry order is authoritative for this presentation. Personalization
// selects from it but never mutates or re-sorts the full leaderboard.
export function buildLeaderboardForYou(input: {
  leaderboard: Leaderboard
  golferIdsByMemberCard: Record<string, string>
  followState: LeaderboardFollowState
}): LeaderboardForYouItem[] {
  const cardsByKey = new Map(input.leaderboard.scorecards.map((card) => [card.key, card]))
  const followed = new Set(input.followState.followedGolferIds)
  const self = new Set(input.followState.selfGolferIds)
  const seen = new Set<string>()
  const own: LeaderboardForYouItem[] = []
  const following: LeaderboardForYouItem[] = []

  for (const entry of input.leaderboard.entries) {
    const card = cardsByKey.get(entry.key) ?? null
    const memberCardId = card?.memberCardId
    const golferId = memberCardId ? input.golferIdsByMemberCard[memberCardId] : null
    if (!golferId || seen.has(golferId)) continue
    const isSelf = self.has(golferId)
    if (!isSelf && !followed.has(golferId)) continue
    seen.add(golferId)
    const item: LeaderboardForYouItem = {
      key: entry.key,
      golferId,
      sourceName: entry.name,
      isSelf,
      position: entry.positionLabel ?? 'NS',
      score: selectedScore(card, input.leaderboard.scoringMode),
      progress: explicitProgress(card, input.leaderboard.resultStatus),
    }
    if (isSelf) own.push(item)
    else following.push(item)
  }

  return [...own, ...following]
}
