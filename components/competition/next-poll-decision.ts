// Pure polling state machine. The hook calls this each time its inputs change
// and uses the result to schedule (or cancel) the next recursive setTimeout.
// Recursive setTimeout (not setInterval) means an interval change never stacks
// a stale timer — the next decision re-evaluates from the current state.
// See design spec §8 + plan issue #11.

export type ResultStatusLite = 'live' | 'final' | 'not_started' | 'unknown'

export interface PollState {
  resultStatus: ResultStatusLite
  durableCurrent: boolean
  finalSinceMs: number | null    // ms timestamp when live→final first observed
  nowMs: number
  supportsLive: boolean
  visible: boolean
  initialIsHistoricalFinal: boolean
}

export interface PollConfig {
  livePollMs: number
  finalPollMs: number
  finalPollBoundMs: number
}

export type PollAction = { action: 'poll'; delayMs: number } | { action: 'stop' }

export function nextPollDecision(s: PollState, cfg: PollConfig): PollAction {
  if (!s.supportsLive || s.initialIsHistoricalFinal || !s.visible) return { action: 'stop' }
  if (s.resultStatus === 'live') return { action: 'poll', delayMs: cfg.livePollMs }
  if (s.resultStatus === 'final') {
    if (s.durableCurrent) return { action: 'stop' }
    const since = s.finalSinceMs ?? s.nowMs
    if (s.nowMs - since > cfg.finalPollBoundMs) return { action: 'stop' }
    return { action: 'poll', delayMs: cfg.finalPollMs }
  }
  return { action: 'stop' }
}
