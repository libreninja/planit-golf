#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const READ_ONLY_ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0' }

function parseArgs(argv) {
  const options = { worktree: process.cwd(), mainRef: 'origin/main' }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--') continue
    if (argument === '--help' || argument === '-h') return { help: true }
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`missing value for ${argument}`)
    if (argument === '--worktree') options.worktree = resolve(value)
    else if (argument === '--source') options.source = value
    else if (argument === '--source-sha') options.sourceSha = value
    else if (argument === '--base-sha') options.baseSha = value
    else if (argument === '--main-ref') options.mainRef = value
    else throw new Error(`unknown argument: ${argument}`)
    index += 1
  }
  return options
}

function git(worktree, args, { allowFailure = false } = {}) {
  try {
    return execFileSync('git', ['-C', worktree, ...args], {
      encoding: 'utf8',
      env: READ_ONLY_ENV,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch (error) {
    if (allowFailure) return null
    const detail = error.stderr?.toString().trim() || error.message
    throw new Error(`git ${args.join(' ')} failed: ${detail}`)
  }
}

function resolveCommit(worktree, revision) {
  if (!revision) return null
  return git(worktree, ['rev-parse', '--verify', `${revision}^{commit}`], { allowFailure: true })
}

function isAncestor(worktree, ancestor, descendant) {
  try {
    execFileSync('git', ['-C', worktree, 'merge-base', '--is-ancestor', ancestor, descendant], {
      env: READ_ONLY_ENV,
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
}

function mergeTree(worktree, baseSha, mainSha, sourceSha) {
  // The three-tree form performs analysis only. Unlike --write-tree, it does
  // not add the synthetic merge tree to the repository object database.
  const result = spawnSync('git', ['-C', worktree, 'merge-tree', baseSha, mainSha, sourceSha], {
    encoding: 'utf8',
    env: READ_ONLY_ENV,
  })
  const output = `${result.stdout}\n${result.stderr}`
  const hasConflict = /[<=>]{7}|\bCONFLICT\b/.test(output)
  return { clean: result.status === 0 && !hasConflict }
}

function changedPaths(worktree, from, to) {
  const output = git(worktree, ['diff', '--name-only', '--no-renames', from, to])
  return output ? output.split('\n').filter(Boolean).sort() : []
}

function printPaths(label, paths) {
  console.log(`${label}:`)
  if (paths.length === 0) console.log('  (none)')
  else for (const path of paths) console.log(`  ${path}`)
}

function guardedPathTrigger(worktree, from, to, paths) {
  const migration = paths.find((path) =>
    /^(supabase\/(?:migrations|migrations-archive)\/|supabase\/(?:seed\.sql|config\.toml)$|scripts\/run-migration\.mjs$|.*(?:^|\/)(?:schema|migration)[^/]*\.sql$)/.test(
      path
    )
  )
  if (migration) return { classification: 'migration/schema change', fact: `migration/schema (${migration})` }
  const authSecurity = paths.find((path) =>
    /^(app\/middleware\.ts$|app\/auth\/callback\/|components\/auth\/|lib\/auth(?:-providers)?\.ts$|lib\/supabase\/(?:middleware|server|service)\.ts$|proxy\.ts$|supabase\/.*(?:rls|security|privilege|acl))/.test(path)
  )
  if (authSecurity) {
    return { classification: 'auth/RLS/security change', fact: `auth/RLS/security (${authSecurity})` }
  }
  const securitySql = paths.find((path) => {
    if (!path.endsWith('.sql')) return false
    const patch = git(worktree, ['diff', '--unified=0', from, to, '--', path])
    return /(?:create|alter|drop)\s+policy|row\s+level\s+security|\b(?:grant|revoke)\b|security\s+definer|auth\.uid\s*\(/i.test(
      patch
    )
  })
  if (securitySql) {
    return {
      classification: 'auth/RLS/security change',
      fact: `auth/RLS/security semantics (${securitySql})`,
    }
  }
  const securitySemantics = paths.find((path) => {
    if (!/^(?:app|components|lib)\/.*\.[cm]?[jt]sx?$|^proxy\.ts$/.test(path)) return false
    const patch = git(worktree, ['diff', '--unified=0', from, to, '--', path])
    return /\b(?:requireAuth|requireAdmin|getProfileRoles|is_system_admin|is_admin|SUPABASE_SERVICE_ROLE_KEY|service_role|entitlement)\b|\.auth\.|auth\.getUser\s*\(/.test(
      patch
    )
  })
  if (securitySemantics) {
    return {
      classification: 'auth/RLS/security change',
      fact: `auth/RLS/security semantics (${securitySemantics})`,
    }
  }
  const deployment = paths.find((path) =>
    /^(vercel\.json$|\.vercel\/repo\.json$|\.github\/workflows\/|app\/api\/cron\/|\.env(?:\.|$))/.test(path)
  )
  if (deployment) {
    return {
      classification: 'deployment/environment/cron config change',
      fact: `deployment/environment/cron config (${deployment})`,
    }
  }
  const tooling = paths.find((path) =>
    /^(package\.json$|pnpm-lock\.yaml$|pnpm-workspace\.yaml$|next\.config\.[^.]+$|tsconfig\.json$|turbo\.json$|Dockerfile$|\.nvmrc$|\.node-version$)/.test(path)
  )
  if (tooling) {
    return {
      classification: 'package/runtime/build-pipeline change',
      fact: `package/runtime/build-pipeline (${tooling})`,
    }
  }
  const dataCorrectness = paths.find((path) =>
    /^(lib\/competition\/(?:adapters|reconcile)\/|scripts\/(?:sync-[^/]+|archive-[^/]+|member-overrides(?:\.|$)))/.test(path)
  )
  if (dataCorrectness) {
    return {
      classification: 'ingestion/reconciliation/data-correctness change',
      fact: `ingestion/reconciliation/data-correctness (${dataCorrectness})`,
    }
  }
  return null
}

function stop(reason) {
  console.log(`FAST STOPPED — GUARDED TRIGGER: ${reason}`)
  process.exitCode = 1
}

export function runPreflight(argv) {
  let options
  try {
    options = parseArgs(argv)
  } catch (error) {
    console.error(error.message)
    stop('invalid preflight arguments')
    return
  }

  if (options.help) {
    console.log(`Usage: pnpm integration:preflight -- --source-sha <sha> --base-sha <sha> [options]

Options:
  --worktree <path>  Source worktree (default: current directory)
  --source <branch>  Expected source branch (default: detected branch)
  --main-ref <ref>   Current main ref (default: origin/main)`)
    return
  }

  const exactSourceInput = /^[0-9a-f]{40}$/i.test(options.sourceSha || '')
  const exactBaseInput = /^[0-9a-f]{40}$/i.test(options.baseSha || '')
  const sourceSha = exactSourceInput ? resolveCommit(options.worktree, options.sourceSha) : null
  const baseSha = exactBaseInput ? resolveCommit(options.worktree, options.baseSha) : null
  const mainSha = resolveCommit(options.worktree, options.mainRef)
  const headSha = resolveCommit(options.worktree, 'HEAD')
  const sourceBranch = git(options.worktree, ['branch', '--show-current']) || '(detached)'
  const clean = git(options.worktree, ['status', '--porcelain=v1', '--untracked-files=all']) === ''

  console.log(`Source worktree: ${options.worktree}`)
  console.log(`Source branch: ${sourceBranch}`)
  console.log(`Source HEAD: ${headSha || 'unknown'}`)
  console.log(`READY SHA: ${sourceSha || 'unknown'}`)
  console.log(`READY SHA match: ${sourceSha && headSha === sourceSha ? 'yes' : 'no'}`)
  console.log(`Worktree clean: ${clean ? 'yes' : 'no'}`)
  console.log(`Base SHA: ${baseSha || 'unknown'}`)
  console.log(`Current ${options.mainRef}: ${mainSha || 'unknown'}`)

  if (!sourceSha || !baseSha || !mainSha || !headSha) {
    stop('unknown source/base/main SHA (READY SHAs must be full 40-character commit IDs)')
    return
  }
  if (options.source && options.source !== sourceBranch) {
    stop(`source branch mismatch (expected ${options.source}, found ${sourceBranch})`)
    return
  }
  if (!clean) {
    stop('dirty worktree')
    return
  }
  if (headSha !== sourceSha) {
    stop('source verification mismatch')
    return
  }
  if (!isAncestor(options.worktree, baseSha, sourceSha)) {
    stop('READY base is not an ancestor of source')
    return
  }

  const counts = git(options.worktree, ['rev-list', '--left-right', '--count', `${baseSha}...${sourceSha}`])
    .split(/\s+/)
    .map(Number)
  console.log(`Ahead/behind READY base: ${counts[1]}/${counts[0]}`)
  console.log(`READY base ancestor of main: ${isAncestor(options.worktree, baseSha, mainSha) ? 'yes' : 'no'}`)
  const sourcePaths = changedPaths(options.worktree, baseSha, sourceSha)
  const mainPaths = changedPaths(options.worktree, baseSha, mainSha)
  printPaths('Source changed paths', sourcePaths)
  printPaths('Main advancement changed paths', mainPaths)
  const overlappingPaths = sourcePaths.filter((path) => mainPaths.includes(path))
  console.log(`Changed-path overlap: ${overlappingPaths.length ? `yes (${overlappingPaths.join(', ')})` : 'no'}`)
  const guarded = guardedPathTrigger(options.worktree, baseSha, sourceSha, sourcePaths)
  const guardedMain = guardedPathTrigger(options.worktree, baseSha, mainSha, mainPaths)
  console.log(`Guarded trigger: ${guarded?.fact || guardedMain?.fact || 'none'}`)

  const mainUnchanged = mainSha === baseSha
  const merge = mainUnchanged ? { clean: true } : mergeTree(options.worktree, baseSha, mainSha, sourceSha)
  console.log(`Merge tree: ${merge.clean ? 'clean (read-only analysis)' : 'conflict/unknown'}`)

  // With rename detection disabled, a conflict-free merge and zero exact path
  // overlap preserve every feature-owned blob byte-for-byte.
  const featureBlobsIntact = merge.clean && overlappingPaths.length === 0
  const expectedTree = mainUnchanged
    ? 'verified source tree'
    : merge.clean && featureBlobsIntact
      ? 'deterministic composite; feature-owned blobs intact'
      : 'uncertain composite'
  console.log(`Expected tree: ${expectedTree}`)

  if (guarded) {
    stop(guarded.classification)
    return
  }
  if (!isAncestor(options.worktree, baseSha, mainSha)) {
    stop('material main advancement (READY base is not an ancestor)')
    return
  }
  if (guardedMain) {
    stop(`material main advancement (${guardedMain.classification})`)
    return
  }
  if (overlappingPaths.length) {
    stop(`material/overlapping main advancement (${overlappingPaths.join(', ')})`)
    return
  }
  if (!merge.clean || !featureBlobsIntact) {
    stop('merge conflict/uncertain composite tree')
    return
  }
  console.log('FAST ELIGIBLE')
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (isMain) {
  try {
    runPreflight(process.argv.slice(2))
  } catch (error) {
    console.error(error.message)
    stop(`preflight inspection failed: ${error.message}`)
  }
}
