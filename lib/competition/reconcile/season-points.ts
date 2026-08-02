// FAITHFUL PORT of the existing season-points algorithm (scripts/sync-igc-league.mjs
// lines ~114–125, 259, 382–385, 437–500). The completed-round guard STAYS: only
// rounds GG marks completed AND that carry authoritative event.season_points
// are summed. Cumulative = sum across completed rounds AND both competitions
// (they share one season_point_category). previous_position is derived from
// `cumBeforeLast` — the cumulative through the SECOND-TO-LAST completed round
// (snapshotted before each round's accumulation) — NOT from a stored prior
// snapshot. Ranking uses `rankByTotalPoints` (competition ranking 1224: tied
// totals share the lower rank, next jumps). The snapshot is DELETE+REPLACED
// wholesale (no stale rows); if no points exist, the stale snapshot is deleted.
// See design spec §5 + revision (completed-round guard).
//
// DB access is injected so the accumulator is unit-testable. The production
// deps (Task 19F) read AUTHORITATIVE event.season_points per completed round —
// NOT igc_league_results.points (those are weekly per-competition points and are
// only used if proven identical to event.season_points, which they are not).
// events_played comes from igc_league_performances (weeks with non-null
// gross_scores); wins from igc_league_results flight_position=1.

export interface SeasonPointsRow {
  member_card_id: string
  player_name: string | null
  total_points: number
  position: number
  previous_position: number | null
  events_played: number
  wins: number
  points_behind: number
}

export interface SeasonPointsEntry {
  member_card_id: string
  total_points: number
  player_name?: string | null
}

export interface SeasonPointsDeps {
  // Completed rounds IN CHRONOLOGICAL ORDER, each carrying its authoritative
  // event.season_points entries (gross + net both present for individual weeks).
  listCompletedRoundsWithPoints(): Promise<SeasonPointsEntry[][]>
  // member_card_id → count of weeks with a non-null gross_scores performance.
  readEventsPlayed(): Promise<Map<string, number>>
  // member_card_id → count of flight_position=1 results.
  readWins(): Promise<Map<string, number>>
  // member_card_id → display name (from igc_league_members / performances).
  readNames(): Promise<Map<string, string | null>>
  // Wholesale delete the league's snapshot rows then insert the new set.
  replaceSnapshot(rows: SeasonPointsRow[]): Promise<unknown>
  // Delete the league's snapshot rows when there are no points (stale cleanup).
  deleteSnapshot(): Promise<unknown>
}

export interface RebuildInput {
  competitionKey: string
  deps: SeasonPointsDeps
}

// Competition ranking (1224): sort by total desc; tied totals share the lower
// rank; the next distinct total jumps by the number of tied entries it skipped.
// Verbatim semantics from the existing script's rankByTotalPoints.
export function rankByTotalPoints(totals: Map<string, number>): Map<string, number> {
  const ordered = [...totals.entries()].sort((a, b) => b[1] - a[1])
  const ranks = new Map<string, number>()
  let lastTotal = NaN
  let lastRank = 0
  let i = 0
  for (const [id, total] of ordered) {
    i++
    if (total === lastTotal) {
      ranks.set(id, lastRank)          // share the lower rank
    } else {
      ranks.set(id, i)
      lastTotal = total
      lastRank = i
    }
  }
  return ranks
}

export async function rebuildSeasonPoints(input: RebuildInput): Promise<SeasonPointsRow[]> {
  const rounds = await input.deps.listCompletedRoundsWithPoints()
  const eventsPlayed = await input.deps.readEventsPlayed()
  const wins = await input.deps.readWins()
  const names = await input.deps.readNames()

  // Accumulate cumulative totals per member, snapshotting cumBeforeLast before
  // each completed round's accumulation. After the loop, seasonCum holds the
  // sum through ALL completed rounds; cumBeforeLast holds the sum through the
  // SECOND-TO-LAST completed round (the snapshot taken before the last round).
  const seasonCum = new Map<string, number>()
  let cumBeforeLast = new Map<string, number>()
  for (const round of rounds) {
    cumBeforeLast = new Map(seasonCum)          // snapshot BEFORE this round's accumulation
    for (const sp of round) {
      const add = Number(sp.total_points) || 0
      seasonCum.set(sp.member_card_id, (seasonCum.get(sp.member_card_id) ?? 0) + add)
    }
  }

  if (seasonCum.size === 0) {
    await input.deps.deleteSnapshot()
    return []
  }

  const currentRankById = rankByTotalPoints(seasonCum)
  const prevRankById = cumBeforeLast.size > 0 ? rankByTotalPoints(cumBeforeLast) : new Map<string, number>()
  const leaderTotal = Math.max(...seasonCum.values())

  const rows: SeasonPointsRow[] = [...seasonCum.entries()].map(([member_card_id, total_points]) => ({
    member_card_id,
    player_name: names.get(member_card_id) ?? null,
    total_points,
    position: currentRankById.get(member_card_id) ?? 0,
    previous_position: prevRankById.has(member_card_id) ? (prevRankById.get(member_card_id) ?? null) : null,
    events_played: eventsPlayed.get(member_card_id) ?? 0,
    wins: wins.get(member_card_id) ?? 0,
    points_behind: leaderTotal - total_points,
  }))
  rows.sort((a, b) => a.position - b.position)
  await input.deps.replaceSnapshot(rows)
  return rows
}
