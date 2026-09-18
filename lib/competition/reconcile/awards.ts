import type { ReconciliationAwards } from '../types.ts'

export interface AwardResult {
  competition: string
  flight_name: string | null
  member_card_id: string | null
  points: number | string | null
  purse: string | null
  synced_at: string | null
}

// Award publication follows score completion and sometimes official flights.
// Check each scoring mode/flight, not each golfer: non-winners legitimately
// have null points/purse. Season entries are a separate authoritative source;
// require coverage of all points recipients, without equating the two totals.
export function storedAwardsAreComplete(
  results: AwardResult[],
  seasonMemberIds: ReadonlySet<string>,
  durableImportedAt: string | null,
  policy: ReconciliationAwards,
): boolean {
  const durableMs = Date.parse(durableImportedAt ?? '')
  if (!Number.isFinite(durableMs) || results.length === 0) return false
  const flights = new Set(results.map((row) => row.flight_name ?? 'Overall'))
  for (const mode of ['gross', 'net']) {
    for (const flight of flights) {
      const rows = results.filter((row) => row.competition === mode && (row.flight_name ?? 'Overall') === flight)
      if (!rows.some((row) => Number(row.points) > 0)) return false
      if (policy.purse && !rows.some((row) => Number((row.purse ?? '').replace(/[$,\s]/g, '')) > 0)) return false
    }
  }
  for (const row of results) {
    const syncedMs = Date.parse(row.synced_at ?? '')
    if (!Number.isFinite(syncedMs) || syncedMs > durableMs) return false
    if (Number(row.points) > 0 && (!row.member_card_id || !seasonMemberIds.has(row.member_card_id))) return false
  }
  return true
}
