// Pure aggregate-arithmetic for a multi-occurrence competition (the Club
// Championship: two independent 9-hole rounds — Monday final + Tuesday live).
// Sums per-member totals across the occurrences, joins members by scorecard
// key (memberCardId || name), and derives finishing positions by aggregate
// to-par. The aggregate card carries NO per-hole array (holes: []) — the
// championship is TWO 9-hole rounds, never one 18-hole card (see the invariant
// in tests/competition-scorecard-trim.test.ts); per-hole detail lives on each
// occurrence's own view. A card with holes: [] is non-expandable in the shared
// Leaderboard, so the aggregate row renders totals only — reusing the existing
// component unchanged. purse is null on every aggregate entry, so the Purse
// column auto-hides via shouldShowPurse.
//
// PARTIAL-LIVE: isLive is the OR of the constituent cards' isLive. A member
// whose Tuesday card is still in progress (or not yet posted — the caller
// injects a card with holesCompleted=0, isLive=true) rolls up as live, so the
// aggregate updates as Tuesday scores arrive. The caller curates per-card
// isLive; this helper is pure arithmetic over what it is given.
//
// Relative import (no @/ alias) so node --test can load it.

import type { Scorecard, ResultEntry, ScoringMode } from './types.ts'

export interface OccurrenceLeaderboard {
  occurrenceId: string
  scorecards: Scorecard[]
  entries: ResultEntry[]
}

export interface AggregateLeaderboard {
  scorecards: Scorecard[]
  entries: ResultEntry[]
}

const BOTTOM = Number.MAX_SAFE_INTEGER

// Sum two nullable running totals: null + null → null (no score yet); a real
// total + null → the real total; two reals → their sum. Used for gross/net
// totals and to-par, so a member who hasn't started one occurrence contributes
// nothing (not zero) to that aggregate line until they post.
function sumNullable(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null
  return (a ?? 0) + (b ?? 0)
}

function toParFor(card: Scorecard, scoringMode: ScoringMode): number | null {
  return scoringMode === 'gross' ? card.toParGross : card.toParNet
}

// Derive a member's name (prefer a non-empty one across occurrences).
function pickName(names: string[]): string {
  return names.find((n) => n && n.length > 0) ?? names[0] ?? ''
}

// Aggregate per-member totals across the given occurrence leaderboards. A
// member is included if they have a scorecard in ANY occurrence. Points are
// summed from matching entry rows (by key); an entry with no matching card is
// ignored (a no-show has no aggregate line). Entries are sorted by aggregate
// to-par for the scoring mode (nulls last) and assigned golf finishing
// positions (ties share a "T" label, e.g. 1, T2, T2, 4).
export function aggregateLeaderboard(
  occurrences: OccurrenceLeaderboard[],
  scoringMode: ScoringMode,
): AggregateLeaderboard {
  const cardByKey = new Map<string, Scorecard>()
  const namesByKey = new Map<string, string[]>()
  const pointsByKey = new Map<string, number>()

  for (const occ of occurrences) {
    for (const sc of occ.scorecards) {
      const key = sc.key
      let agg = cardByKey.get(key)
      if (!agg) {
        agg = {
          key,
          memberCardId: sc.memberCardId,
          name: sc.name,
          netTotal: null,
          grossTotal: null,
          toParNet: null,
          toParGross: null,
          holesCompleted: 0,
          scorecardStatus: null,
          isLive: false,
          holes: [], // invariant: never one 18-hole card
        }
        cardByKey.set(key, agg)
        namesByKey.set(key, [])
      }
      agg.grossTotal = sumNullable(agg.grossTotal, sc.grossTotal)
      agg.netTotal = sumNullable(agg.netTotal, sc.netTotal)
      agg.toParGross = sumNullable(agg.toParGross, sc.toParGross)
      agg.toParNet = sumNullable(agg.toParNet, sc.toParNet)
      agg.holesCompleted += sc.holesCompleted
      agg.isLive = agg.isLive || sc.isLive
      if (sc.memberCardId) agg.memberCardId = sc.memberCardId
      if (sc.name) namesByKey.get(key)!.push(sc.name)
    }
    for (const e of occ.entries) {
      // Only count points for members who have an aggregate card.
      if (!cardByKey.has(e.key)) continue
      if (e.points !== null && Number.isFinite(e.points)) {
        pointsByKey.set(e.key, (pointsByKey.get(e.key) ?? 0) + e.points)
      }
    }
  }

  // Sort by aggregate to-par (nulls last); stable tiebreak by name for
  // deterministic output across equal to-par.
  const sorted = [...cardByKey.values()].sort((a, b) => {
    const av = toParFor(a, scoringMode)
    const bv = toParFor(b, scoringMode)
    if (av === null && bv === null) return a.name.localeCompare(b.name)
    if (av === null) return 1
    if (bv === null) return -1
    return av - bv
  })

  const entries: ResultEntry[] = sorted.map((card) => ({
    key: card.key,
    name: pickName(namesByKey.get(card.key) ?? [card.name]),
    positionLabel: null,
    positionOrder: BOTTOM,
    points: pointsByKey.has(card.key) ? pointsByKey.get(card.key)! : null,
    purse: null, // aggregate has no purse → column auto-hides
    flight: null, // aggregate is unflighted
  }))

  // Assign finishing positions: ties share "T{rank}", next rank skips the tied
  // count (1, T2, T2, 4). Members with no aggregate to-par are unplaced ("--").
  let i = 0
  while (i < sorted.length) {
    const v = toParFor(sorted[i], scoringMode)
    if (v === null) {
      entries[i].positionLabel = null
      entries[i].positionOrder = BOTTOM
      i++
      continue
    }
    let j = i
    while (j < sorted.length && toParFor(sorted[j], scoringMode) === v) j++
    const rank = i + 1
    const tied = j - i > 1
    for (let k = i; k < j; k++) {
      entries[k].positionLabel = tied ? `T${rank}` : `${rank}`
      entries[k].positionOrder = rank
    }
    i = j
  }

  return { scorecards: sorted, entries }
}