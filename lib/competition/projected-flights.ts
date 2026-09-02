// Pure Planit flight-membership logic. No provider payloads, I/O, persistence,
// scoring awards, or tournament calculations belong here.

import type {
  FlightMembershipState,
  Grouping,
  Leaderboard,
  ResultEntry,
} from './types.ts'

export const FLIGHT_KEYS = ['Flight 1', 'Flight 2', 'Flight 3'] as const

export interface FlightProjectionParticipant {
  key: string
  handicapIndex: number | null
}

export interface ProjectedFlightSnapshot {
  roundKey: string
  participantCount: number
  assignments: Array<[playerKey: string, flightKey: string]>
}

export const unavailableFlightMembership = (): FlightMembershipState => ({
  status: 'unavailable',
  groupings: [],
})

function groupings(status: 'projected' | 'official'): Grouping[] {
  return FLIGHT_KEYS.map((key) => ({
    key,
    label: status === 'projected' ? `Projected ${key}` : key,
  }))
}

export function canonicalFlight(value: string | null): string | null {
  if (!value) return null
  const match = value.trim().match(/^flight\s*([123])$/i)
  return match ? `Flight ${match[1]}` : null
}

// Named Flight 1/2/3 membership is authoritative independently of whether
// scoring is live or final. A single recognized named flight is sufficient to
// switch away from projection; waiting for an extra completeness signal would
// incorrectly couple membership publication to scoring publication.
export function officialFlightMembership(
  leaderboard: Leaderboard | null,
): { state: FlightMembershipState; leaderboard: Leaderboard | null } {
  if (!leaderboard) return { state: unavailableFlightMembership(), leaderboard }
  const hasOfficialMembership = leaderboard.entries.some((entry) => canonicalFlight(entry.flight) !== null)
  if (!hasOfficialMembership) return { state: unavailableFlightMembership(), leaderboard }

  return {
    state: { status: 'official', groupings: groupings('official') },
    leaderboard: {
      ...leaderboard,
      entries: leaderboard.entries.map((entry) => ({
        ...entry,
        // Once official membership appears it completely replaces any other
        // grouping label. Unrecognized/overall rows remain Overall-only.
        flight: canonicalFlight(entry.flight),
      })),
    },
  }
}

// Deterministic approximate thirds. Missing indexes remain unassigned and do
// not reduce the population used to split players who do have usable indexes.
// Equal indexes are ordered by stable player key; no cutoff semantics are
// inferred or exposed.
export function projectFlightAssignments(
  participants: FlightProjectionParticipant[],
): Map<string, string> {
  const usableByKey = new Map<string, number>()
  for (const participant of participants) {
    if (!participant.key || participant.handicapIndex === null || !Number.isFinite(participant.handicapIndex)) continue
    if (!usableByKey.has(participant.key)) usableByKey.set(participant.key, participant.handicapIndex)
  }

  const ordered = [...usableByKey.entries()].sort(
    ([aKey, aIndex], [bKey, bIndex]) => aIndex - bIndex || (aKey < bKey ? -1 : aKey > bKey ? 1 : 0),
  )
  const base = Math.floor(ordered.length / FLIGHT_KEYS.length)
  const remainder = ordered.length % FLIGHT_KEYS.length
  const sizes = FLIGHT_KEYS.map((_, index) => base + (index < remainder ? 1 : 0))

  const assignments = new Map<string, string>()
  let cursor = 0
  FLIGHT_KEYS.forEach((flight, flightIndex) => {
    for (let i = 0; i < sizes[flightIndex]; i += 1) {
      const player = ordered[cursor]
      if (player) assignments.set(player[0], flight)
      cursor += 1
    }
  })
  return assignments
}

export function applyProjectedFlights(
  leaderboard: Leaderboard | null,
  assignments: Map<string, string>,
): { state: FlightMembershipState; leaderboard: Leaderboard | null } {
  const state: FlightMembershipState = { status: 'projected', groupings: groupings('projected') }
  if (!leaderboard) return { state, leaderboard }
  return {
    state,
    leaderboard: {
      ...leaderboard,
      entries: leaderboard.entries.map((entry) => ({
        ...entry,
        flight: assignments.get(entry.key) ?? null,
      })),
    },
  }
}

// A projected-flight view keeps the trusted Overall ordering, then compresses
// positions within the selected subset. Equal source positions stay tied;
// score math and tie-breaking rules are not re-derived in Planit.
export function rankProjectedEntries(entries: ResultEntry[]): ResultEntry[] {
  const placed = entries.filter((entry) => Number.isFinite(entry.positionOrder) && entry.positionOrder < Number.MAX_SAFE_INTEGER)
  const counts = new Map<number, number>()
  for (const entry of placed) counts.set(entry.positionOrder, (counts.get(entry.positionOrder) ?? 0) + 1)

  const rankBySourcePosition = new Map<number, number>()
  let placedBefore = 0
  for (const sourcePosition of [...counts.keys()].sort((a, b) => a - b)) {
    rankBySourcePosition.set(sourcePosition, placedBefore + 1)
    placedBefore += counts.get(sourcePosition) ?? 0
  }

  return entries.map((entry) => {
    const rank = rankBySourcePosition.get(entry.positionOrder)
    if (rank === undefined) return { ...entry, positionLabel: null, positionOrder: Number.MAX_SAFE_INTEGER }
    const tied = (counts.get(entry.positionOrder) ?? 0) > 1
    return { ...entry, positionLabel: `${tied ? 'T' : ''}${rank}`, positionOrder: rank }
  })
}
