import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, test } from 'node:test'

const script = resolve('scripts/fast-integration-preflight.mjs')
const fixtures: string[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { force: true, recursive: true })
})

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function write(repo: string, path: string, contents: string) {
  const absolute = join(repo, path)
  mkdirSync(resolve(absolute, '..'), { recursive: true })
  writeFileSync(absolute, contents)
}

function commit(repo: string, message: string) {
  git(repo, 'add', '--all')
  git(repo, 'commit', '-m', message)
  return git(repo, 'rev-parse', 'HEAD')
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'planit-fast-preflight-'))
  fixtures.push(root)
  const repository = join(root, 'repo')
  const feature = join(root, 'feature')

  mkdirSync(repository)
  git(repository, 'init', '-b', 'main')
  git(repository, 'config', 'user.name', 'Fast Integration Test')
  git(repository, 'config', 'user.email', 'fast-integration@example.test')
  write(repository, 'README.md', '# fixture\n')
  const base = commit(repository, 'base')
  git(repository, 'worktree', 'add', '-b', 'feature/presentation', feature, 'main')

  return { base, feature, repository }
}

function runPreflight(feature: string, sourceSha: string, baseSha: string) {
  return spawnSync(
    process.execPath,
    [
      script,
      '--worktree',
      feature,
      '--source',
      'feature/presentation',
      '--source-sha',
      sourceSha,
      '--base-sha',
      baseSha,
      '--main-ref',
      'main',
    ],
    { encoding: 'utf8' }
  )
}

test('clean presentation change on an unchanged base is FAST eligible', () => {
  const fixture = createFixture()
  write(fixture.feature, 'app/demo/page.tsx', 'export default function Demo() { return <main>Demo</main> }\n')
  const sourceSha = commit(fixture.feature, 'presentation')

  const result = runPreflight(fixture.feature, sourceSha, fixture.base)

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Source HEAD: [0-9a-f]{40}/)
  assert.match(result.stdout, /Worktree clean: yes/)
  assert.match(result.stdout, /Source changed paths:\n  app\/demo\/page\.tsx/)
  assert.match(result.stdout, /Expected tree: verified source tree/)
  assert.match(result.stdout, /FAST ELIGIBLE\n$/)
})

test('migration or schema changes require GUARDED integration', () => {
  const fixture = createFixture()
  write(fixture.feature, 'supabase/migrations/20260909000000_example.sql', 'create table example (id bigint);\n')
  const sourceSha = commit(fixture.feature, 'migration')

  const result = runPreflight(fixture.feature, sourceSha, fixture.base)

  assert.equal(result.status, 1)
  assert.match(result.stdout, /Guarded trigger: migration\/schema \(supabase\/migrations\/20260909000000_example\.sql\)/)
  assert.match(result.stdout, /FAST STOPPED — GUARDED TRIGGER: migration\/schema change\n$/)
})

test('auth or security changes require GUARDED integration', () => {
  const fixture = createFixture()
  write(fixture.feature, 'lib/auth.ts', 'export function requireAuth() { throw new Error("unauthorized") }\n')
  const sourceSha = commit(fixture.feature, 'auth semantics')

  const result = runPreflight(fixture.feature, sourceSha, fixture.base)

  assert.equal(result.status, 1)
  assert.match(result.stdout, /Guarded trigger: auth\/RLS\/security \(lib\/auth\.ts\)/)
  assert.match(result.stdout, /FAST STOPPED — GUARDED TRIGGER: auth\/RLS\/security change\n$/)
})

test('dirty source worktree requires GUARDED integration', () => {
  const fixture = createFixture()
  write(fixture.feature, 'app/demo/page.tsx', 'export default function Demo() { return <main>Demo</main> }\n')
  const sourceSha = commit(fixture.feature, 'presentation')
  write(fixture.feature, 'uncommitted.txt', 'dirty\n')

  const result = runPreflight(fixture.feature, sourceSha, fixture.base)

  assert.equal(result.status, 1)
  assert.match(result.stdout, /Worktree clean: no/)
  assert.match(result.stdout, /FAST STOPPED — GUARDED TRIGGER: dirty worktree\n$/)
})

test('HEAD differing from the verified source SHA requires GUARDED integration', () => {
  const fixture = createFixture()
  write(fixture.feature, 'app/demo/page.tsx', 'export default function Demo() { return <main>One</main> }\n')
  const verifiedSha = commit(fixture.feature, 'verified source')
  write(fixture.feature, 'app/demo/page.tsx', 'export default function Demo() { return <main>Two</main> }\n')
  commit(fixture.feature, 'source changed after verification')

  const result = runPreflight(fixture.feature, verifiedSha, fixture.base)

  assert.equal(result.status, 1)
  assert.match(result.stdout, /READY SHA match: no/)
  assert.match(result.stdout, /FAST STOPPED — GUARDED TRIGGER: source verification mismatch\n$/)
})

test('provably independent main advancement remains FAST eligible', () => {
  const fixture = createFixture()
  write(fixture.feature, 'app/demo/page.tsx', 'export default function Demo() { return <main>Demo</main> }\n')
  const sourceSha = commit(fixture.feature, 'presentation')
  write(fixture.repository, 'docs/independent.md', 'Independent documentation.\n')
  commit(fixture.repository, 'independent main advancement')
  const objectStateBefore = git(fixture.repository, 'count-objects', '-v')

  const result = runPreflight(fixture.feature, sourceSha, fixture.base)

  assert.equal(result.status, 0, result.stderr)
  assert.equal(git(fixture.repository, 'count-objects', '-v'), objectStateBefore, 'preflight must not write Git objects')
  assert.match(result.stdout, /Main advancement changed paths:\n  docs\/independent\.md/)
  assert.match(result.stdout, /Changed-path overlap: no/)
  assert.match(result.stdout, /Merge tree: clean \(read-only analysis\)/)
  assert.match(result.stdout, /Expected tree: deterministic composite/)
  assert.match(result.stdout, /FAST ELIGIBLE\n$/)
})

test('overlapping main advancement requires GUARDED integration', () => {
  const fixture = createFixture()
  write(fixture.feature, 'README.md', '# feature version\n')
  const sourceSha = commit(fixture.feature, 'feature changes shared path')
  write(fixture.repository, 'README.md', '# main version\n')
  commit(fixture.repository, 'main changes shared path')

  const result = runPreflight(fixture.feature, sourceSha, fixture.base)

  assert.equal(result.status, 1)
  assert.match(result.stdout, /Changed-path overlap: yes \(README\.md\)/)
  assert.match(result.stdout, /FAST STOPPED — GUARDED TRIGGER: material\/overlapping main advancement \(README\.md\)\n$/)
})

test('Vercel or deployment configuration changes require GUARDED integration', () => {
  const fixture = createFixture()
  write(fixture.feature, 'vercel.json', '{"framework":"nextjs"}\n')
  const sourceSha = commit(fixture.feature, 'deployment config')

  const result = runPreflight(fixture.feature, sourceSha, fixture.base)

  assert.equal(result.status, 1)
  assert.match(result.stdout, /FAST STOPPED — GUARDED TRIGGER: deployment\/environment\/cron config change\n$/)
})

test('package or build-pipeline changes require GUARDED integration', () => {
  const fixture = createFixture()
  write(fixture.feature, 'package.json', '{"packageManager":"pnpm@11.0.9"}\n')
  const sourceSha = commit(fixture.feature, 'package tooling')

  const result = runPreflight(fixture.feature, sourceSha, fixture.base)

  assert.equal(result.status, 1)
  assert.match(result.stdout, /FAST STOPPED — GUARDED TRIGGER: package\/runtime\/build-pipeline change\n$/)
})

test('broad reconciliation or authoritative-data changes require GUARDED integration', () => {
  const fixture = createFixture()
  write(fixture.feature, 'lib/competition/reconcile/import.ts', 'export const reconcile = true\n')
  const sourceSha = commit(fixture.feature, 'reconciliation')

  const result = runPreflight(fixture.feature, sourceSha, fixture.base)

  assert.equal(result.status, 1)
  assert.match(result.stdout, /FAST STOPPED — GUARDED TRIGGER: ingestion\/reconciliation\/data-correctness change\n$/)
})

test('security semantics in an otherwise unclassified SQL path require GUARDED integration', () => {
  const fixture = createFixture()
  write(fixture.feature, 'database/policies.sql', 'create policy example_read on example for select using (auth.uid() = owner_id);\n')
  const sourceSha = commit(fixture.feature, 'RLS semantics')

  const result = runPreflight(fixture.feature, sourceSha, fixture.base)

  assert.equal(result.status, 1)
  assert.match(result.stdout, /Guarded trigger: auth\/RLS\/security semantics \(database\/policies\.sql\)/)
  assert.match(result.stdout, /FAST STOPPED — GUARDED TRIGGER: auth\/RLS\/security change\n$/)
})
