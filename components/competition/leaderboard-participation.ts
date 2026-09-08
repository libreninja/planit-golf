import type { Scorecard } from '../../lib/competition/types.ts'
import type { WeeklyTeeSheetData } from '../../lib/competition/weekly-tee-sheet.ts'

export type WeeklyParticipationKind =
  | 'scheduled'
  | 'entered'
  | 'live'
  | 'finished'
  | 'not_playing'
  | 'dns'
  | 'wd'
  | 'dq'
  | 'unknown'

export interface WeeklyParticipation {
  kind: WeeklyParticipationKind
  label: string
  teeTime: string | null
}

export function weeklyParticipationForCard(
  card: Scorecard | null,
  teeSheet: WeeklyTeeSheetData | null,
): WeeklyParticipation {
  const raw = card?.scorecardStatus?.trim().toLowerCase().replace(/-/g, '_') ?? ''
  if (raw.includes('withdraw') || raw === 'wd') return { kind: 'wd', label: 'Withdrawn (WD)', teeTime: null }
  if (raw.includes('disqual') || raw === 'dq') return { kind: 'dq', label: 'Disqualified (DQ)', teeTime: null }
  if (raw === 'dns' || raw.includes('no_show') || raw.includes('no show')) {
    return { kind: 'dns', label: 'Did not start (DNS)', teeTime: null }
  }
  if (card && card.holesCompleted > 0) {
    return card.isLive
      ? { kind: 'live', label: `Live · thru ${card.holesCompleted}`, teeTime: null }
      : { kind: 'finished', label: 'Finished', teeTime: null }
  }

  const memberCardId = card?.memberCardId ?? null
  const group = memberCardId && teeSheet?.status === 'published'
    ? teeSheet.groups.find((item) => item.players.some((player) => player.memberCardId === memberCardId)) ?? null
    : null
  if (group?.teeTime) {
    return { kind: 'scheduled', label: `Tee time ${group.teeTime}`, teeTime: group.teeTime }
  }
  if (group) return { kind: 'entered', label: 'Entered · tee time TBD', teeTime: null }
  if (memberCardId && teeSheet?.status === 'published') {
    // A published occurrence tee sheet is positive membership evidence. Only
    // its explicit absence supports this wording; score absence alone never does.
    return { kind: 'not_playing', label: 'Not playing this week', teeTime: null }
  }
  return { kind: 'unknown', label: 'Entry status unavailable', teeTime: null }
}
