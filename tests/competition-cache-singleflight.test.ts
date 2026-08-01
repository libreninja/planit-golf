import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeSingleFlight } from '../lib/competition/cache.ts'

test('in-process single-flight: N concurrent calls share one upstream fetch', async () => {
  let calls = 0
  const sf = makeSingleFlight<string>()
  const work = async () => { calls++; await new Promise((r) => setTimeout(r, 20)); return 'result' }
  const results = await Promise.all([sf.run('k1', work), sf.run('k1', work), sf.run('k1', work)])
  assert.equal(calls, 1, 'only one upstream call for the same key')
  assert.deepEqual(results, ['result', 'result', 'result'])
})

test('different keys run independently', async () => {
  let calls = 0
  const sf = makeSingleFlight<string>()
  const work = async () => { calls++; await new Promise((r) => setTimeout(r, 10)); return 'r' }
  await Promise.all([sf.run('a', work), sf.run('b', work)])
  assert.equal(calls, 2)
})

test('key is freed after completion so a later call re-fetches', async () => {
  let calls = 0
  const sf = makeSingleFlight<string>()
  const work = async () => { calls++; return 'r' }
  await sf.run('k', work)
  await sf.run('k', work)
  assert.equal(calls, 2)
})
