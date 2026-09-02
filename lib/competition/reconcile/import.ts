// Idempotent import of one occurrence's finalized performances + results
// (BOTH competitions). Upserts are keyed by natural keys so re-runs overwrite
// cleanly. GG client + DB writer are injected for deterministic tests.
// Mirrors the existing sync's write shape; do not change the scoring math
// (helpers come from gg-helpers.ts).
//
// CORRECTION 4 & 6: the occurrence's GG ids (event, round, gross/net
// tournament) arrive in `resolved: ResolvedOccurrence` — the typed result of
// discovery. Import fetches each competition's results .json by the resolved
// tournament id; it does NOT re-list tournaments and does NOT accept
// placeholder id strings ('' / null synthesized as if real). On success it
// sets durable_imported_at AND durable_source_version (the source version it
// captured) so the durable-current version-equality contract (Task 11) can fire.

import { parsePosition, parseIntOrNull, countBirdiesDoubles } from './gg-helpers.ts'
import { normalizeTournament } from '../adapters/golfgenius/normalize.ts'
import type { GolfGeniusAdapterConfig, ResolvedOccurrence } from '../types.ts'
import type { GGClient } from '../adapters/golfgenius/discovery.ts'

export interface ImportDb {
  upsertEvent(row: Record<string, unknown>): Promise<{ ok: boolean; id?: string | null; event_name?: string | null; event_date?: string | null }>
  upsertPerformances(rows: Record<string, unknown>[]): Promise<{ ok: boolean }>
  upsertResults(rows: Record<string, unknown>[]): Promise<{ ok: boolean }>
  // Optional snapshot pruning. Production supplies these so a later official
  // snapshot removes players retained only by an earlier Overall import;
  // existing lightweight test adapters remain source-compatible.
  prunePerformances?(week: number, retainedPlayerNames: string[]): Promise<{ ok: boolean }>
  pruneResults?(week: number, importedAtIso: string, competitions: Array<'gross' | 'net'>): Promise<{ ok: boolean }>
  setDurableImported(week: number, atIso: string, sourceVersion: string | null): Promise<{ ok: boolean }>
  // Optional: persist per-round authoritative event.season_points entries.
  // Production (reconcile.ts importDb) provides it; the 19B unit-test fake
  // omits it (optional chaining → no-op), so 19B's write-bucket count is
  // unchanged. See Task 19F.1.
  upsertSeasonPointEntries?(rows: Record<string, unknown>[]): Promise<{ ok: boolean }>
  pruneSeasonPointEntries?(week: number, retainedMemberIds: string[]): Promise<{ ok: boolean }>
}

export interface ImportInput {
  competitionKey: string
  resolved: ResolvedOccurrence
  adapterConfig: GolfGeniusAdapterConfig
  ggClient: GGClient
  db: ImportDb
  nowIso: string
}

export interface ImportSummary { performances: number; results: number; seasonPointEntries: number; durable: boolean }

export async function importOccurrence(input: ImportInput): Promise<ImportSummary> {
  const leagueKey = input.competitionKey === 'mens-league' ? 'mens' : 'womens'
  const { ggEventId, ggRoundId, grossTournamentId, netTournamentId, weekNumber, sourceFinalizedAt, sourceVersion, eventName, roundDate } = input.resolved

  // Persist the event row FIRST and capture its id, so the performance + result
  // rows can carry event_id (parity with the original sync, which set event_id
  // from the event row it fetched/created). No placeholders — the GG ids came
  // from discovery. status reflects that this occurrence was durably imported.
  const evRes = await input.db.upsertEvent({
    league_key: leagueKey, week_number: weekNumber,
    gg_event_id: ggEventId, gg_round_id: ggRoundId,
    gg_gross_tournament_id: grossTournamentId, gg_net_tournament_id: netTournamentId,
    event_format: 'individual', discovery_state: 'discovered',
    source_finalized_at: sourceFinalizedAt, source_version: sourceVersion,
    status: 'finalized',
  })
  const eventId = evRes?.id ?? null
  // event_name/event_date are NOT NULL on igc_league_performances. Discovery
  // leaves resolved.eventName null on the hint path, so source them from the
  // merged event row (which always carries them). roundDate is the fallback.
  const eventNameFinal = evRes?.event_name ?? eventName ?? null
  const eventDateFinal = evRes?.event_date ?? roundDate ?? null

  // Course par for the (secondary) birdie/double-bogey counts only. Not critical:
  // on any fetch failure parData stays [] → counts are 0 (parity with the
  // original sync's try/catch, "par data not critical").
  let parData: (number | null)[] = []
  try {
    const coursesData: any = await input.ggClient(`/events/${ggEventId}/courses`)
    parData = coursesData?.courses?.[0]?.tees?.[0]?.hole_data?.par || []
  } catch { /* par data not critical */ }

  // One perf row per player (unique on league_key, week_number, player_name —
  // parity with the original sync's onConflict). Scorecard facts are identical
  // across the gross + net tournaments for a player (same round); the
  // competition-specific placement fields (flight_name, position_label,
  // flight_position, points, purse) reflect the NET tournament, because the
  // original sync upserted per-aggregate with net processed last → net wins.
  // We replicate that by overwriting placement fields on the net pass.
  const perfByKey = new Map<string, Record<string, unknown>>()
  const resultRows: Record<string, unknown>[] = []
  const seasonPointsCum = new Map<string, number>()
  const importedCompetitions: Array<'gross' | 'net'> = []

  for (const competition of ['gross', 'net'] as const) {
    const tId = competition === 'gross' ? grossTournamentId : netTournamentId
    if (!tId) continue
    importedCompetitions.push(competition)
    const payload = await input.ggClient(`/events/${ggEventId}/rounds/${ggRoundId}/tournaments/${tId}.json`)
    const norm = normalizeTournament(payload, competition)
    for (const [flightName, entries] of norm.entriesByFlight) {
      for (const e of entries) {
        const card = norm.scorecards.get(e.key)
        // Result row (per-competition placement) — parity with original sync.
        resultRows.push({
          league_key: leagueKey, week_number: weekNumber, event_id: eventId,
          member_card_id: card?.memberCardId ?? null,
          player_name: e.name, competition,
          flight_name: flightName, position_label: e.positionLabel,
          flight_position: parsePosition(e.positionLabel),
          points: e.points, purse: e.purse,
          synced_at: input.nowIso,
        })
        // Perf row (scorecard fact) — one per player, net-wins placement.
        const key = e.name // unique constraint is on player_name
        const existing = perfByKey.get(key)
        if (existing) {
          // Net pass overwrites placement fields (net processed last → net wins).
          // weekly_position is overwritten too, so it stays consistent with
          // position_label/flight_position (parity with the original sync's
          // full-row upsert, where net's parsed position won).
          existing.flight_name = flightName
          existing.position_label = e.positionLabel
          existing.flight_position = parsePosition(e.positionLabel)
          existing.points = e.points
          existing.purse = e.purse
          existing.weekly_position = parsePosition(e.positionLabel) ?? 9999
          continue
        }
        const grossScores = card ? card.holes.map((h) => h.gross) : []
        const netScores = card ? card.holes.map((h) => h.net) : []
        const { birdies, doubleBogeys } = countBirdiesDoubles(netScores, parData)
        perfByKey.set(key, {
          league_key: leagueKey, week_number: weekNumber, event_id: eventId,
          player_name: e.name, member_card_id: card?.memberCardId ?? null,
          flight_name: flightName,
          position_label: e.positionLabel,
          flight_position: parsePosition(e.positionLabel),
          points: e.points,
          gross_scores: grossScores,
          to_par_net: card ? card.holes.map((h) => h.toPar) : [],
          to_par_gross: card ? card.holes.map((h) => h.toParGross) : [],
          net_total: card ? parseIntOrNull(card.netTotal) : null,
          gross_total: card ? parseIntOrNull(card.grossTotal) : null,
          to_par_net_total: card ? parseIntOrNull(card.toParNet) : null,
          to_par_gross_total: card ? parseIntOrNull(card.toParGross) : null,
          purse: e.purse,
          holes_completed: card ? card.holesCompleted : 0,
          scorecard_status: card ? card.scorecardStatus : null,
          event_name: eventNameFinal,
          event_date: eventDateFinal,
          double_bogeys: doubleBogeys, birdies: birdies,
          weekly_position: parsePosition(e.positionLabel) ?? 9999,
          net_scores: netScores,
        })
      }
    }
    // Accumulate this tournament's event.season_points (weekly points awarded
    // this round) per member. Both competitions' arrays are summed; the UNIQUE
    // (league, week, member) constraint means we write ONE combined row after
    // the loop. Women's returns [] → no-op. (Task 19F.1.)
    if (input.resolved.upstreamStatus === 'completed' && Array.isArray((payload as any)?.event?.season_points)) {
      for (const sp of (payload as any).event.season_points) {
        if (!sp?.member_card_id) continue
        seasonPointsCum.set(sp.member_card_id, (seasonPointsCum.get(sp.member_card_id) ?? 0) + (Number(sp.total_points) || 0))
      }
    }
  }

  const perfRows = [...perfByKey.values()]
  // INVARIANT: a completed/finalized round MUST produce performance rows. Zero
  // rows means import built nothing (normalize produced no entries, or the GG
  // payload was empty/malformed). Previously this fell through to
  // setDurableImported, stamping a finalized round durable while
  // igc_league_performances stayed empty — the exact weeks-17/18 contract
  // violation. Fail loudly BEFORE any required write so the week cannot become
  // durable, and reconcile surfaces it in errors[].
  if (perfRows.length === 0 && input.resolved.upstreamStatus === 'completed') {
    throw new Error(`wk${weekNumber}: completed round produced 0 performance rows (gross=${grossTournamentId} net=${netTournamentId})`)
  }
  if (perfRows.length) {
    await input.db.upsertPerformances(perfRows)
    await input.db.prunePerformances?.(weekNumber, perfRows.map((row) => String(row.player_name)))
  }
  if (resultRows.length) {
    await input.db.upsertResults(resultRows)
    await input.db.pruneResults?.(weekNumber, input.nowIso, importedCompetitions)
  }
  // Per-round authoritative season-points entries (durable source for
  // rebuildSeasonPoints). Optional on the db — skipped (no-op) when the caller
  // doesn't provide it, e.g. the 19B unit test. (Task 19F.1.)
  const seasonPointRows: Record<string, unknown>[] = [...seasonPointsCum.entries()].map(([member_card_id, total_points]) => ({
    league_key: leagueKey, week_number: weekNumber,
    member_card_id, total_points, player_name: null,
  }))
  if (seasonPointRows.length) {
    await input.db.upsertSeasonPointEntries?.(seasonPointRows)
    await input.db.pruneSeasonPointEntries?.(
      weekNumber,
      seasonPointRows.map((row) => String(row.member_card_id)),
    )
  }
  // Record both the import time AND the source version captured, so the
  // durable-current version-equality branch (Task 11) can compare
  // source_version vs durable_source_version.
  await input.db.setDurableImported(weekNumber, input.nowIso, sourceVersion)
  return { performances: perfRows.length, results: resultRows.length, seasonPointEntries: seasonPointRows.length, durable: true }
}
