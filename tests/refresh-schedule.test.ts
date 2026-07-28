// Pure unit tests for the leading + trailing refresh throttle. Run with:
//   node --test tests/refresh-schedule.test.ts
// Node 24 strips TS types natively; the import uses a relative path (no `@/`).
//
// These verify the exact scheduling contract the inbox relies on: fast
// acknowledgement (a leading refresh on the first event), bounded frequency
// (suppressed events within the window do NOT each refresh), and eventual
// correctness (a trailing refresh captures the last suppressed change). A
// minimal virtual clock is injected so we can assert the precise fire times
// without real timers.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LeadingTrailingThrottle } from '../lib/refresh-schedule.ts'

// Controllable clock: `now` is a hand-set value; setTimer/clearTimer manage a
// list of pending timers. advance(to) sets the clock to the ABSOLUTE time `to`,
// firing any due timers (fireAt <= to) in fire-time order along the way.
function makeClock() {
  let now = 0
  let nextId = 1
  let timers: { id: number; fireAt: number; fn: () => void }[] = []
  return {
    nowFn: () => now,
    setTimer: (fn: () => void, delay: number) => {
      const id = nextId++
      timers.push({ id, fireAt: now + delay, fn })
      return id
    },
    clearTimer: (id: number) => {
      timers = timers.filter((t) => t.id !== id)
    },
    pending: () => timers.length,
    advance(to: number) {
      while (true) {
        const due = timers
          .filter((t) => t.fireAt <= to)
          .sort((a, b) => a.fireAt - b.fireAt)[0]
        if (!due) break
        now = due.fireAt
        timers = timers.filter((t) => t.id !== due.id)
        due.fn()
      }
      if (to > now) now = to
    },
  }
}

const WINDOW = 500

function makeThrottle(clock: ReturnType<typeof makeClock>, refreshes: number[]) {
  return new LeadingTrailingThrottle({
    windowMs: WINDOW,
    refresh: () => refreshes.push(clock.nowFn()),
    now: clock.nowFn,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  })
}

// The spec's canonical scenario: A at 0, B at 200ms, nothing else.
test('A at 0, B at 200ms, nothing else -> immediate refresh + one trailing refresh', () => {
  const clock = makeClock()
  const refreshes: number[] = []
  const th = makeThrottle(clock, refreshes)

  th.hit() // A at t=0 -> leading
  clock.advance(200)
  th.hit() // B at t=200 -> suppressed
  assert.equal(refreshes.length, 1, 'only the leading refresh before the window ends')
  assert.equal(refreshes[0], 0)

  clock.advance(501) // past the anchored window end (500)
  assert.equal(refreshes.length, 2, 'immediate + exactly one trailing refresh')
  assert.deepEqual(refreshes, [0, 500])
  assert.equal(clock.pending(), 0, 'no refresh left pending after the trailing fires')
})

test('a single event -> only the immediate refresh, no unnecessary trailing', () => {
  const clock = makeClock()
  const refreshes: number[] = []
  const th = makeThrottle(clock, refreshes)

  th.hit() // t=0 -> leading
  assert.equal(refreshes.length, 1)
  assert.equal(refreshes[0], 0)

  clock.advance(10_000) // long idle
  assert.equal(refreshes.length, 1, 'no trailing refresh ever fires')
  assert.equal(clock.pending(), 0)
})

test('a burst within the window coalesces into one leading + one trailing (not N refreshes)', () => {
  const clock = makeClock()
  const refreshes: number[] = []
  const th = makeThrottle(clock, refreshes)

  th.hit() // t=0
  clock.advance(50)
  th.hit() // t=50, suppressed
  clock.advance(100)
  th.hit() // t=100, suppressed
  clock.advance(150)
  th.hit() // t=150, suppressed (four events total in [0,500))
  assert.equal(refreshes.length, 1, 'only the leading refresh during the burst')

  clock.advance(501) // past the anchored window end (500)
  assert.equal(refreshes.length, 2, 'exactly one trailing for the whole burst')
  assert.deepEqual(refreshes, [0, 500])
})

test('the trailing is anchored at the leading refresh, not pushed later by a suppressed event', () => {
  const clock = makeClock()
  const refreshes: number[] = []
  const th = makeThrottle(clock, refreshes)

  th.hit() // t=0 leading -> window end anchored at 500
  clock.advance(400)
  th.hit() // t=400, suppressed; trailing must stay at 500, NOT 900
  clock.advance(501) // past 500; trailing @500 fires
  assert.deepEqual(refreshes, [0, 500], 'trailing fires at the anchored window end')
})

test('an event after the window starts a new leading; suppressed events get a trailing (bounded frequency + eventual correctness)', () => {
  const clock = makeClock()
  const refreshes: number[] = []
  const th = makeThrottle(clock, refreshes)

  th.hit() // t=0 leading
  clock.advance(200)
  th.hit() // t=200, suppressed -> trailing @500
  clock.advance(600) // trailing @500 fires during advance; now=600
  assert.deepEqual(refreshes, [0, 500])

  th.hit() // t=600: 600-500=100 < window -> suppressed -> trailing @1000
  clock.advance(1001) // trailing @1000 fires; now=1001
  assert.deepEqual(refreshes, [0, 500, 1000], 'bounded to ~one refresh per window')
  assert.equal(clock.pending(), 0)
})

test('dispose() cancels a pending trailing refresh so it never fires after teardown', () => {
  const clock = makeClock()
  const refreshes: number[] = []
  const th = makeThrottle(clock, refreshes)

  th.hit() // 0 leading
  clock.advance(200)
  th.hit() // suppressed -> trailing @500 pending
  assert.equal(clock.pending(), 1)

  th.dispose()
  assert.equal(clock.pending(), 0, 'pending trailing cleared on dispose')
  clock.advance(10_000)
  assert.deepEqual(refreshes, [0], 'no trailing fired after dispose')
})