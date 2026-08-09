// Idempotent precreation of configured special-occurrence rows (e.g. the Club
// Championship rounds 101/102) in igc_league_events. These rounds live outside
// the normal weekly cadence and are NOT seeded by the legacy event sync, so
// the reconcile pipeline would never see them as candidates without a row.
// This reads the config specialOccurrences and upserts a minimal row
// (league_key, week_number, event_name=label, event_date, gg_event_id,
// gg_round_id) so that:
//   - the live path reads the row's gg_event_id/gg_round_id hints (verified by
//     discovery) and resolves the round without needing the config fallback;
//   - reconcile listEvents returns the rows as candidates → discover → import
//     when GG marks the round completed → season-points rebuild counts them.
//
// UPSERT is `ignoreDuplicates: true` (ON CONFLICT DO NOTHING): a row that
// already exists (seeded, or a prior precreate) is LEFT UNTOUCHED so this never
// clobbers reconcile's discovery_state / source_finalized_at / durable_imported_at.
// week_number 101/102 are STORAGE ids; event_name is the user-facing label
// ("Club Championship - Round 1"), which the nav shows via the occurrence label
// (the mens labelRule is date-based, so event_name isn't displayed but is
// required NOT NULL on the table).
//
// DB access is injected so the row-building is unit-testable without Supabase.
// Relative imports (no @/ alias) for node --test.

import { getCompetitionConfig } from '../registry.ts'

export interface PrecreateRow {
  league_key: 'mens' | 'womens'
  week_number: number
  event_name: string
  event_date: string
  gg_event_id: string | null
  gg_round_id: string | null
  event_format: 'individual'
  discovery_state: 'pending'
}

export interface PrecreateDb {
  // Upsert one igc_league_events row, ignoring duplicates (ON CONFLICT DO
  // NOTHING). Returns whether a row was actually inserted (false if it already
  // existed). Throws on genuine DB error.
  upsertIgnoreDuplicates(row: PrecreateRow): Promise<{ inserted: boolean }>
}

// The rows a competition's configured special occurrences would contribute.
// Pure: derives league_key + the spec fields, ordered by week_number. Empty
// when the competition has no special occurrences.
export function precreateSpecialOccurrencesRows(competitionKey: string): PrecreateRow[] {
  const config = getCompetitionConfig(competitionKey)
  if (!config) return []
  const leagueKey: 'mens' | 'womens' = competitionKey === 'mens-league' ? 'mens' : 'womens'
  return (config.adapterConfig.specialOccurrences ?? [])
    .slice()
    .sort((a, b) => a.weekNumber - b.weekNumber)
    .map((s) => ({
      league_key: leagueKey,
      week_number: s.weekNumber,
      event_name: s.label,
      event_date: s.date,
      gg_event_id: s.ggEventId ?? null,
      gg_round_id: s.ggRoundId ?? null,
      event_format: 'individual' as const,
      discovery_state: 'pending' as const,
    }))
}

// Upsert each configured special-occurrence row, ignoring duplicates. Returns
// the count of rows actually inserted (0 means all already existed — still
// idempotent success). Throws on DB error so the reconcile loop surfaces it.
export async function precreateSpecialOccurrences(
  competitionKey: string,
  db: PrecreateDb,
): Promise<number> {
  const rows = precreateSpecialOccurrencesRows(competitionKey)
  let inserted = 0
  for (const row of rows) {
    const r = await db.upsertIgnoreDuplicates(row)
    if (r.inserted) inserted++
  }
  return inserted
}