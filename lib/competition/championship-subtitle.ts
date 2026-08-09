// Pure subtitle copy for the Club Championship aggregate. One concise,
// state-aware line that makes the championship format immediately
// understandable and reflects live/final/pre-play status. The schedule
// parts (weekday/date strings) are computed server-side from the config
// specs and passed in, so this module is pure + unit-testable with no Date
// dependency. Relative imports (no @/) for node --test loadability.

export interface RoundScheduleItem {
  round: number           // 1-based championshipRound
  weekdayShort: string     // 'Mon'
  weekdayLong: string      // 'Monday'
  dateShort: string        // '8/17'
  dateLong: string         // 'Aug 17'
}

export interface SubtitleState {
  resultStatus: 'not_started' | 'live' | 'final' | 'unknown'
  roundsComplete: number
  roundsLive: number
  roundCount: number
}

// The format descriptor — the baseline subtitle, shown when no active
// status preempts it: "18-hole aggregate · Round 1 Mon 8/17 + Round 2 Tue 8/18".
// Hole total assumes 9-hole Interbay rounds (roundCount * 9).
function formatDescriptor(state: SubtitleState, schedule: RoundScheduleItem[]): string {
  const holes = state.roundCount * 9
  const rounds = schedule.map((r) => `Round ${r.round} ${r.weekdayShort} ${r.dateShort}`).join(' + ')
  return `${holes}-hole aggregate · ${rounds}`
}

// One line, by aggregate state:
//   final                          → "FINAL"
//   live + a round currently live   → "LIVE · Round N in progress"
//   not_started (no golf posted)    → "Starts Monday, Aug 17" (first round)
//   neutral (a round complete, none live, not final) → the format descriptor
export function championshipSubtitle(state: SubtitleState, schedule: RoundScheduleItem[]): string {
  if (state.resultStatus === 'final') return 'FINAL'
  if (state.resultStatus === 'live' && state.roundsLive > 0) {
    // The live round is the one after the completed rounds.
    return `LIVE · Round ${state.roundsComplete + 1} in progress`
  }
  if (state.resultStatus === 'not_started' || state.roundCount === 0) {
    return schedule.length ? `Starts ${schedule[0].weekdayLong}, ${schedule[0].dateLong}` : formatDescriptor(state, schedule)
  }
  return formatDescriptor(state, schedule)
}