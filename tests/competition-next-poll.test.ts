import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextPollDecision, type PollState } from '../lib/../components/competition/next-poll-decision.ts'

function st(over: Partial<PollState>): PollState {
  return {
    resultStatus: 'live',
    durableCurrent: false,
    finalSinceMs: null,
    nowMs: 0,
    supportsLive: true,
    visible: true,
    initialIsHistoricalFinal: false,
    ...over,
  }
}

const LIVE_POLL_MS = 60_000
const FINAL_POLL_MS = 5 * 60_000
const FINAL_POLL_BOUND_MS = 90 * 60_000

test('LIVE behavior remains unchanged when flight membership is projected', () => {
  const d = nextPollDecision(st({
    resultStatus: 'live', visible: true, nowMs: 1000,
    flightMembershipStatus: 'projected',
  }), { livePollMs: LIVE_POLL_MS, finalPollMs: FINAL_POLL_MS, finalPollBoundMs: FINAL_POLL_BOUND_MS })
  assert.equal(d.action, 'poll')
  assert.equal(d.delayMs, LIVE_POLL_MS)
})

test('final + not durable + within bound → poll at FINAL_POLL_MS', () => {
  const d = nextPollDecision(st({ resultStatus: 'final', durableCurrent: false, finalSinceMs: 1000, nowMs: 1000 + 60_000 }), { livePollMs: LIVE_POLL_MS, finalPollMs: FINAL_POLL_MS, finalPollBoundMs: FINAL_POLL_BOUND_MS })
  assert.equal(d.action, 'poll')
  assert.equal(d.delayMs, FINAL_POLL_MS)
})

test('final + durableCurrent → stop', () => {
  const d = nextPollDecision(st({ resultStatus: 'final', durableCurrent: true, finalSinceMs: 1000, nowMs: 9999 }), { livePollMs: LIVE_POLL_MS, finalPollMs: FINAL_POLL_MS, finalPollBoundMs: FINAL_POLL_BOUND_MS })
  assert.equal(d.action, 'stop')
})

test('FINAL + PROJECTED continues low-frequency checking after the old bound', () => {
  const d = nextPollDecision(st({
    resultStatus: 'final', durableCurrent: true, flightMembershipStatus: 'projected',
    finalSinceMs: 0, nowMs: FINAL_POLL_BOUND_MS + 24 * 60 * 60_000,
  }), { livePollMs: LIVE_POLL_MS, finalPollMs: FINAL_POLL_MS, finalPollBoundMs: FINAL_POLL_BOUND_MS })
  assert.equal(d.action, 'poll')
  assert.equal(d.delayMs, FINAL_POLL_MS)
})

test('FINAL + OFFICIAL stops projection-related polling', () => {
  const d = nextPollDecision(st({
    resultStatus: 'final', durableCurrent: true, flightMembershipStatus: 'official',
    finalSinceMs: 0, nowMs: FINAL_POLL_BOUND_MS + 1000,
  }), { livePollMs: LIVE_POLL_MS, finalPollMs: FINAL_POLL_MS, finalPollBoundMs: FINAL_POLL_BOUND_MS })
  assert.equal(d.action, 'stop')
})

test('final + bound exceeded → stop', () => {
  const d = nextPollDecision(st({ resultStatus: 'final', durableCurrent: false, finalSinceMs: 0, nowMs: FINAL_POLL_BOUND_MS + 1000 }), { livePollMs: LIVE_POLL_MS, finalPollMs: FINAL_POLL_MS, finalPollBoundMs: FINAL_POLL_BOUND_MS })
  assert.equal(d.action, 'stop')
})

test('historical final → stop (never poll)', () => {
  const d = nextPollDecision(st({ initialIsHistoricalFinal: true, resultStatus: 'final' }), { livePollMs: LIVE_POLL_MS, finalPollMs: FINAL_POLL_MS, finalPollBoundMs: FINAL_POLL_BOUND_MS })
  assert.equal(d.action, 'stop')
})

test('hidden tab → stop (no polling while hidden)', () => {
  const d = nextPollDecision(st({ visible: false, resultStatus: 'live' }), { livePollMs: LIVE_POLL_MS, finalPollMs: FINAL_POLL_MS, finalPollBoundMs: FINAL_POLL_BOUND_MS })
  assert.equal(d.action, 'stop')
})

test('hidden FINAL + PROJECTED page does not perform membership checks', () => {
  const d = nextPollDecision(st({
    visible: false,
    resultStatus: 'final',
    durableCurrent: true,
    flightMembershipStatus: 'projected',
    finalSinceMs: 0,
    nowMs: FINAL_POLL_BOUND_MS + 1000,
  }), { livePollMs: LIVE_POLL_MS, finalPollMs: FINAL_POLL_MS, finalPollBoundMs: FINAL_POLL_BOUND_MS })
  assert.equal(d.action, 'stop')
})

test('unknown → stop', () => {
  const d = nextPollDecision(st({ resultStatus: 'unknown' }), { livePollMs: LIVE_POLL_MS, finalPollMs: FINAL_POLL_MS, finalPollBoundMs: FINAL_POLL_BOUND_MS })
  assert.equal(d.action, 'stop')
})
