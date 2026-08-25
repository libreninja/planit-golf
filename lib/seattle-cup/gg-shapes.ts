// Minimal Golf Genius payload shapes the seattle-cup normalizer consumes. These
// are NOT the full GG API schema — only the fields the normalizer reads, lightly
// typed so the pure normalizer is testable against saved fixtures without I/O.
// Field access in normalize.ts is defensive (nullish-coalesced) because GG omits
// fields per format (e.g. Singles aggregates have no individual_results).

export interface GGMemberCard {
  member_id_str?: string | null
  member_card_id_str?: string | null
  member_card_id?: string | number | null
}

export interface GGIndividualResult {
  member_id_str?: string | null
  name?: string | null
  net_scores?: (number | null)[]
  gross_scores?: (number | null)[]
}

export interface GGAggregate {
  name?: string | null               // "Jackson Park (Rowe, Tim + Fabela, Dan)"
  affiliation?: string | null         // "Jackson Park Men's Golf Club"
  team_id?: number | string | null    // per-match-scoped; NOT a stable team id
  points_summary_team_id?: string | null
  member_cards?: GGMemberCard[]
  net_scores?: (number | null)[]      // side (best-ball) net per hole
  gross_scores?: (number | null)[]    // side (best-ball) gross per hole
  hbh_match_status?: string[]         // per-hole running status, THIS side's view
  score?: string | null               // "5 & 3" | "1 up" | "Tied" | ""
  points?: string | number | null     // "1.00" | "0.50" | "0.00" | 0
  thru?: string | number | null
  position?: number | string | null
  totals?: Record<string, number | null>
  individual_results?: GGIndividualResult[]
  scorecard_statuses?: string[]
}

export interface GGScope {
  id?: string | number
  aggregates?: GGAggregate[]
}

export interface GGTournamentPayload {
  event?: {
    name?: string
    status?: string
    completed_at?: string | null
    adjusted?: boolean
    scopes?: GGScope[]
  }
}

export interface GGTeamPointsTeam {
  name?: string
  round_points?: string | number | null
  total_points?: string | number | null
}
export interface GGTeamPoints {
  teams?: GGTeamPointsTeam[]
}

// tee_sheet: array of pairing groups; each wraps {pairing_group: {tee_time,
// hole, date, players[]}}. Players carry identity + handicap dots + the tee's
// hole_data (par/strokeIndex). The tee sheet is LOGISTICAL ONLY for match-play
// (tee time, starting hole, per-player dots) — it never defines matches. For
// Singles the foursome is 4 players from 4 teams = 2 separate 1v1 matches that
// live in the tournament scopes, NOT the foursome grouping. See Singles invariant.
export interface GGHoleData {
  par?: number[]
  handicap?: number[]   // stroke index per hole (1..18)
  yardage?: number[]
}
export interface GGPlayer {
  name?: string | null
  first_name?: string | null
  last_name?: string | null
  team_name?: string | null
  team_id?: number | string | null
  member_card_id?: string | number | null
  member_id_str?: string | null
  external_id?: string | null
  course_handicap?: number | string | null
  handicap_index?: number | string | null
  handicap_dots_by_hole?: number[]
  score_array?: (number | null)[]
  tee?: {
    hole_data?: GGHoleData
    name?: string
  } | null
}
export interface GGPairingGroup {
  tee_time?: string | null
  hole?: number | string | null
  date?: string | null
  players?: GGPlayer[]
}

// Flattened, normalized tee-sheet view the normalizer consumes.
export interface GGTeeSheet {
  groups: GGPairingGroup[]
  holeData: GGHoleData | null   // from the first player's tee (par/strokeIndex)
  playersByCardId: Map<string, { player: GGPlayer; teeTime: string | null; hole: number | null }>
}

export interface GGRoundRaw {
  ggEventId: string
  ggRoundId: string
  eventName: string | null
  roundDate: string | null
  upstreamStatus: 'completed' | 'in_progress' | 'not_started' | 'unknown'
  tournamentPayload: GGTournamentPayload | null
  scopes: GGScope[]
  teeSheet: GGTeeSheet
  teamPoints: GGTeamPoints | null
}