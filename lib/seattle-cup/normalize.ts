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
// SINGLES INVARIANT (locked): tournament scopes define matches; tee-sheet
// groups do NOT. The tee sheet is a logistical lookup (tee time, starting hole,
// per-player dots, course hole_data) joined onto scope aggregates by
// member_card_id. A Singles foursome of 4 (one per team) is 2 separate 1v1
// matches that live in the scopes — this normalizer builds matches from scopes
// only, so the 2025 foursome→4-way bug is structurally impossible here.

import { matchNoFor, resolveTeamKey, getRoundDef, SEATTLE_CUP_TEAMS } from './config.ts'
import type {
  Match, MatchPlayer, MatchHole, TeamStanding, SeattleCupRoundSnapshot,
  ValidationIssue, RoundNumber, Through, MatchStatus, MatchState, LeadSide,
  ValidationStatus, IdentityStatus, Format, HoleSideStatus, TeamKey,
} from './types.ts'
import type {
  GGRoundRaw, GGScope, GGAggregate, GGIndividualResult, GGHoleData, GGMemberCard,
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
  teamKey: TeamKey,
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

    out.push({
      ggMemberCardId,
      name: name ?? 'Unknown',
      teamKey,
      courseHandicap: teePlayer?.course_handicap != null ? Number(teePlayer.course_handicap) : null,
      handicapDots: teePlayer?.handicap_dots_by_hole ?? [],
      identityStatus,
    })
  }
  return out
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

function buildHoles(a: GGAggregate, b: GGAggregate, holeData: GGHoleData | null): MatchHole[] {
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
    // Side effective strokes = gross − net (GG already applied dots to net).
    const dotsA = gA != null && nA != null ? Math.max(0, gA - nA) : null
    const dotsB = gB != null && nB != null ? Math.max(0, gB - nB) : null

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
  validationIssues: ValidationIssue[],
): Match {
  const aggs = scope.aggregates ?? []
  const a = aggs[0] ?? {}
  const b = aggs[1] ?? {}
  const matchNo = matchNoFor(round, slotIndex)

  const teamA = resolveTeamKey(namePrefix(a), a.affiliation ?? null)
  const teamB = resolveTeamKey(namePrefix(b), b.affiliation ?? null)

  const playersA = buildPlayers(a, teamA ?? 'interbay', teeSheet)
  const playersB = buildPlayers(b, teamB ?? 'interbay', teeSheet)

  // Finality: a match is final when EITHER side has a non-empty GG `score`.
  // (Winner shows "5 & 3"; loser shows "". A halved match shows "Tied" on both.)
  const sourceResultRaw = nonEmpty(a.score) ? a.score : (nonEmpty(b.score) ? b.score : null)
  const isFinal = sourceResultRaw != null

  const holes = buildHoles(a, b, teeSheet.holeData)
  const { leadSide, leadBy, holesPlayed } = computeRunningLead(a, b, isFinal)

  // Points: NULL until GG awards them. Final → from GG (validate sum === 1).
  const srcPtsA = num(a.points)
  const srcPtsB = num(b.points)
  const pointsA = isFinal ? srcPtsA : null
  const pointsB = isFinal ? srcPtsB : null

  // through: not-started | holesPlayed | final.
  const through: Through = isFinal ? 'final' : (holesPlayed === 0 ? 'not-started' : holesPlayed)

  // status + matchState.
  const hasPlayers = playersA.length > 0 || playersB.length > 0
  let status: MatchStatus
  if (isFinal) status = 'final'
  else if (!hasPlayers) status = 'scheduled'
  else status = 'live'

  let matchState: MatchState
  if (!hasPlayers && !isFinal) matchState = 'tbd'
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
  if (!hasPlayers && !isFinal) validationStatus = 'tbd'
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

  // Tee time / starting hole from the tee sheet (logistical — joined by any side
  // player's card id; NOT a match signal).
  let teeTime: string | null = null
  let startingHole: number | null = null
  for (const p of [...playersA, ...playersB]) {
    const t = p.ggMemberCardId ? teeSheet.playersByCardId.get(p.ggMemberCardId) : null
    if (t) { teeTime = t.teeTime ?? teeTime; startingHole = t.hole ?? startingHole; break }
  }

  return {
    matchNo, round, format, course,
    teamA: teamA ?? null, teamB: teamB ?? null,
    playersA, playersB, teeTime, startingHole, holes,
    through, status, matchState, leadSide, leadBy,
    result: sourceResultRaw ?? null,
    pointsA, pointsB,
    sourceResult: sourceResultRaw ?? null,
    derivedResult,
    validationStatus,
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
      netA: null, netB: null, grossA: null, grossB: null, dotsA: null, dotsB: null, winner: null })
  }
  return {
    matchNo: matchNoFor(round, slotIndex), round, format, course,
    teamA: slot.teamA, teamB: slot.teamB, playersA: [], playersB: [],
    teeTime: null, startingHole: null, holes,
    through: 'not-started', status: 'scheduled', matchState: 'tbd',
    leadSide: null, leadBy: 0, result: null, pointsA: null, pointsB: null,
    sourceResult: null, derivedResult: null, validationStatus: 'tbd',
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

export interface NormalizeResult {
  snapshot: Omit<SeattleCupRoundSnapshot, 'fetchedAt' | 'showingLastKnown'>
}

export function normalizeRound(round: RoundNumber, raw: GGRoundRaw): NormalizeResult {
  const def = getRoundDef(round)
  if (!def) throw new Error(`unknown seattle-cup round ${round}`)
  const validationIssues: ValidationIssue[] = []
  const scopes = raw.scopes ?? []

  const matches: Match[] = []
  if (scopes.length > 0) {
    // Real (or in-progress) scopes — build matches from them. GG creates all
    // matchCount scopes when a round's tournament is set up, so the common case
    // is 0 scopes (pre-play) or matchCount scopes (live/final). For robustness
    // against a shortfall, the remaining slots are filled with generic TBD
    // (unknown pairing) so the round always renders matchCount matches.
    scopes.forEach((scope, i) => {
      matches.push(buildMatch(scope, i, round, def.format, def.course, raw.teeSheet, validationIssues))
    })
    for (let i = scopes.length; i < def.matchCount; i++) {
      matches.push(buildTbdMatch(i, round, def.format, def.course, { teamA: null, teamB: null }, raw.teeSheet.holeData))
    }
  } else {
    // Pre-play: emit the scheduled TBD slots from config. No GG players — these
    // are placeholders, never promoted to real pairings.
    def.matchSlots.forEach((slot, i) => {
      matches.push(buildTbdMatch(i, round, def.format, def.course, slot, raw.teeSheet.holeData))
    })
  }

  const roundStandingsDerived = buildRoundStandings(matches)
  const overallStandings = buildOverallStandings(raw.teamPoints, roundStandingsDerived, validationIssues)
  // GG round_points is authoritative for the rendered round standings.
  const roundStandings = applyAuthoritativeRoundPoints(roundStandingsDerived, raw.teamPoints)
  const resultStatus = deriveResultStatus(raw.upstreamStatus, matches)

  return {
    snapshot: {
      round, format: def.format, course: def.course,
      eventName: raw.eventName ?? `Seattle Cup 2026 — ${def.format}`,
      matches, roundStandings, overallStandings,
      resultStatus, validationIssues,
    },
  }
}