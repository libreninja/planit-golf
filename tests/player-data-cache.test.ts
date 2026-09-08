import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../lib/players/data.ts', import.meta.url), 'utf8')

test('persisted Player Detail and comparison facts use reusable caches', () => {
  assert.match(source, /igc-mens-2026-player-facts-v1[\s\S]*revalidate: 15 \* 60/)
  assert.match(source, /igc-mens-2026-player-comparison-cards-v1[\s\S]*revalidate: 60 \* 60/)
  assert.match(source, /igc-mens-2026-player-comparison-flights-v1[\s\S]*revalidate: 60 \* 60/)
})

test('viewer-private state and live scoring stay outside the persisted-fact cache', () => {
  const cachedFacts = source.slice(
    source.indexOf('const loadCachedMensPlayerFacts'),
    source.indexOf('export async function getMensPlayerDetail'),
  )
  assert.doesNotMatch(cachedFacts, /auth\.getUser|golfer_follows|golfer_user_links|getLiveResults/)
  const requestPath = source.slice(source.indexOf('export async function getMensPlayerDetail'))
  assert.match(requestPath, /auth\.getUser/)
  assert.match(requestPath, /getLiveResults/)
})
