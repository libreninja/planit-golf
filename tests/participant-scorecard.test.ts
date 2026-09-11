import { test } from 'node:test'
import assert from 'node:assert/strict'
import { privateHeaders, requireScorecardOrigin, scorecardError, scorecardJson } from '../lib/events/participant-http.ts'
import { EventScoringError } from '../lib/events/scoring.ts'

test('cookie mutation requires same-origin JSON; cross-site and missing origins are rejected', () => {
  for (const origin of ['https://evil.example', 'null', '']) {
    assert.throws(() => requireScorecardOrigin(new Request('https://planit.golf/api/scorecard', {
      method: 'POST', headers: { origin, 'Content-Type': 'application/json' },
    })), { code: 'P1011' })
  }
  requireScorecardOrigin(new Request('https://planit.golf/api/scorecard', {
    method: 'POST', headers: { origin: 'https://planit.golf', 'Content-Type': 'application/json' },
  }))
})

test('same-origin checks use the browser Host when Next uses its internal listener URL', () => {
  requireScorecardOrigin(new Request('http://0.0.0.0:4318/api/scorecard', {
    method: 'POST', headers: { host: 'localhost:4318', origin: 'http://localhost:4318', 'Content-Type': 'application/json' },
  }))
})

test('malformed and oversized bodies fail without retaining payloads', async () => {
  for (const body of ['{', ' '.repeat(2049)]) {
    await assert.rejects(scorecardJson(new Request('https://planit.golf', { method: 'POST', body })), { code: '22023' })
  }
})

test('safe error responses hide database detail and prohibit caching', async () => {
  for (const [code, status] of [['P1010', 401], ['P1011', 403], ['P1002', 409], ['22023', 400], ['42501', 503]] as const) {
    const response = scorecardError(new EventScoringError(code, 'secret SQL internal detail'))
    assert.equal(response.status, status)
    assert.doesNotMatch(await response.text(), /secret SQL/)
    assert.equal(response.headers.get('Cache-Control'), privateHeaders['Cache-Control'])
  }
})
