import type { Scorecard } from './types.ts'
import { makeSingleFlight, readCachedTeeSheet, writeCachedTeeSheet, type LiveCacheStore } from './cache.ts'

interface PlayerRound {
  member_card_id?: unknown
  handicap_dots_by_hole?: unknown
  score_array?: unknown
  tee?: { hole_data?: { par?: unknown } }
}

function integerAt(array: unknown, index: number, minimum: number): number | null {
  const value = Array.isArray(array) ? array[index] : null
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum ? value : null
}

// This lookup belongs to exactly one requested event/round. Never join names,
// unsafe numeric IDs, or derive dots from scores/course-handicap arithmetic.
export function withWeeklyScorecardFacts(cards: Scorecard[], raw: unknown): Scorecard[] {
  const payload = raw as { pairing_groups?: unknown[]; tee_sheet?: unknown[]; groups?: unknown[] } | null
  const groups = Array.isArray(raw) ? raw : payload?.pairing_groups ?? payload?.tee_sheet ?? payload?.groups ?? []
  const players = new Map<string, PlayerRound | null>()
  for (const group of groups) {
    const wrapper = group as { pairing_group?: { players?: PlayerRound[] }; players?: PlayerRound[] }
    for (const player of (wrapper.pairing_group ?? wrapper).players ?? []) {
      const id = player.member_card_id
      const key = typeof id === 'string' ? id : typeof id === 'number' && Number.isSafeInteger(id) ? String(id) : null
      if (key) players.set(key, players.has(key) ? null : player) // ambiguous identity stays unknown
    }
  }
  return cards.map(card => {
    const player = card.memberCardId ? players.get(card.memberCardId) : null
    return { ...card, holes: card.holes.map(hole => {
      const index = hole.hole - 1
      const played = hole.gross !== null || hole.net !== null
      return {
        ...hole,
        par: integerAt(player?.tee?.hole_data?.par, index, 1) ?? hole.par,
        // A scored tournament hole gates play state; a newer tee sheet must not
        // add future scores to an older result snapshot or change its THRU.
        actualStrokes: !played ? null : Array.isArray(player?.score_array)
          ? integerAt(player.score_array, index, 1) : hole.gross,
        handicapStrokes: integerAt(player?.handicap_dots_by_hole, index, 0),
      }
    }) }
  })
}

const singleFlight = makeSingleFlight<unknown>()

interface RoundInput {
  tenantKey: string
  competitionKey: string
  occurrenceId: string
  ggEventId: string | null
  ggRoundId: string | null
  ggClient: (endpoint: string) => Promise<unknown>
  cacheStore?: LiveCacheStore
}

export async function readScorecardTeeSheet(input: RoundInput): Promise<unknown> {
  if (!input.ggEventId || !input.ggRoundId) return null
  // Unlike the logistical tee-sheet cache, recorded strokes need the live
  // scoring cadence. Include authoritative round identity to prevent reuse
  // after an occurrence is remapped. Both display modes share this read.
  const args = { tenantKey: input.tenantKey, competitionKey: input.competitionKey,
    occurrenceId: `${input.occurrenceId}:${input.ggEventId}:${input.ggRoundId}:scorecard` }
  return singleFlight.run(`${args.tenantKey}:${args.competitionKey}:${args.occurrenceId}`, async () => {
    let value = await readCachedTeeSheet(args, input.cacheStore)
    if (value === null) {
      value = await input.ggClient(`/events/${input.ggEventId}/rounds/${input.ggRoundId}/tee_sheet`)
      try { await writeCachedTeeSheet(args, value, 30, input.cacheStore) } catch { /* best effort */ }
    }
    return value
  })
}

export async function readWeeklyScorecardFacts(input: RoundInput & { cards: Scorecard[] }): Promise<Scorecard[]> {
  try {
    return withWeeklyScorecardFacts(input.cards, await readScorecardTeeSheet(input))
  } catch {
    // Supplemental allocation failure must not blank verified results.
    return withWeeklyScorecardFacts(input.cards, null)
  }
}
