// Local-only harness: actual Next routes + Supabase client + SQL functions.
// The transport replaces PostgREST with an allowlisted loopback RPC bridge.
// No env files or remote database targets are read by this harness.
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { writeFile, mkdir } from 'node:fs/promises'
import { db, setup, cleanup, sql } from '../tests/helpers/participant-db.ts'
import { createParticipantScorecardService } from '../lib/events/participant-scorecard.ts'

const context = await setup()
const service = createParticipantScorecardService(db)
let access = await service.issue(context.scope, new Date(Date.now() + 24 * 3600_000))
const bridgeKey = randomBytes(32).toString('hex')
const server = createServer(async (request, response) => {
  response.setHeader('Content-Type', 'application/json')
  if (request.method !== 'POST' || request.headers.apikey !== bridgeKey) {
    response.writeHead(403).end('{}'); return
  }
  const name = request.url?.match(/^\/rest\/v1\/rpc\/(read_participant_scorecard|record_participant_gross_score)$/)?.[1]
  if (!name) { response.writeHead(404).end('{}'); return }
  try {
    const buffers = []
    for await (const chunk of request) buffers.push(chunk)
    const { data, error } = await db.rpc(name, JSON.parse(Buffer.concat(buffers).toString()))
    response.writeHead(error ? 400 : 200).end(JSON.stringify(error ?? data))
  } catch { response.writeHead(500).end(JSON.stringify({ code: 'unavailable', message: 'Local bridge unavailable' })) }
})
await new Promise<void>((resolve) => server.listen(4319, '127.0.0.1', resolve))
await mkdir('/private/tmp/wine-valley-scorecard', { recursive: true })
async function writeAccess() {
await writeFile('/private/tmp/wine-valley-scorecard/access.json', JSON.stringify({
  url: `http://localhost:4318${access.path}`, accessId: access.accessId,
  token: access.token, scope: context.scope,
  outsider: context.round.participantIds.find((id) => !context.group.participantIds.includes(id)),
}, null, 2), { mode: 0o600 })
}
await writeAccess()
const next = spawn('node_modules/.bin/next', ['dev', '--hostname', '0.0.0.0', '--port', '4318'], {
  stdio: 'inherit', env: { ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:4319',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'local-demo-anon', SUPABASE_SERVICE_ROLE_KEY: bridgeKey,
  },
})
console.log('Local Wine Valley scorecard: private link in /private/tmp/wine-valley-scorecard/access.json')
console.log('Commands: evidence, revoke, renew (same group), quit (discard demo database).')
process.stdin.setEncoding('utf8')
process.stdin.on('data', async (line) => {
  if (String(line).trim() === 'revoke') { await service.revoke(access.accessId); console.log('Demo link revoked.') }
  if (String(line).trim() === 'renew') {
    await service.revoke(access.accessId)
    access = await service.issue(context.scope, new Date(Date.now() + 24 * 3600_000))
    await writeAccess(); console.log('Replacement local link written; scope and score history retained.')
  }
  if (String(line).trim() === 'evidence') {
    const history = await sql(`SELECT jsonb_agg(jsonb_build_object('name',g.display_name,
      'hole',v.hole,'gross',v.gross,'previousGross',v.previous_gross,'revision',v.revision,
      'actorRef',v.actor_ref,'source',v.source,'recordedAt',v.recorded_at) ORDER BY v.recorded_at)
      FROM event_hole_score_revisions v JOIN golfers g ON g.id=v.golfer_id`)
    await writeFile('/private/tmp/wine-valley-scorecard/revision-evidence.json', history)
    console.log('Persisted revision evidence written (no token).')
  }
  if (String(line).trim() === 'quit') next.kill('SIGTERM')
})
let stopping = false
async function stop() {
  if (stopping) return
  stopping = true
  next.kill('SIGTERM'); server.close(); await cleanup(); process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
next.on('exit', stop)
