import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { afterEach, test } from 'node:test'

const script = resolve('scripts/wait-for-production-deployment.mjs')
const fixtures: string[] = []
const sha = '1234567890abcdef1234567890abcdef12345678'

afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { force: true, recursive: true })
})

function fakeGh(deployments: unknown, statuses: unknown) {
  const root = mkdtempSync(join(tmpdir(), 'planit-deployment-status-'))
  fixtures.push(root)
  const bin = join(root, 'bin')
  mkdirSync(bin)
  const executable = join(bin, 'gh')
  writeFileSync(
    executable,
    `#!/usr/bin/env node
const statuses = process.argv.some((argument) => argument.endsWith('/statuses'))
process.stdout.write(JSON.stringify(statuses ? ${JSON.stringify(statuses)} : ${JSON.stringify(deployments)}))
`
  )
  chmodSync(executable, 0o755)
  return bin
}

function runHelper(bin: string) {
  return spawnSync(
    process.execPath,
    [script, sha, '--repo', 'libreninja/planit-golf', '--timeout-seconds', '1', '--poll-seconds', '0.01'],
    {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` },
    }
  )
}

test('reports READY only for a successful Vercel production deployment attached to the exact SHA', () => {
  const bin = fakeGh(
    [
      {
        id: 42,
        sha,
        ref: sha,
        environment: 'Production',
        creator: { login: 'vercel[bot]' },
        created_at: '2026-09-09T12:00:00Z',
      },
    ],
    [
      {
        state: 'success',
        environment: 'Production',
        environment_url: 'https://planit-example.vercel.app',
        creator: { login: 'vercel[bot]' },
        updated_at: '2026-09-09T12:01:00Z',
      },
    ]
  )

  const result = runHelper(bin)

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Deployment ID: 42/)
  assert.match(result.stdout, /Target: Production/)
  assert.match(result.stdout, /State: success/)
  assert.ok(result.stdout.includes(`Git SHA: ${sha} (match)`))
  assert.match(result.stdout, /URL: https:\/\/planit-example\.vercel\.app/)
  assert.match(result.stdout, /READY\n$/)
})

test('reports a terminal production deployment failure', () => {
  const bin = fakeGh(
    [
      {
        id: 84,
        sha,
        ref: sha,
        environment: 'Production',
        creator: { login: 'vercel[bot]' },
        created_at: '2026-09-09T12:00:00Z',
      },
    ],
    [
      {
        state: 'failure',
        environment: 'Production',
        environment_url: 'https://planit-failed.vercel.app',
        creator: { login: 'vercel[bot]' },
        updated_at: '2026-09-09T12:01:00Z',
      },
    ]
  )

  const result = runHelper(bin)

  assert.equal(result.status, 1)
  assert.match(result.stdout, /Deployment ID: 84/)
  assert.match(result.stdout, /State: failure/)
  assert.match(result.stdout, /DEPLOYMENT FAILED\n$/)
})
