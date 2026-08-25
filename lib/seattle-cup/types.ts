// Seattle Cup 2026 match-play domain. NO Golf Genius payload shapes here — this
// is the normalized contract seattlecup.golf renders and /api/seattle-cup/live
// returns. One Match model serves all four formats; playersA/playersB is an
// array (2 for paired formats, 1 for Singles). See ground-truth report §4.
//
// Authoritative-source rule: GG supplies final results + points; Planit
// normalizes, enriches identity, and derives live running state as a FALLBACK.
// When GG and our derivation disagree, GG wins for the rendered output but the
// disagreement is surfaced as validationStatus + logged — never silently
// normalized away. See ground-truth report §5 + the locked scoring rule.

export type TeamKey = 'interbay' | 'jackson-park' | 'bill-wright' | 'west-seattle'
export type Format = 'fourball' | 'scramble' | 'chapman' | 'singles'
export type RoundNumber = 1 | 2 | 3 | 4

// Per-hole running match status from one side's perspective (GG
// `hbh_match_status`). "T" = all square, "N up" = this side leads by N, "" =
// hole not yet played / no status. The two sides' arrays are mirror images;
// normalizeMatchState combines both for an unambiguous read.
export type HoleSideStatus = 'A' | 'B' | 'AS' | null   // which side won the hole (null = halved-as or not played)

export interface MatchPlayer {
  ggMemberCardId: string | null   // GG member_card_id_str — stable identity
  name: string                     // display name (GG roster / tee sheet)
  teamKey: TeamKey
  courseHandicap: number | null    // GG course_handicap (match-adjusted)
  handicapDots: number[]           // per-hole stroke dots (GG handicap_dots_by_hole)
  identityStatus: IdentityStatus
  // Optional enrichment from Planit members/roster (GHIN etc.). Absent when the
  // player resolved from GG alone.
  planitMemberId?: string | null
  ghin?: string | null
}

export type IdentityStatus =
  | 'resolved'        // joined to a Planit member / roster row
  | 'gg-only'         // known to GG, no Planit enrichment (still a real, named player)
  | 'ambiguous'       // multiple Planit candidates — needs human review
  | 'unresolved'      // could not resolve a name — diagnostic, never silently guessed
  | 'tbd'             // scheduled slot not yet populated (pre-play)

export interface MatchHole {
  n: number                 // 1..18
  par: number | null
  strokeIndex: number | null  // hole handicap (1..18)
  netA: number | null        // side A best-ball / team net (GG aggregate net_scores)
  netB: number | null
  grossA: number | null      // side A best-ball / team gross
  grossB: number | null
  dotsA: number | null       // handicap strokes applied on this hole (side A) — display
  dotsB: number | null
  winner: HoleSideStatus     // 'A' | 'B' | 'AS' (halved) | null (not yet decided)
}

export type MatchStatus = 'scheduled' | 'live' | 'final'

// through: 'not-started' (0 holes), N (holes played, 1..18), or 'final'.
// Never the bare number 0 — see locked contract adjustment.
export type Through = 'not-started' | number | 'final'

export type MatchState =
  | 'tbd'          // scheduled, no players/scores yet
  | 'all-square'
  | 'a-up'         // side A leads
  | 'b-up'         // side B leads
  | 'dormie'       // leader is dormie (holes up === holes remaining)
  | 'final'        // closed

export type LeadSide = 'A' | 'B' | null

export type ValidationStatus =
  | 'tbd'            // scheduled — nothing to validate
  | 'match'          // GG result and derived result agree
  | 'mismatch'       // GG result and derived result DISAGREE — GG wins output, logged
  | 'unverifiable'   // no GG result yet (live) — derived state used; nothing to cross-check

export interface Match {
  matchNo: number            // 1..60, schedule-stable (R1 1-12, R2 13-24, R3 25-36, R4 37-60)
  round: RoundNumber
  format: Format
  course: string
  teamA: TeamKey | null       // null only for generic shortfall TBD (un-scored slot with unknown pairing)
  teamB: TeamKey | null
  playersA: MatchPlayer[]
  playersB: MatchPlayer[]
  teeTime: string | null     // logistical, from tee sheet (NOT a match signal)
  startingHole: number | null
  holes: MatchHole[]         // 18 (par/strokeIndex from tee sheet; scores from scopes)
  through: Through
  status: MatchStatus
  matchState: MatchState
  leadSide: LeadSide
  leadBy: number             // holes up (0 when AS / tbd / not started)
  result: string | null      // GG score passthrough ("5 & 3", "1 up", "Tied") when final
  pointsA: number | null     // GG-awarded points; NULL until GG awards (scheduled/live)
  pointsB: number | null
  // Diagnostics (GG is authoritative; disagreements are observable, not silent):
  sourceResult: string | null   // GG `score`
  derivedResult: string | null  // our derivation from net_scores/hbh
  validationStatus: ValidationStatus
}

export interface TeamStanding {
  teamKey: TeamKey
  roundPoints: number         // points this round (sum of awarded match points)
  totalPoints: number         // cumulative across all played rounds
  matchesPlayed: number
  matchesWon: number
  matchesHalved: number
  matchesLost: number
}

export interface ValidationIssue {
  matchNo: number
  kind: 'points-mismatch' | 'result-mismatch' | 'identity-ambiguous' | 'identity-unresolved' | 'round-points-mismatch'
  detail: string
}

// Complete round snapshot — /api/seattle-cup/live?round=N returns THIS.
// Self-contained: the renderer never coordinates multiple responses.
export interface SeattleCupRoundSnapshot {
  round: RoundNumber
  format: Format
  course: string
  eventName: string
  matches: Match[]
  roundStandings: TeamStanding[]
  overallStandings: TeamStanding[]
  resultStatus: 'not-started' | 'live' | 'final' | 'unknown'
  fetchedAt: number             // epoch ms (asOf)
  showingLastKnown: boolean     // stale-while-error signal — true when serving last cache after upstream error
  validationIssues: ValidationIssue[]
}

export const POINTS_RULE = { win: 1, halve: 0.5, loss: 0 } as const