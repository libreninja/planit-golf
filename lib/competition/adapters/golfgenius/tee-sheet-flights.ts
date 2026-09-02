// Adapter-local normalization of a tee-sheet payload into Planit projection
// participants. Provider field names stop here.

import { playerKey } from '../../../igc/weekly-results-helpers.ts'
import type { FlightProjectionParticipant } from '../../projected-flights.ts'

function strictNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || value.trim() === '') return null
  const parsed = Number(value.trim())
  return Number.isFinite(parsed) ? parsed : null
}

export function teeSheetProjectionParticipants(raw: unknown): FlightProjectionParticipant[] {
  const payload = raw as any
  const rows = Array.isArray(payload)
    ? payload
    : (payload?.pairing_groups ?? payload?.tee_sheet ?? payload?.groups ?? [])
  const participants: FlightProjectionParticipant[] = []
  const seen = new Set<string>()

  for (const row of rows) {
    const group = row?.pairing_group ?? row?.group ?? row
    const players = Array.isArray(group?.players) ? group.players
      : Array.isArray(group?.members) ? group.members
      : []
    for (const rawPlayer of players) {
      const player = rawPlayer?.player ?? rawPlayer?.member ?? rawPlayer
      const name = typeof player?.name === 'string' ? player.name.trim() : ''
      // Prefer the lossless string representation. Provider member-card IDs
      // can exceed JavaScript's safe integer range, so the numeric form may
      // no longer match the exact string ID carried by leaderboard results.
      const rawMemberCardId = player?.member_card_id_str ?? player?.member_card_id
      const memberCardId = rawMemberCardId == null ? null : String(rawMemberCardId)
      if (!memberCardId && !name) continue
      const key = playerKey(memberCardId, name)
      if (seen.has(key)) continue
      seen.add(key)
      participants.push({ key, handicapIndex: strictNumber(player?.handicap_index) })
    }
  }
  return participants
}
