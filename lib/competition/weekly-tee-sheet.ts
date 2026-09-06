import type { LeaderboardFollowState } from '../players/leaderboard-interaction.ts'

export interface WeeklyTeeSheetPlayer {
  sourceName: string
  firstName: string | null
  lastName: string | null
  memberCardId: string | null
  teamName: string | null
}

export interface WeeklyTeeSheetGroup {
  id: string
  date: string | null
  teeTime: string | null
  startingTee: string | null
  course: string | null
  rotation: string | null
  groupLabel: string | null
  sortOrder: number
  players: WeeklyTeeSheetPlayer[]
}

export interface PersonalizedTeeSheetPlayer extends WeeklyTeeSheetPlayer {
  golferId: string | null
  isSelf: boolean
  isFollowing: boolean
}

export interface PersonalizedTeeSheetGroup extends Omit<WeeklyTeeSheetGroup, 'players'> {
  players: PersonalizedTeeSheetPlayer[]
  containsSelf: boolean
  containsFollowing: boolean
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().replace(/\s+/g, ' ') : null
}

function scalarText(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return text(value)
}

function memberCardId(player: any): string | null {
  const value = player?.member_card_id_str ?? player?.member_card_id
  return value === null || value === undefined || String(value).trim() === '' ? null : String(value).trim()
}

function timeMinutes(value: string | null): number {
  if (!value) return Number.MAX_SAFE_INTEGER
  const match = value.match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i)
  if (!match) return Number.MAX_SAFE_INTEGER
  let hour = Number(match[1]) % 12
  if (match[3].toUpperCase() === 'PM') hour += 12
  return hour * 60 + Number(match[2])
}

export function normalizeWeeklyTeeSheet(raw: unknown): WeeklyTeeSheetGroup[] {
  const payload = raw as any
  const rows = Array.isArray(payload)
    ? payload
    : (payload?.pairing_groups ?? payload?.tee_sheet ?? payload?.groups ?? [])

  return rows.flatMap((row: any, index: number) => {
    const group = row?.pairing_group ?? row?.group ?? row
    const rawPlayers = Array.isArray(group?.players) ? group.players
      : Array.isArray(group?.members) ? group.members
      : []
    const players = rawPlayers.flatMap((rawPlayer: any) => {
      const player = rawPlayer?.player ?? rawPlayer?.member ?? rawPlayer
      const sourceName = text(player?.name)
      if (!sourceName) return []
      return [{
        sourceName,
        firstName: text(player?.first_name),
        lastName: text(player?.last_name),
        memberCardId: memberCardId(player),
        teamName: text(player?.team_name),
      }]
    })
    if (players.length === 0) return []

    const teeTime = text(group?.tee_time ?? group?.teeTime ?? group?.time)
    const date = text(group?.date)
    const startingTee = scalarText(group?.hole ?? group?.starting_hole ?? group?.startingTee)
    const id = text(group?.id ?? group?.foursome_ggid)
      ?? `${date ?? 'date'}|${teeTime ?? 'time'}|${startingTee ?? 'tee'}|${index}`
    return [{
      id,
      date,
      teeTime,
      startingTee,
      course: text(group?.course_name ?? group?.course?.name),
      rotation: text(group?.rotation_name ?? group?.rotation?.name),
      groupLabel: text(group?.name ?? group?.group_name),
      sortOrder: index,
      players,
    }]
  }).sort((a: WeeklyTeeSheetGroup, b: WeeklyTeeSheetGroup) => (
    (a.date ?? '').localeCompare(b.date ?? '')
    || timeMinutes(a.teeTime) - timeMinutes(b.teeTime)
    || a.sortOrder - b.sortOrder
  ))
}

export function personalizeTeeSheetGroups(input: {
  groups: WeeklyTeeSheetGroup[]
  golferIdsByMemberCard: Record<string, string>
  followState: LeaderboardFollowState
}): {
  fullGroups: PersonalizedTeeSheetGroup[]
  personalizedGroups: PersonalizedTeeSheetGroup[]
} {
  const self = new Set(input.followState.selfGolferIds)
  const following = new Set(input.followState.followedGolferIds)
  const fullGroups = input.groups.map((group) => {
    const players = group.players.map((player) => {
      const golferId = player.memberCardId
        ? input.golferIdsByMemberCard[player.memberCardId] ?? null
        : null
      return {
        ...player,
        golferId,
        isSelf: !!golferId && self.has(golferId),
        isFollowing: !!golferId && following.has(golferId),
      }
    })
    return {
      ...group,
      players,
      containsSelf: players.some((player) => player.isSelf),
      containsFollowing: players.some((player) => player.isFollowing),
    }
  })

  const own = fullGroups.filter((group) => group.containsSelf)
  const followed = fullGroups.filter((group) => !group.containsSelf && group.containsFollowing)
  return { fullGroups, personalizedGroups: [...own, ...followed] }
}

export function initialTeeSheetView(personalizedGroupCount: number): 'for-you' | 'full' {
  return personalizedGroupCount > 0 ? 'for-you' : 'full'
}

export interface WeeklyOccurrenceRow {
  week_number: number
  event_name: string | null
  event_date: string | null
  gg_event_id: string | null
  gg_round_id: string | null
}

export function selectCurrentWeeklyTeeSheetOccurrence(
  rows: WeeklyOccurrenceRow[],
  today: string,
): WeeklyOccurrenceRow | null {
  return [...rows]
    .filter((row) => row.week_number < 100 && !!row.event_date && row.event_date >= today)
    .sort((a, b) => (a.event_date ?? '').localeCompare(b.event_date ?? '') || a.week_number - b.week_number)[0]
    ?? null
}
