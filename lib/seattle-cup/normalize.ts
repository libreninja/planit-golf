// The seattle-cup normalizer — PURE. Maps a round's raw GG payload (scopes,
// tee sheet, team_points) to a normalized SeattleCupRoundSnapshot. No I/O, no
// env, no Supabase — fully testable against saved fixtures.
//
// GG-AUTHORITATIVE RULE (locked): GG supplies match scopes, sides, players,
// team identity, per-hole gross/net, handicap dots, running match state
// (hbh_match_status), final result (score), awarded points, and team-point
// totals. Planit normalizes + derives live running state as a FALLBACK and
// cross-checks. When GG and our derivation disagree, GG WINS for the rendered
// output (result/points come from GG) but the disagreement is surfaced as
// validationStatus + a ValidationIssue — never silently normalized away.
//
// SINGLES PRECEDENCE (locked): populated GG scopes are live/final competitive
// authority; the official 2026 published match schedule is pre-play competitive
// authority; tee-sheet foursomes are logistical metadata only. Tee data may
// enrich a known scheduled player with member-card identity, handicap dots, tee
// time, and starting hole, but it NEVER defines opponents.

import { matchNoFor, resolveTeamKey, resolveTeamKeys, getRoundDef, SEATTLE_CUP_TEAMS } from './config.ts'
import type { PublishedMatchDef, PublishedMatchPlayerDef } from './config.ts'
import type {
  Match, MatchPlayer, MatchHole, TeamStanding, SeattleCupRoundSnapshot,
  ValidationIssue, RoundNumber, Through, MatchStatus, MatchState, LeadSide,
  ValidationStatus, IdentityStatus, Format, HoleSideStatus, TeamKey,
  PublishedPairingGroup, TeamIdentityProvenance, TeamIdentitySource,
} from './types.ts'
import type {
  GGRoundRaw, GGScope, GGAggregate, GGIndividualResult, GGHoleData, GGMemberCard, GGPlayer,
} from './gg-shapes.ts'

const HOLES = 18

// "1 up" → 1, "5 up" → 5, "T"/"AS"/"All Square"/"Halved" → 0 (all-square),
// "" or nullish → null (no status / not played).
function parseLead(s: string | null | undefined): number | null {
  if (s == null) return null
  const str = String(s).trim()
  if (str === '' ) return null
  if (/^(t|as|all\s*square|halved|tied)$/i.test(str)) return 0
  const m = str.match(/^(\d+)\s*up$/i)
  if (m) return Number(m[1])
  // "1 up" handled above; anything else non-empty treat as 0 (defensive)
  return 0
}

function nonEmpty(s: string | null | undefined): boolean {
  return s != null && String(s).trim() !== ''
}

// SEMANTIC RULE (locked by the 2026 R3/R4 production incident): a GG aggregate
// `score` is a REAL MATCH RESULT only when it is one of GG's actual match-play
// result forms ("Tied"/"TIED", "N up", "N & M" — any spacing/case, see the 2025
// fixtures). GG also emits non-result values: "" on the trailing side of a
// decided match, and a bare "-" placeholder on paired-but-unplayed matches
// (recorded from production R3/R4 on 2026-08-28: every unplayed match carried
// score "-"). A placeholder or blank is NOT a result and must never imply
// match finality — pairings existing does not imply play. Real-but-unknown
// result strings still pass through: GG is authoritative and a mismatch is
// surfaced by the validation cross-check, so the denylist stays minimal.
const GG_SCORE_PLACEHOLDERS = new Set(['-'])

// Normalize a raw GG score into "a real result string, or null when GG is not
// reporting a result". This is the ONLY sanctioned way to read finality from a
// GG score.
export function normalizeSourceResult(s: string | null | undefined): string | null {
  if (s == null) return null
  const t = String(s).trim()
  if (t === '' || GG_SCORE_PLACEHOLDERS.has(t)) return null
  return t
}

// Public source-status fields preserve GG's non-empty value verbatim. GG pads
// unplayed/trailing-side entries with empty strings; expose those as null so a
// consumer can distinguish an available cumulative status from no status.
function sourceMatchStatus(s: string | null | undefined): string | null {
  return s == null || s === '' ? null : s
}

function num(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// Last hole index (0-based) where either side's hbh_match_status is non-empty.
function lastPlayedHole(a: GGAggregate, b: GGAggregate): number {
  const ha = a.hbh_match_status ?? []
  const hb = b.hbh_match_status ?? []
  const len = Math.max(ha.length, hb.length, HOLES)
  let last = -1
  for (let i = 0; i < len; i++) {
    if (nonEmpty(ha[i]) || nonEmpty(hb[i])) last = i
  }
  return last
}

// Combine both sides' hbh_match_status at a hole into an unambiguous lead. The
// two arrays are mirror images: at a played hole exactly one side shows "N up"
// (the other shows "" or "T"); both show "T" when all-square.
function leadAtHole(a: string | undefined, b: string | undefined): { side: LeadSide; by: number } | null {
  const la = parseLead(a)
  const lb = parseLead(b)
  if (la === null && lb === null) return null   // not played
  // Prefer the side showing "N up"; "T"/0 from either means all-square at this hole.
  if (la != null && la > 0) return { side: 'A', by: la }
  if (lb != null && lb > 0) return { side: 'B', by: lb }
  return { side: null, by: 0 }                  // all square
}

// Computed running lead for a match. For a FINAL match, the closing hole is the
// FIRST hole where the leader is up by MORE than the holes remaining (the match
// is decided there) — NOT the last hole played. GG's hbh_match_status keeps
// tracking after a match is closed (players often play out the card), so a "5 &
// 3" match's winner can show "7 up" at hole 18; using the last hole would
// mis-derive the result as "7 up". For a LIVE match, the last played hole IS the
// current running state.
interface RunningLead { leadSide: LeadSide; leadBy: number; holesPlayed: number; closingHole: number | null }
function computeRunningLead(a: GGAggregate, b: GGAggregate, isFinal: boolean): RunningLead {
  const ha = a.hbh_match_status ?? []
  const hb = b.hbh_match_status ?? []
  if (isFinal) {
    for (let i = 0; i < HOLES; i++) {
      const lead = leadAtHole(ha[i], hb[i])
      if (lead && lead.by > 0) {
        const remaining = HOLES - (i + 1)
        if (lead.by > remaining) {
          // Closed at hole i+1 with `by` up and `remaining` to play.
          return { leadSide: lead.side, leadBy: lead.by, holesPlayed: i + 1, closingHole: i }
        }
      }
    }
    // Went the full 18 (decided on the last or halved). Use hole 18's lead.
    const last = leadAtHole(ha[HOLES - 1], hb[HOLES - 1])
    return { leadSide: last?.side ?? null, leadBy: last?.by ?? 0, holesPlayed: HOLES, closingHole: HOLES - 1 }
  }
  // Live: last hole with any status.
  const lastIdx = lastPlayedHole(a, b)
  if (lastIdx < 0) return { leadSide: null, leadBy: 0, holesPlayed: 0, closingHole: null }
  const lead = leadAtHole(ha[lastIdx], hb[lastIdx])
  return { leadSide: lead?.side ?? null, leadBy: lead?.by ?? 0, holesPlayed: lastIdx + 1, closingHole: null }
}

function namePrefix(agg: GGAggregate): string {
  const name = agg.name ?? ''
  const idx = name.indexOf('(')
  return (idx > 0 ? name.slice(0, idx) : name).trim()
}

function cardIdOf(card: GGMemberCard | null | undefined): string | null {
  if (!card) return null
  return card.member_card_id_str ?? (card.member_card_id != null ? String(card.member_card_id) : null)
}

function sourceId(value: string | number | null | undefined): string | null {
  return value == null ? null : String(value)
}

interface ResolvedTeamIdentity {
  teamKey: TeamKey | null
  provenance: TeamIdentityProvenance
}

function pointsSummaryTeamKey(agg: GGAggregate, teamPoints: GGRoundRaw['teamPoints']): TeamKey | null {
  const aggregateId = sourceId(agg.points_summary_team_id)
  if (!aggregateId) return null
  const team = teamPoints?.teams?.find((candidate) =>
    sourceId(candidate.id_str) === aggregateId || sourceId(candidate.id) === aggregateId)
  return team ? resolveTeamKey(team.name ?? null, null) : null
}

function memberCardTeamKeys(agg: GGAggregate, teeSheet: GGRoundRaw['teeSheet']): TeamKey[] {
  const keys = new Set<TeamKey>()
  for (const card of agg.member_cards ?? []) {
    const cardId = cardIdOf(card)
    const teePlayer = cardId ? teeSheet.playersByCardId.get(cardId)?.player : null
    const key = teePlayer ? teePlayerTeam(teePlayer) : null
    if (key) keys.add(key)
  }
  return [...keys].sort()
}

// Competitive side identity precedence:
//   1. points_summary_team_id joined to team_points (stable GG team identity)
//   2. explicit aggregate name prefix
//   3. unanimous stable member-card → tee player.team_name joins
//   4. single-team affiliation as a last resort
// The first three are independently cross-checked. A genuine disagreement
// remains unresolved and produces a diagnostic instead of being guessed.
function resolveAggregateTeamIdentity(
  agg: GGAggregate,
  teeSheet: GGRoundRaw['teeSheet'],
  teamPoints: GGRoundRaw['teamPoints'],
): ResolvedTeamIdentity {
  const aggregateName = agg.name ?? null
  const aggregateNameTeamKey = resolveTeamKey(namePrefix(agg), null)
  const pointsSummaryTeamId = sourceId(agg.points_summary_team_id)
  const pointsKey = pointsSummaryTeamKey(agg, teamPoints)
  const memberKeys = memberCardTeamKeys(agg, teeSheet)
  const affiliationKeys = resolveTeamKeys(agg.affiliation)
  const strongCandidates = new Set<TeamKey>()
  if (pointsKey) strongCandidates.add(pointsKey)
  if (aggregateNameTeamKey) strongCandidates.add(aggregateNameTeamKey)
  if (memberKeys.length === 1) strongCandidates.add(memberKeys[0]!)

  let teamKey: TeamKey | null = null
  let source: TeamIdentitySource
  if (memberKeys.length > 1 || strongCandidates.size > 1) {
    source = 'conflict'
  } else if (pointsKey) {
    source = 'points-summary-team-id'
    teamKey = pointsKey
  } else if (aggregateNameTeamKey) {
    source = 'aggregate-name'
    teamKey = aggregateNameTeamKey
  } else if (memberKeys.length === 1) {
    source = 'member-card-team'
    teamKey = memberKeys[0]!
  } else if (affiliationKeys.length === 1) {
    source = 'affiliation'
    teamKey = affiliationKeys[0]!
  } else {
    source = 'unresolved'
  }

  return {
    teamKey,
    provenance: {
      source,
      pointsSummaryTeamId,
      pointsSummaryTeamKey: pointsKey,
      aggregateName,
      aggregateNameTeamKey,
      affiliation: agg.affiliation ?? null,
      affiliationTeamKeys: affiliationKeys,
      memberTeamKeys: memberKeys,
    },
  }
}

function scheduledTeamIdentity(source: TeamIdentitySource, teamKey: TeamKey | null): TeamIdentityProvenance {
  return {
    source: teamKey ? source : 'unresolved',
    pointsSummaryTeamId: null,
    pointsSummaryTeamKey: null,
    aggregateName: null,
    aggregateNameTeamKey: null,
    affiliation: null,
    affiliationTeamKeys: [],
    memberTeamKeys: [],
  }
}

// Find an individual_results entry for a member. individual_results[].member_id_str
// matches member_cards[].member_id_str (the roster member id), NOT member_card_id.
function findIndividual(agg: GGAggregate, memberIdStr: string | null): GGIndividualResult | null {
  if (!memberIdStr) return null
  const results = agg.individual_results ?? []
  return results.find((r) => r?.member_id_str === memberIdStr) ?? null
}

// Build the side's players from member_cards, enriched with names (individual
//_results → tee sheet → unresolved) + handicap dots (tee sheet). Identity status
// is GG-derived here; the server-side identity-enrichment step (identity.ts) may
// later upgrade gg-only → resolved by joining Planit members.
function buildPlayers(
  agg: GGAggregate,
  teamKey: TeamKey | null,
  teeSheet: GGRoundRaw['teeSheet'],
): MatchPlayer[] {
  const cards: GGMemberCard[] = agg.member_cards ?? []
  const out: MatchPlayer[] = []
  for (const card of cards) {
    const ggMemberCardId = cardIdOf(card)
    const memberIdStr = card?.member_id_str ?? null
    const ind = findIndividual(agg, memberIdStr)
    const tee = ggMemberCardId ? teeSheet.playersByCardId.get(ggMemberCardId) : null
    const teePlayer = tee?.player

    const name = ind?.name ?? teePlayer?.name ?? null
    const identityStatus: IdentityStatus = name ? 'gg-only' : 'unresolved'
    const memberTeamKey = teePlayer ? teePlayerTeam(teePlayer) : null

    out.push({
      ggMemberCardId,
      name: name ?? 'Unknown',
      teamKey: memberTeamKey ?? teamKey,
      courseHandicap: teePlayer?.course_handicap != null ? Number(teePlayer.course_handicap) : null,
      handicapDots: teePlayer?.handicap_dots_by_hole ?? [],
      grossScores: ind?.gross_scores ?? [],
      netScores: ind?.net_scores ?? [],
      identityStatus,
    })
  }
  return out
}

function teePlayerName(player: GGPlayer): string {
  return player.name
    ?? ([player.first_name, player.last_name].filter(Boolean).join(' ') || 'Unknown')
}

function teePlayerTeam(player: GGPlayer): TeamKey | null {
  return resolveTeamKey(player.team_name ?? '', player.team_name ?? null)
}

function buildPublishedPairingGroups(teeSheet: GGRoundRaw['teeSheet']): PublishedPairingGroup[] {
  return teeSheet.groups
    .map((group, index) => ({
      groupNo: index + 1,
      teeTime: group.tee_time ?? null,
      startingHole: group.hole != null ? String(group.hole) : null,
      players: (group.players ?? []).map((player) => ({
        ggMemberCardId: player.member_card_id != null ? String(player.member_card_id) : null,
        name: teePlayerName(player),
        teamKey: teePlayerTeam(player),
      })),
    }))
    .filter((group) => group.players.length > 0)
}

function scopePublishesCompetitiveSides(scope: GGScope | undefined): scope is GGScope {
  const sides = scope?.aggregates ?? []
  return sides.length >= 2
    && sides.slice(0, 2).every((side) => (side.member_cards ?? []).length > 0)
}

function buildPlayerFromTee(player: GGPlayer, teamKey: TeamKey): MatchPlayer {
  return {
    ggMemberCardId: player.member_card_id != null ? String(player.member_card_id) : null,
    name: teePlayerName(player),
    teamKey,
    courseHandicap: player.course_handicap != null ? Number(player.course_handicap) : null,
    handicapDots: player.handicap_dots_by_hole ?? [],
    grossScores: [],
    netScores: [],
    identityStatus: teePlayerName(player) === 'Unknown' ? 'unresolved' : 'gg-only',
  }
}

// Derive the result string from the running state (for cross-check vs GG score).
function deriveResult(leadBy: number, holesPlayed: number): string | null {
  if (holesPlayed === 0) return null
  const holesRemaining = HOLES - holesPlayed
  if (leadBy === 0) return 'Tied'
  if (holesRemaining === 0) return `${leadBy} up`
  return `${leadBy} & ${holesRemaining}`
}

// Normalize a result string for comparison: lowercase, collapse spaces,
// treat tied/halved/all-square as equivalent.
function normalizeResult(s: string | null | undefined): string {
  if (!s) return ''
  const t = s.trim().toLowerCase().replace(/\s+/g, ' ')
  if (['t', 'as', 'all square', 'halved', 'tied', 'tied match'].includes(t)) return 'tied'
  return t
}

function usesSideHandicapDots(format: Format): boolean {
  return format === 'scramble' || format === 'chapman'
}

// GG has no explicit scheduled side-dot field. In Scramble/Chapman tee sheets
// it duplicates the side allocation onto both teammates. Treat that as side
// authority only after validating the complete 18-hole arrays as unanimous.
// Empty arrays mean the source is unavailable, while an agreed all-zero array
// is an authoritative no-stroke allocation.
function resolveScheduledSideDots(
  players: MatchPlayer[],
  matchNo: number,
  side: 'A' | 'B',
  validationIssues: ValidationIssue[],
): number[] | null {
  if (players.length !== 2) return null
  const allocations = players.map((player) => player.handicapDots)
  if (allocations.every((allocation) => allocation.length === 0)) return null

  const lengths = allocations.map((allocation) => allocation.length)
  const invalidHoles = new Set<number>()
  const differingHoles = new Set<number>()
  const inspectedLength = Math.max(HOLES, ...lengths)
  for (let i = 0; i < inspectedLength; i++) {
    const values = allocations.map((allocation) => allocation[i])
    if (values.some((value) => typeof value !== 'number' || !Number.isInteger(value) || value < 0)) {
      invalidHoles.add(i + 1)
    }
    if (values[0] !== values[1]) differingHoles.add(i + 1)
  }

  if (lengths.some((length) => length !== HOLES) || invalidHoles.size > 0 || differingHoles.size > 0) {
    validationIssues.push({
      matchNo,
      kind: 'side-handicap-dots-conflict',
      detail: `side ${side}: teammate allocations unresolved; lengths=${lengths.join('/')} differingHoles=${[...differingHoles].join(',') || 'none'} invalidHoles=${[...invalidHoles].join(',') || 'none'}`,
    })
    return null
  }

  // Safe to copy either array only after complete structural equality. Never
  // add the duplicate arrays: each value is already the side's stroke count.
  return allocations[0]!.slice()
}

function buildHoles(
  a: GGAggregate,
  b: GGAggregate,
  holeData: GGHoleData | null,
  scheduledDotsA: number[] | null = null,
  scheduledDotsB: number[] | null = null,
): MatchHole[] {
  const ha = a.hbh_match_status ?? []
  const hb = b.hbh_match_status ?? []
  const netA = a.net_scores ?? []
  const netB = b.net_scores ?? []
  const grossA = a.gross_scores ?? []
  const grossB = b.gross_scores ?? []
  const pars = holeData?.par ?? null
  const si = holeData?.handicap ?? null
  const holes: MatchHole[] = []
  for (let i = 0; i < HOLES; i++) {
    const nA = netA[i] ?? null
    const nB = netB[i] ?? null
    const gA = grossA[i] ?? null
    const gB = grossB[i] ?? null
    // Played side effective strokes = gross − net (GG already applied dots to
    // net) and always win. Before scoring, fall back to the validated scheduled
    // side allocation. Null means neither authority is available; zero is an
    // explicit no-stroke value and must not collapse to null.
    const dotsA = gA != null && nA != null
      ? Math.max(0, gA - nA)
      : scheduledDotsA?.[i] ?? null
    const dotsB = gB != null && nB != null
      ? Math.max(0, gB - nB)
      : scheduledDotsB?.[i] ?? null

    let winner: HoleSideStatus = null
    // A hole is "played/decided" when both side nets are present OR hbh shows a
    // non-empty status at this hole. Compare nets to decide the winner.
    const played = (nA != null && nB != null) || nonEmpty(ha[i]) || nonEmpty(hb[i])
    if (played && nA != null && nB != null) {
      if (nA < nB) winner = 'A'
      else if (nB < nA) winner = 'B'
      else winner = 'AS'
    } else if (played) {
      // Scores missing but hbh present — infer winner from hbh if decisive.
      const lead = leadAtHole(ha[i], hb[i])
      // hbh is cumulative, not per-hole; we can't reliably get per-hole winner
      // from it alone, so mark AS-like as null (decided-by-scores unavailable).
      winner = lead && lead.by === 0 ? 'AS' : null
    }

    holes.push({
      n: i + 1,
      par: pars?.[i] ?? null,
      strokeIndex: si?.[i] ?? null,
      netA: nA, netB: nB, grossA: gA, grossB: gB,
      dotsA, dotsB, winner,
      sourceMatchStatusA: sourceMatchStatus(ha[i]),
      sourceMatchStatusB: sourceMatchStatus(hb[i]),
    })
  }
  return holes
}

function buildMatch(
  scope: GGScope,
  slotIndex: number,
  round: RoundNumber,
  format: Format,
  course: string,
  teeSheet: GGRoundRaw['teeSheet'],
  teamPoints: GGRoundRaw['teamPoints'],
  validationIssues: ValidationIssue[],
): Match {
  const aggs = scope.aggregates ?? []
  const a = aggs[0] ?? {}
  const b = aggs[1] ?? {}
  const matchNo = matchNoFor(round, slotIndex)

  const identityA = resolveAggregateTeamIdentity(a, teeSheet, teamPoints)
  const identityB = resolveAggregateTeamIdentity(b, teeSheet, teamPoints)
  const teamA = identityA.teamKey
  const teamB = identityB.teamKey

  const playersA = buildPlayers(a, teamA, teeSheet)
  const playersB = buildPlayers(b, teamB, teeSheet)
  const scheduledDotsA = usesSideHandicapDots(format)
    ? resolveScheduledSideDots(playersA, matchNo, 'A', validationIssues)
    : null
  const scheduledDotsB = usesSideHandicapDots(format)
    ? resolveScheduledSideDots(playersB, matchNo, 'B', validationIssues)
    : null

  // Finality: a match is final only when a side carries a REAL GG match result
  // (winner shows "5 & 3", loser ""; a halved match shows "Tied" on both).
  // GG's "-" placeholder on paired-but-unplayed matches (and blank strings)
  // normalize to null — a pairing is not a result. See normalizeSourceResult.
  const sourceResultRaw = normalizeSourceResult(a.score) ?? normalizeSourceResult(b.score)
  const isFinal = sourceResultRaw != null

  const holes = buildHoles(a, b, teeSheet.holeData, scheduledDotsA, scheduledDotsB)
  const { leadSide, leadBy, holesPlayed } = computeRunningLead(a, b, isFinal)

  // Points: NULL until GG awards them. Final → from GG (validate sum === 1).
  const srcPtsA = num(a.points)
  const srcPtsB = num(b.points)
  const pointsA = isFinal ? srcPtsA : null
  const pointsB = isFinal ? srcPtsB : null

  // through: not-started | holesPlayed | final.
  const through: Through = isFinal ? 'final' : (holesPlayed === 0 ? 'not-started' : holesPlayed)

  // status + matchState.
  const hasPlayEvidence = holesPlayed > 0 || holes.some((hole) =>
    hole.netA != null || hole.netB != null || hole.grossA != null || hole.grossB != null)
  let status: MatchStatus
  if (isFinal) status = 'final'
  else if (hasPlayEvidence) status = 'live'
  else status = 'scheduled'

  let matchState: MatchState
  if (status === 'scheduled') matchState = 'tbd'
  else if (isFinal) matchState = 'final'
  else if (leadBy === 0) matchState = 'all-square'
  else {
    // dormie: leader is up exactly the number of holes remaining.
    const holesRemaining = HOLES - holesPlayed
    matchState = leadBy === holesRemaining && holesRemaining > 0 ? 'dormie' : (leadSide === 'A' ? 'a-up' : 'b-up')
  }

  // Derived result + validation cross-check (GG authoritative; never overwrite).
  const derivedResult = isFinal ? deriveResult(leadBy, holesPlayed) : null
  let validationStatus: ValidationStatus
  if (status === 'scheduled') validationStatus = 'tbd'
  else if (!isFinal) validationStatus = 'unverifiable'
  else if (sourceResultRaw == null) validationStatus = 'unverifiable'
  else if (normalizeResult(sourceResultRaw) === normalizeResult(derivedResult)) validationStatus = 'match'
  else {
    validationStatus = 'mismatch'
    validationIssues.push({
      matchNo, kind: 'result-mismatch',
      detail: `GG="${sourceResultRaw}" derived="${derivedResult}"`,
    })
  }

  // Points integrity (final must sum to 1 under the 1/0.5/0 rule).
  if (isFinal) {
    const sum = (pointsA ?? 0) + (pointsB ?? 0)
    if (Math.abs(sum - 1) > 0.001) {
      validationIssues.push({
        matchNo, kind: 'points-mismatch',
        detail: `final points A=${pointsA} B=${pointsB} sum=${sum} (expected 1)`,
      })
    }
  }

  // Identity diagnostics.
  for (const p of [...playersA, ...playersB]) {
    if (p.identityStatus === 'unresolved') {
      validationIssues.push({ matchNo, kind: 'identity-unresolved', detail: `card=${p.ggMemberCardId}` })
    } else if (p.identityStatus === 'ambiguous') {
      validationIssues.push({ matchNo, kind: 'identity-ambiguous', detail: `card=${p.ggMemberCardId}` })
    }
  }

  for (const [side, identity] of [['A', identityA], ['B', identityB]] as const) {
    if (identity.provenance.source === 'conflict') {
      validationIssues.push({
        matchNo,
        kind: 'team-identity-conflict',
        detail: `side ${side}: points=${identity.provenance.pointsSummaryTeamKey ?? 'none'} aggregate=${identity.provenance.aggregateNameTeamKey ?? 'none'} members=${identity.provenance.memberTeamKeys.join(',') || 'none'}`,
      })
    } else if (identity.provenance.source === 'unresolved') {
      validationIssues.push({
        matchNo,
        kind: 'team-identity-unresolved',
        detail: `side ${side}: aggregate=${identity.provenance.aggregateName ?? 'none'} points_summary_team_id=${identity.provenance.pointsSummaryTeamId ?? 'none'}`,
      })
    }
  }
  if (teamA && teamB && teamA === teamB) {
    validationIssues.push({
      matchNo,
      kind: 'same-team-match',
      detail: `competitive match resolved both sides as ${teamA}`,
    })
  }
  for (const [side, sideTeam, players] of [
    ['A', teamA, playersA], ['B', teamB, playersB],
  ] as const) {
    for (const player of players) {
      if (sideTeam && player.teamKey && player.teamKey !== sideTeam) {
        validationIssues.push({
          matchNo,
          kind: 'player-team-mismatch',
          detail: `side ${side}: card=${player.ggMemberCardId ?? 'none'} player=${player.teamKey} side=${sideTeam}`,
        })
      }
    }
  }

  // Tee time / starting hole from the tee sheet (logistical — joined by any side
  // player's card id; NOT a match signal).
  let teeTime: string | null = null
  let startingHole: number | string | null = null
  for (const p of [...playersA, ...playersB]) {
    const t = p.ggMemberCardId ? teeSheet.playersByCardId.get(p.ggMemberCardId) : null
    if (t) { teeTime = t.teeTime ?? teeTime; startingHole = t.hole ?? startingHole; break }
  }

  return {
    matchNo, round, format, course,
    teamA: teamA ?? null, teamB: teamB ?? null,
    teamAIdentity: identityA.provenance,
    teamBIdentity: identityB.provenance,
    playersA, playersB, teeTime, startingHole, holes,
    through, status, matchState, leadSide, leadBy,
    result: sourceResultRaw ?? null,
    pointsA, pointsB,
    sourceResult: sourceResultRaw ?? null,
    derivedResult,
    validationStatus,
  }
}

// For paired formats only, a tee-sheet group containing exactly two known
// teams with two players per team is itself the published 2v2 pairing. It may
// populate scheduled sides, but never score/result/points. Singles deliberately
// never calls this function: its four-player groups are logistical only.
function buildPairedTeeSheetMatch(
  group: GGRoundRaw['teeSheet']['groups'][number],
  slotIndex: number,
  round: RoundNumber,
  format: Format,
  course: string,
  holeData: GGHoleData | null,
  validationIssues: ValidationIssue[],
): Match | null {
  const players = group.players ?? []
  const teamOrder: TeamKey[] = []
  const byTeam = new Map<TeamKey, GGPlayer[]>()
  for (const player of players) {
    const teamKey = teePlayerTeam(player)
    if (!teamKey) return null
    if (!byTeam.has(teamKey)) {
      byTeam.set(teamKey, [])
      teamOrder.push(teamKey)
    }
    byTeam.get(teamKey)!.push(player)
  }
  if (players.length !== 4 || teamOrder.length !== 2) return null
  const teamA = teamOrder[0]!
  const teamB = teamOrder[1]!
  const sideA = byTeam.get(teamA) ?? []
  const sideB = byTeam.get(teamB) ?? []
  if (sideA.length !== 2 || sideB.length !== 2) return null

  const match = buildTbdMatch(slotIndex, round, format, course, { teamA, teamB }, holeData)
  const playersA = sideA.map((player) => buildPlayerFromTee(player, teamA))
  const playersB = sideB.map((player) => buildPlayerFromTee(player, teamB))
  const matchNo = matchNoFor(round, slotIndex)
  const scheduledDotsA = usesSideHandicapDots(format)
    ? resolveScheduledSideDots(playersA, matchNo, 'A', validationIssues)
    : null
  const scheduledDotsB = usesSideHandicapDots(format)
    ? resolveScheduledSideDots(playersB, matchNo, 'B', validationIssues)
    : null
  return {
    ...match,
    teamAIdentity: scheduledTeamIdentity('tee-sheet-team', teamA),
    teamBIdentity: scheduledTeamIdentity('tee-sheet-team', teamB),
    playersA,
    playersB,
    teeTime: group.tee_time ?? null,
    startingHole: group.hole ?? null,
    holes: buildHoles({}, {}, holeData, scheduledDotsA, scheduledDotsB),
  }
}

// TBD match from a schedule slot (no GG scope yet). Players empty, points null.
// `slot` may carry real team keys (pre-play scheduled slot from config) or null
// teams (generic shortfall TBD — an un-scored slot whose pairing is unknown).
function buildTbdMatch(slotIndex: number, round: RoundNumber, format: Format, course: string, slot: { teamA: TeamKey | null; teamB: TeamKey | null }, holeData: GGHoleData | null): Match {
  const holes: MatchHole[] = []
  const pars = holeData?.par ?? null
  const si = holeData?.handicap ?? null
  for (let i = 0; i < HOLES; i++) {
    holes.push({ n: i + 1, par: pars?.[i] ?? null, strokeIndex: si?.[i] ?? null,
      netA: null, netB: null, grossA: null, grossB: null, dotsA: null, dotsB: null,
      sourceMatchStatusA: null, sourceMatchStatusB: null, winner: null })
  }
  return {
    matchNo: matchNoFor(round, slotIndex), round, format, course,
    teamA: slot.teamA, teamB: slot.teamB, playersA: [], playersB: [],
    teamAIdentity: scheduledTeamIdentity('configured-schedule', slot.teamA),
    teamBIdentity: scheduledTeamIdentity('configured-schedule', slot.teamB),
    teeTime: null, startingHole: null, holes,
    through: 'not-started', status: 'scheduled', matchState: 'tbd',
    leadSide: null, leadBy: 0, result: null, pointsA: null, pointsB: null,
    sourceResult: null, derivedResult: null, validationStatus: 'tbd',
  }
}

function normalizedPersonName(name: string): string {
  const commaParts = name.trim().split(',').map((part) => part.trim()).filter(Boolean)
  const displayOrder = commaParts.length === 2 ? `${commaParts[1]} ${commaParts[0]}` : name
  return displayOrder.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

interface PublishedTeeIdentity {
  player: GGPlayer
  teeTime: string | null
  startingHole: number | string | null
}

// Identity-only join for an already-known official opponent. The name + stable
// team constraint prevents a namesake on another team from being attached. It
// is deliberately not usable to construct sides or infer an opponent.
function findPublishedPlayerInTeeSheet(
  published: PublishedMatchPlayerDef,
  teeSheet: GGRoundRaw['teeSheet'],
): PublishedTeeIdentity | null {
  if (published.ggMemberCardId) {
    const byId = teeSheet.playersByCardId.get(published.ggMemberCardId)
    if (byId) return { player: byId.player, teeTime: byId.teeTime, startingHole: byId.hole }
  }

  const expectedName = normalizedPersonName(published.name)
  const candidates: PublishedTeeIdentity[] = []
  for (const group of teeSheet.groups) {
    for (const player of group.players ?? []) {
      if (teePlayerTeam(player) !== published.teamKey) continue
      if (normalizedPersonName(teePlayerName(player)) !== expectedName) continue
      candidates.push({ player, teeTime: group.tee_time ?? null, startingHole: group.hole ?? null })
    }
  }
  return candidates.length === 1 ? candidates[0]! : null
}

function buildPublishedPlayer(
  published: PublishedMatchPlayerDef,
  teeIdentity: PublishedTeeIdentity | null,
): MatchPlayer {
  const teePlayer = teeIdentity?.player
  const cardId = teePlayer?.member_card_id != null
    ? String(teePlayer.member_card_id)
    : published.ggMemberCardId ?? null
  return {
    ggMemberCardId: cardId,
    name: published.name,
    teamKey: published.teamKey,
    courseHandicap: num(teePlayer?.course_handicap),
    handicapDots: teePlayer?.handicap_dots_by_hole ?? [],
    grossScores: [],
    netScores: [],
    // The official sheet is authoritative identity even without a GG card-id
    // join. If joined, identity.ts can later upgrade this through Planit's
    // existing roster infrastructure.
    identityStatus: 'gg-only',
  }
}

function buildOfficialPublishedMatch(
  published: PublishedMatchDef,
  slotIndex: number,
  round: RoundNumber,
  format: Format,
  course: string,
  teeSheet: GGRoundRaw['teeSheet'],
): Match {
  const base = buildTbdMatch(slotIndex, round, format, course, {
    teamA: published.playerA.teamKey,
    teamB: published.playerB.teamKey,
  }, teeSheet.holeData)
  const teeA = findPublishedPlayerInTeeSheet(published.playerA, teeSheet)
  const teeB = findPublishedPlayerInTeeSheet(published.playerB, teeSheet)
  return {
    ...base,
    matchNo: published.matchNo,
    teamAIdentity: scheduledTeamIdentity('published-schedule', published.playerA.teamKey),
    teamBIdentity: scheduledTeamIdentity('published-schedule', published.playerB.teamKey),
    playersA: [buildPublishedPlayer(published.playerA, teeA)],
    playersB: [buildPublishedPlayer(published.playerB, teeB)],
    teeTime: teeA?.teeTime ?? teeB?.teeTime ?? null,
    startingHole: teeA?.startingHole ?? teeB?.startingHole ?? null,
  }
}

function validateScopeAgainstPublishedMatch(
  match: Match,
  published: PublishedMatchDef,
  validationIssues: ValidationIssue[],
): void {
  const expected = new Map<TeamKey, PublishedMatchPlayerDef>([
    [published.playerA.teamKey, published.playerA],
    [published.playerB.teamKey, published.playerB],
  ])
  const actual = new Map<TeamKey, MatchPlayer[]>()
  if (match.teamA) actual.set(match.teamA, match.playersA)
  if (match.teamB) actual.set(match.teamB, match.playersB)

  const mismatches: string[] = []
  for (const [teamKey, expectedPlayer] of expected) {
    const players = actual.get(teamKey)
    if (!players) {
      mismatches.push(`expected team ${teamKey} is absent from GG scope`)
      continue
    }
    if (players.length !== 1) {
      mismatches.push(`${teamKey}: published one player, GG has ${players.length}`)
      continue
    }
    const ggPlayer = players[0]!
    if (expectedPlayer.ggMemberCardId && ggPlayer.ggMemberCardId) {
      if (expectedPlayer.ggMemberCardId !== ggPlayer.ggMemberCardId) {
        mismatches.push(`${teamKey}: published=${expectedPlayer.name}/${expectedPlayer.ggMemberCardId} GG=${ggPlayer.name}/${ggPlayer.ggMemberCardId}`)
      }
    } else if (ggPlayer.name !== 'Unknown'
      && normalizedPersonName(ggPlayer.name) !== normalizedPersonName(expectedPlayer.name)) {
      mismatches.push(`${teamKey}: published=${expectedPlayer.name} GG=${ggPlayer.name}`)
    }
  }
  for (const teamKey of actual.keys()) {
    if (!expected.has(teamKey)) mismatches.push(`unexpected GG team ${teamKey}`)
  }
  if (mismatches.length > 0) {
    validationIssues.push({
      matchNo: match.matchNo,
      kind: 'published-schedule-mismatch',
      detail: mismatches.join('; '),
    })
  }
}

function emptyStanding(teamKey: TeamKey): TeamStanding {
  return { teamKey, roundPoints: 0, totalPoints: 0, matchesPlayed: 0, matchesWon: 0, matchesHalved: 0, matchesLost: 0 }
}

function buildRoundStandings(matches: Match[]): TeamStanding[] {
  const stand: Record<string, TeamStanding> = {}
  for (const t of Object.values(SEATTLE_CUP_TEAMS)) stand[t.key] = emptyStanding(t.key)
  for (const m of matches) {
    if (m.status !== 'final') continue
    const pa = m.pointsA ?? 0, pb = m.pointsB ?? 0
    const sa = m.teamA ? stand[m.teamA] : undefined
    const sb = m.teamB ? stand[m.teamB] : undefined
    if (sa) { sa.matchesPlayed++; sa.roundPoints += pa; if (pa > 0.5) sa.matchesWon++; else if (pa === 0.5) sa.matchesHalved++; else sa.matchesLost++ }
    if (sb) { sb.matchesPlayed++; sb.roundPoints += pb; if (pb > 0.5) sb.matchesWon++; else if (pb === 0.5) sb.matchesHalved++; else sb.matchesLost++ }
  }
  return Object.values(stand).sort((a, b) => b.roundPoints - a.roundPoints)
}

function teamKeyFromName(name: string | undefined): TeamKey | null {
  if (!name) return null
  return resolveTeamKey(name, name)
}

function buildOverallStandings(teamPoints: GGRoundRaw['teamPoints'], roundStandings: TeamStanding[], validationIssues: ValidationIssue[]): TeamStanding[] {
  const byTeam: Record<string, TeamStanding> = {}
  for (const t of Object.values(SEATTLE_CUP_TEAMS)) byTeam[t.key] = emptyStanding(t.key)
  // Authoritative cumulative total comes from GG team_points.total_points.
  if (teamPoints?.teams?.length) {
    for (const tt of teamPoints.teams) {
      const key = teamKeyFromName(tt.name)
      if (!key) continue
      byTeam[key].totalPoints = num(tt.total_points) ?? num(tt.round_points) ?? 0
      byTeam[key].roundPoints = num(tt.round_points) ?? byTeam[key].roundPoints
    }
    // Cross-check: GG round_points vs our match-derived roundPoints.
    const derived = new Map<TeamKey, number>()
    for (const s of roundStandings) derived.set(s.teamKey, s.roundPoints)
    for (const tt of teamPoints.teams) {
      const key = teamKeyFromName(tt.name)
      if (!key) continue
      const ggRound = num(tt.round_points) ?? 0
      const ours = derived.get(key) ?? 0
      if (Math.abs(ggRound - ours) > 0.001) {
        validationIssues.push({ matchNo: 0, kind: 'round-points-mismatch',
          detail: `${key}: GG round_points=${ggRound} match-derived=${ours}` })
      }
    }
  } else {
    // No team_points (round not posted / not started): overall = round standings.
    for (const s of roundStandings) byTeam[s.teamKey].totalPoints = s.roundPoints
  }
  // Carry round W/H/L into overall for display.
  for (const s of roundStandings) {
    if (byTeam[s.teamKey]) { byTeam[s.teamKey].matchesPlayed = s.matchesPlayed; byTeam[s.teamKey].matchesWon = s.matchesWon; byTeam[s.teamKey].matchesHalved = s.matchesHalved; byTeam[s.teamKey].matchesLost = s.matchesLost }
  }
  return Object.values(byTeam).sort((a, b) => b.totalPoints - a.totalPoints)
}

// GG's team_points.round_points is the AUTHORITATIVE per-round point total —
// it reconciles to the official GG leaderboard. When GG's round_points and our
// per-match sum disagree (GG's match-level point view and its round_points
// aggregate can differ — a known GG-side inconsistency), GG wins for the
// rendered round standings; the disagreement is still surfaced as a
// round-points-mismatch validation issue by buildOverallStandings (which
// cross-checks against the per-match derived value). W/H/L counts stay from the
// matches: GG team_points carries no W/H/L breakdown. No team_points (round
// not posted / not started) → keep the per-match derived standings as-is.
function applyAuthoritativeRoundPoints(derived: TeamStanding[], teamPoints: GGRoundRaw['teamPoints']): TeamStanding[] {
  if (!teamPoints?.teams?.length) return derived
  const auth = new Map<TeamKey, number>()
  for (const tt of teamPoints.teams) {
    const key = teamKeyFromName(tt.name)
    if (key && tt.round_points != null) auth.set(key, num(tt.round_points) ?? 0)
  }
  if (!auth.size) return derived
  return derived.map((s) => auth.has(s.teamKey)
    ? { ...s, roundPoints: auth.get(s.teamKey)! }
    : s
  ).sort((a, b) => b.roundPoints - a.roundPoints)
}

// Derive the round result status from the MATCHES (the reliable signal), not
// from GG's event-level status. GG's tournament payload often omits
// completed_at/status even for a fully-scored round (the 2025 Fourball fixture
// has neither), so the match states are authoritative: all-final → final; any
// scored (final or live) → live; all scheduled/TBD → not-started.
function deriveResultStatus(_upstream: GGRoundRaw['upstreamStatus'], matches: Match[]): SeattleCupRoundSnapshot['resultStatus'] {
  if (matches.length === 0) return 'unknown'
  const finals = matches.filter((m) => m.status === 'final').length
  const live = matches.filter((m) => m.status === 'live').length
  if (finals === matches.length) return 'final'
  if (finals > 0 || live > 0) return 'live'
  return 'not-started'
}

function deriveRoundStatus(
  matches: Match[],
  pairingsPublished: boolean,
): SeattleCupRoundSnapshot['roundStatus'] {
  if (matches.length === 0) return 'unknown'
  const finals = matches.filter((match) => match.status === 'final').length
  const live = matches.some((match) => match.status === 'live')
  if (finals === matches.length) return 'final'
  if (finals > 0 || live) return 'live'
  if (pairingsPublished) return 'pairings-available'
  return 'scheduled'
}

export interface NormalizeResult {
  snapshot: Omit<SeattleCupRoundSnapshot, 'fetchedAt' | 'showingLastKnown'>
}

export function normalizeRound(round: RoundNumber, raw: GGRoundRaw): NormalizeResult {
  const def = getRoundDef(round)
  if (!def) throw new Error(`unknown seattle-cup round ${round}`)
  const validationIssues: ValidationIssue[] = []
  const scopes = raw.scopes ?? []
  const officialPublishedMatches = def.officialPublishedMatches ?? []
  const officialSchedulePublished = officialPublishedMatches.length > 0
  const pairingGroups = buildPublishedPairingGroups(raw.teeSheet)
  const scopesPublishPlayers = scopes.some((scope) => (scope.aggregates ?? [])
    .some((aggregate) => (aggregate.member_cards ?? []).length > 0))
  const pairingsPublished = officialSchedulePublished || pairingGroups.length > 0 || scopesPublishPlayers
  const competitionScopesAvailable = scopes.some(scopePublishesCompetitiveSides)

  const matches: Match[] = []
  let teeSheetCompetitiveMatches = 0
  if (competitionScopesAvailable) {
    // A populated scope owns its match completely, including opponents, live
    // state, result, and points. Published R4 data is validation/fill for an
    // unpopulated slot only; it can never overwrite a populated GG scope.
    for (let i = 0; i < def.matchCount; i++) {
      const scope = scopes[i]
      const published = officialPublishedMatches[i]
      if (scopePublishesCompetitiveSides(scope)) {
        const match = buildMatch(scope, i, round, def.format, def.course, raw.teeSheet, raw.teamPoints, validationIssues)
        matches.push(match)
        if (published) validateScopeAgainstPublishedMatch(match, published, validationIssues)
      } else if (published) {
        matches.push(buildOfficialPublishedMatch(published, i, round, def.format, def.course, raw.teeSheet))
      } else {
        matches.push(buildTbdMatch(i, round, def.format, def.course, { teamA: null, teamB: null }, raw.teeSheet.holeData))
      }
    }
  } else if (def.format === 'singles') {
    // The official match sheet, not the tee foursomes, publishes pre-play 1v1
    // opponents. A tee-sheet join may enrich identity/logistics only.
    for (let i = 0; i < def.matchCount; i++) {
      const published = officialPublishedMatches[i]
      matches.push(published
        ? buildOfficialPublishedMatch(published, i, round, def.format, def.course, raw.teeSheet)
        : buildTbdMatch(i, round, def.format, def.course, { teamA: null, teamB: null }, raw.teeSheet.holeData))
    }
  } else {
    // Paired formats may use strict 2-team/2-player tee groups as a pre-play
    // pairing fallback. Invalid/partial groups remain configured TBD slots.
    for (let i = 0; i < def.matchCount; i++) {
      const fromTee = raw.teeSheet.groups[i]
        ? buildPairedTeeSheetMatch(raw.teeSheet.groups[i], i, round, def.format, def.course, raw.teeSheet.holeData, validationIssues)
        : null
      if (fromTee) {
        matches.push(fromTee)
        teeSheetCompetitiveMatches++
      } else {
        const slot = def.matchSlots[i] ?? { teamA: null, teamB: null }
        matches.push(buildTbdMatch(i, round, def.format, def.course, slot, raw.teeSheet.holeData))
      }
    }
  }

  const roundStandingsDerived = buildRoundStandings(matches)
  const overallStandings = buildOverallStandings(raw.teamPoints, roundStandingsDerived, validationIssues)
  // GG round_points is authoritative for the rendered round standings.
  const roundStandings = applyAuthoritativeRoundPoints(roundStandingsDerived, raw.teamPoints)
  const resultStatus = deriveResultStatus(raw.upstreamStatus, matches)
  const scheduledMatchesAvailable = officialSchedulePublished || teeSheetCompetitiveMatches > 0
  const competitionMatchesAvailable = competitionScopesAvailable || scheduledMatchesAvailable
  const roundStatus = deriveRoundStatus(matches, pairingsPublished)

  return {
    snapshot: {
      round, format: def.format, course: def.course,
      eventName: raw.eventName ?? `Seattle Cup 2026 — ${def.format}`,
      pairingsPublished, competitionMatchesAvailable, scheduledMatchesAvailable,
      competitionScopesAvailable, pairingGroups, roundStatus,
      matches, roundStandings, overallStandings,
      resultStatus, validationIssues,
    },
  }
}
