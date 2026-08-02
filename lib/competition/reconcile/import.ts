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

import { parsePosition } from './gg-helpers.ts'
import { normalizeTournament } from '../adapters/golfgenius/normalize.ts'
import type { GolfGeniusAdapterConfig, ResolvedOccurrence } from '../types.ts'
import type { GGClient } from '../adapters/golfgenius/discovery.ts'

export interface ImportDb {
  upsertEvent(row: Record<string, unknown>): Promise<{ ok: boolean }>
  upsertPerformances(rows: Record<string, unknown>[]): Promise<{ ok: boolean }>
  upsertResults(rows: Record<string, unknown>[]): Promise<{ ok: boolean }>
  setDurableImported(week: number, atIso: string, sourceVersion: string | null): Promise<{ ok: boolean }>
}

export interface ImportInput {
  competitionKey: string
  resolved: ResolvedOccurrence
  adapterConfig: GolfGeniusAdapterConfig
  ggClient: GGClient
  db: ImportDb
  nowIso: string
}

export interface ImportSummary { performances: number; results: number; durable: boolean }

export async function importOccurrence(input: ImportInput): Promise<ImportSummary> {
  const leagueKey = input.competitionKey === 'mens-league' ? 'mens' : 'womens'
  const { ggEventId, ggRoundId, grossTournamentId, netTournamentId, weekNumber, sourceFinalizedAt, sourceVersion } = input.resolved

  const perfRows: Record<string, unknown>[] = []
  const resultRows: Record<string, unknown>[] = []

  for (const competition of ['gross', 'net'] as const) {
    const tId = competition === 'gross' ? grossTournamentId : netTournamentId
    if (!tId) continue
    const payload = await input.ggClient(`/events/${ggEventId}/rounds/${ggRoundId}/tournaments/${tId}.json`)
    const norm = normalizeTournament(payload, competition)
    for (const [flightName, entries] of norm.entriesByFlight) {
      for (const e of entries) {
        const card = norm.scorecards.get(e.key)
        resultRows.push({
          league_key: leagueKey, week_number: weekNumber,
          member_card_id: card?.memberCardId ?? e.key,
          player_name: e.name, competition,
          flight_name: flightName, position_label: e.positionLabel,
          flight_position: parsePosition(e.positionLabel), points: e.points, purse: e.purse,
        })
        if (card && !perfRows.find((r) => r.member_card_id === card.memberCardId)) {
          perfRows.push({
            league_key: leagueKey, week_number: weekNumber,
            member_card_id: card.memberCardId, player_name: card.name,
            flight_name: flightName, position_label: card.scorecardStatus,
            holes_completed: card.holesCompleted,
            gross_scores: card.holes.map((h) => h.gross),
            net_scores: card.holes.map((h) => h.net),
            to_par_net: card.holes.map((h) => h.toPar),
            to_par_gross: card.holes.map((h) => h.toPar),
            net_total: card.netTotal, gross_total: card.grossTotal,
            to_par_net_total: card.toParNet, to_par_gross_total: card.toParGross,
          })
        }
      }
    }
  }

  // Persist the resolved ids + source finalization/version on the event row —
  // no placeholders (the ids came from discovery). status reflects that this
  // occurrence has been durably imported.
  await input.db.upsertEvent({
    league_key: leagueKey, week_number: weekNumber,
    gg_event_id: ggEventId, gg_round_id: ggRoundId,
    gg_gross_tournament_id: grossTournamentId, gg_net_tournament_id: netTournamentId,
    event_format: 'individual', discovery_state: 'discovered',
    source_finalized_at: sourceFinalizedAt, source_version: sourceVersion,
    status: 'finalized',
  })
  if (perfRows.length) await input.db.upsertPerformances(perfRows)
  if (resultRows.length) await input.db.upsertResults(resultRows)
  // Record both the import time AND the source version captured, so the
  // durable-current version-equality branch (Task 11) can compare
  // source_version vs durable_source_version.
  await input.db.setDurableImported(weekNumber, input.nowIso, sourceVersion)
  return { performances: perfRows.length, results: resultRows.length, durable: true }
}
