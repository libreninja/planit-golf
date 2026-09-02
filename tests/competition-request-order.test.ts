import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyResponse, type GenResponse } from '../components/competition/request-generation.ts'
import { nextPollDecision } from '../components/competition/next-poll-decision.ts'

test('a slower previous-generation response does not overwrite current data', () => {
  // gen 1 = old scoring (net), gen 2 = new scoring (gross). The old gen-1
  // response resolves AFTER the new gen-2 response (slow network). The current
  // generation is 2, so the gen-1 response is dropped — gross data is retained.
  let data: any = null
  data = applyResponse(data, { gen: 2, data: { scoring: 'gross' } }, 2)
  data = applyResponse(data, { gen: 1, data: { scoring: 'net' } }, 2)   // stale, arrives later
  assert.deepEqual(data, { scoring: 'gross' }, 'stale gen-1 response ignored')
})

test('only the last matching-generation response applies', () => {
  let data: any = null
  data = applyResponse(data, { gen: 1, data: 'a' }, 2)   // stale
  data = applyResponse(data, { gen: 2, data: 'b' }, 2)   // current
  data = applyResponse(data, { gen: 2, data: 'c' }, 2)   // current, newer
  assert.equal(data, 'c', 'last matching-gen response wins')
})

test('non-matching generation leaves data untouched (retain leaderboard while new mode loads)', () => {
  let data: any = { scoring: 'gross' }
  data = applyResponse(data, { gen: 1, data: { scoring: 'net' } }, 2)
  assert.deepEqual(data, { scoring: 'gross' }, 'previous-mode data retained until new-mode response arrives')
})

test('a FINAL projected page applies a polled OFFICIAL response without reload and then stops', () => {
  let data: {
    resultStatus: 'final'
    durableCurrent: boolean
    flightMembership: { status: 'projected' | 'official' }
  } = {
    resultStatus: 'final' as const,
    durableCurrent: true,
    flightMembership: { status: 'projected' as const },
  }
  const official = applyResponse(data, {
    gen: 1,
    data: {
      resultStatus: 'final' as const,
      durableCurrent: true,
      flightMembership: { status: 'official' as const },
    },
  }, 1)
  assert.ok(official)
  data = official

  assert.equal(data.flightMembership.status, 'official')
  assert.deepEqual(nextPollDecision({
    resultStatus: data.resultStatus,
    durableCurrent: data.durableCurrent,
    flightMembershipStatus: data.flightMembership.status,
    finalSinceMs: 0,
    nowMs: 24 * 60 * 60_000,
    supportsLive: true,
    visible: true,
    initialIsHistoricalFinal: false,
  }, {
    livePollMs: 60_000,
    finalPollMs: 5 * 60_000,
    finalPollBoundMs: 90 * 60_000,
  }), { action: 'stop' })
})
