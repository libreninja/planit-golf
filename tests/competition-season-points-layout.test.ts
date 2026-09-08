import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(
  new URL('../components/competition/season-points-view.tsx', import.meta.url),
  'utf8',
)

test('Season standings reserve a readable mobile player column without hiding data', () => {
  assert.equal(
    source.match(/grid-cols-\[2rem_minmax\(0,1fr\)_4\.5rem_2\.5rem_3rem\]/g)?.length,
    2,
  )
  assert.equal(
    source.match(/sm:grid-cols-\[3rem_minmax\(0,1fr\)_6rem_5rem_5rem\]/g)?.length,
    2,
  )
  assert.match(source, /gap-1[\s\S]*px-2[\s\S]*sm:gap-2[\s\S]*sm:px-3/)
  assert.match(source, /<div className="truncate">/)
  assert.doesNotMatch(source, /overflow-x-auto|overflow-x-scroll/)
  for (const label of ['Pos', 'Player', 'Points', 'Prev', 'Played']) {
    assert.match(source, new RegExp(`>${label}<`))
  }
})

test('Season header uses compact mobile type and restores the desktop treatment', () => {
  assert.match(
    source,
    /text-\[10px\][\s\S]*tracking-normal[\s\S]*sm:text-xs[\s\S]*sm:tracking-wide/,
  )
})
