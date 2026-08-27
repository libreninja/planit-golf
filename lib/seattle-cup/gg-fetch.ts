// Server-side Golf Genius fetch for a Seattle Cup round. I/O only — no
// normalization. 404-tolerant (a not-posted-yet round/tournament returns null,
// NOT a throw) so pre-play rounds resolve to "not_started" rather than blanking
// the snapshot. Genuine upstream failures (network, auth 401/403, 5xx) THROW so
// the orchestration layer's stale-while-error can serve last-known data.
//
// A round has multiple tournaments (the per-format competition, e.g. "Fourball",
// plus the field aggregate "Seattle Cup 2026"). We pick the one named for the
// round's format — the authoritative match-scope source — never the field
// aggregate. See ground-truth report §2.

import { makeGolfGeniusRequestOptional } from '../gg/client.ts'
import { getRoundDef } from './config.ts'
import type { Format, RoundNumber } from './types.ts'
import type {
  GGRoundRaw, GGTournamentPayload, GGTeamPoints, GGPairingGroup, GGTeeSheet, GGHoleData,
} from './gg-shapes.ts'

export type GGClient = (endpoint: string) => Promise<any>

export interface FetchRoundInput {
  round: RoundNumber
  ggClient?: GGClient   // inject for tests; production uses makeGolfGeniusRequestOptional
}

// Pick the per-format tournament id from a round's tournament list. Prefers the
// tournament whose name matches the round format (case-insensitive) AND is not
// the field aggregate (result_scope rs_field). Falls back to the first
// format-name match. Returns null when the round has no format tournament yet.
export function pickFormatTournamentId(list: any[], format: Format): string | null {
  const fmtLower = format.toLowerCase()
  const candidates: { id: string; name: string; isField: boolean }[] = []
  for (const x of list) {
    const e = x?.event ?? x?.tournament ?? x
    const id = e?.id ?? x?.id
    const name: string = e?.name ?? x?.name ?? ''
    if (!id || !name) continue
    if (name.toLowerCase().includes(fmtLower)) {
      const scope = e?.result_scope ?? x?.result_scope
      candidates.push({ id: String(id), name, isField: scope === 'rs_field' })
    }
  }
  if (!candidates.length) return null
  // Prefer a non-field format match (the per-round competition) over a field
  // aggregate that happens to share the name.
  const perRound = candidates.filter((c) => !c.isField)
  return (perRound[0] ?? candidates[0]).id
}

function asArray(list: any, key: string): any[] {
  return Array.isArray(list) ? list : (list?.[key] ?? [])
}

// Flatten the tee_sheet pairing groups into the normalized view the normalizer
// consumes. Each group arrives wrapped as {pairing_group: {...}}. Players are
// indexed by member_card_id (== scope member_cards[].member_card_id_str) so the
// normalizer can join logistical data (tee time, dots, hole_data) onto scope
// aggregates WITHOUT ever treating a foursome as a match. The Singles invariant
// is enforced in the normalizer, not here — the tee sheet is purely a lookup.
function normalizeTeeSheet(raw: any): GGTeeSheet {
  const top = Array.isArray(raw) ? raw : (raw?.pairing_groups ?? raw?.tee_sheet ?? [])
  const groups: GGPairingGroup[] = []
  let holeData: GGHoleData | null = null
  const playersByCardId = new Map<string, { player: any; teeTime: string | null; hole: number | string | null }>()

  for (const g of top) {
    const pg = g?.pairing_group ?? g
    const players = pg?.players ?? []
    const teeTime = pg?.tee_time ?? null
    const hole = pg?.hole ?? null
    groups.push({ tee_time: teeTime, hole, date: pg?.date ?? null, players })
    for (const p of players) {
      const cardId = p?.member_card_id != null ? String(p.member_card_id) : null
      if (cardId) {
        if (!playersByCardId.has(cardId)) {
          playersByCardId.set(cardId, { player: p, teeTime, hole })
        }
      }
      // Capture hole_data from the first player's tee (par/strokeIndex are
      // course-level, identical across players in the round).
      if (!holeData && p?.tee?.hole_data) holeData = p.tee.hole_data
    }
  }
  return { groups, holeData, playersByCardId }
}

// Derive upstream status from actual lifecycle evidence. Published players in
// scopes or the tee sheet mean pairings_available; only score/result data means
// in_progress. Named pre-play scopes must not make the round live.
function hasPlayedScope(scopes: any[]): boolean {
  return scopes.some((scope) => (scope?.aggregates ?? []).some((aggregate: any) => {
    if (aggregate?.score != null && String(aggregate.score).trim() !== '') return true
    if ((aggregate?.hbh_match_status ?? []).some((status: unknown) => status != null && String(status).trim() !== '')) return true
    return [...(aggregate?.net_scores ?? []), ...(aggregate?.gross_scores ?? [])]
      .some((score) => score != null && score !== '')
  }))
}

function deriveUpstream(
  payload: GGTournamentPayload | null,
  scopes: any[],
  teeSheet: GGTeeSheet,
): 'completed' | 'in_progress' | 'pairings_available' | 'not_started' | 'unknown' {
  if (payload?.event?.completed_at) return 'completed'
  if (payload?.event?.status === 'completed') return 'completed'
  if (hasPlayedScope(scopes)) return 'in_progress'
  if (scopes.length > 0 || teeSheet.groups.some((group) => (group.players ?? []).length > 0)) return 'pairings_available'
  return 'not_started'
}

export async function fetchRoundRaw(input: FetchRoundInput): Promise<GGRoundRaw> {
  const def = getRoundDef(input.round)
  if (!def) throw new Error(`unknown seattle-cup round ${input.round}`)
  const { ggEventId, ggRoundId, format } = def

  const ggClient = input.ggClient ?? (async (endpoint: string) => makeGolfGeniusRequestOptional({ endpoint }))

  // 1. Tournaments list → per-format tournament id.
  const tListRaw = await ggClient(`/events/${ggEventId}/rounds/${ggRoundId}/tournaments`)
  const tArr = asArray(tListRaw, 'tournaments')
  const formatTournamentId = pickFormatTournamentId(tArr, format)

  // 2. Tournament .json (scopes) + tee_sheet + team_points — independent fetches.
  // A 404 on any (round not fully posted) → null; the normalizer degrades to TBD.
  const [tournamentPayload, teeSheetRaw, teamPoints, roundDetail] = await Promise.all([
    formatTournamentId
      ? (await ggClient(`/events/${ggEventId}/rounds/${ggRoundId}/tournaments/${formatTournamentId}.json`)) as GGTournamentPayload | null
      : null,
    ggClient(`/events/${ggEventId}/rounds/${ggRoundId}/tee_sheet`),
    ggClient(`/events/${ggEventId}/rounds/${ggRoundId}/team_points`) as Promise<GGTeamPoints | null>,
    ggClient(`/events/${ggEventId}/rounds/${ggRoundId}`),
  ])

  const scopes = tournamentPayload?.event?.scopes ?? []
  const teeSheet = normalizeTeeSheet(teeSheetRaw)
  const roundDate = (roundDetail?.round?.date ?? roundDetail?.date ?? null) as string | null
  const eventName = (tournamentPayload?.event?.name ?? roundDetail?.round?.name ?? null) as string | null
  const upstreamStatus = deriveUpstream(tournamentPayload, scopes, teeSheet)

  return {
    ggEventId, ggRoundId, eventName, roundDate, upstreamStatus,
    tournamentPayload, scopes, teeSheet, teamPoints,
  }
}
