import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import type { ScorecardContext } from '../components/competition/scorecard-context.ts'
import { buildScorecardContext } from '../components/competition/scorecard-context.ts'
import { buildHoles } from '../lib/igc/weekly-results-helpers.ts'
import { weeklyScorecardFixtures } from './fixtures/weekly-scorecard-context.ts'

// Node's native TS runner does not transform JSX. Compile only the renderer;
// its formatter and React imports still execute their real implementations.
const file = new URL('../components/competition/expanded-scorecard.tsx', import.meta.url)
const source = readFileSync(file, 'utf8').replace("'./leaderboard-format'", "'./leaderboard-format.ts'")
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
})
const renderer = { exports: {} as { ExpandedScorecard: (props: { card: ScorecardContext }) => ReturnType<typeof createElement> } }
new Function('require', 'module', 'exports', outputText)(createRequire(file), renderer, renderer.exports)
const render = (card: ScorecardContext) => renderToStaticMarkup(createElement(renderer.exports.ExpandedScorecard, { card }))
function tim() {
  const f = weeklyScorecardFixtures[0]
  return buildScorecardContext({
    grossTotal: f.grossTotal, netTotal: f.netTotal, toParGross: f.grossPar, toParNet: f.netPar,
    holes: buildHoles([...f.gross], [...f.net], [...f.netToPar], [...f.grossToPar]).slice(0, 9)
      .map((hole, i) => ({ ...hole, handicapStrokes: f.handicapStrokes[i] })),
  }, 'net')
}

test('nine-hole renderer totals actual strokes independently of the Net aggregate', () => {
  const html = render(tim())
  assert.match(html, />Total<\/th>/)
  assert.doesNotMatch(html, />(Out|In)<\/th>/)
  assert.match(html, /Recorded stroke total[^>]*>32<\/td>/)
  assert.match(html, />28<\/td>/)
  assert.equal((html.match(/data-handicap-hole=/g) ?? []).length, 7)
  assert.doesNotMatch(html, /data-handicap-hole="3"/)
  assert.doesNotMatch(html.match(/<thead>[\s\S]*?<\/thead>/)![0], /•|handicap/)
})

test('18-hole renderer retains Out and In and adds the complete round Total', () => {
  const card = tim()
  card.holes.push(...card.holes.map(hole => ({ ...hole, hole: hole.hole + 9 })))
  const html = render(card)
  assert.match(html, />Out<\/th>/)
  assert.match(html, />In<\/th>/)
  assert.match(html, />Total<\/th>/)
  assert.match(html, /Recorded stroke total[^>]*>64<\/td>/)
  assert.match(html, />56<\/td>/)
})

test('multiple dots and unknown allocations remain distinct from zero and Gross', () => {
  const card = tim()
  card.holes[0].handicapStrokes = 4
  card.holes[1].handicapStrokes = null
  const html = render(card)
  assert.match(html, /data-handicap-hole="1"[^>]*>(<span>•<\/span>){4}<\/span>/)
  assert.match(html, /data-handicap-hole="2"[^>]*>\?<\/span>/)
  assert.doesNotMatch(html, /data-handicap-hole="3"/)
  assert.match(html, /handicap allocation unknown/)
  card.showHandicap = false
  assert.doesNotMatch(render(card), /data-handicap-hole|handicap strokes/)
})

test('partial cards keep blank scores and sum only recorded strokes', () => {
  const card = tim()
  card.holes = card.holes.map((hole, i) => i < 4 ? hole : { ...hole, strokes: null, toPar: null, mark: 'plain' })
  const html = render(card)
  assert.match(html, /Recorded stroke total[^>]*>13<\/td>/)
  assert.equal((html.match(/actual score unavailable/g) ?? []).length, 5)
})
