#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const FAILURE_STATES = new Set(['error', 'failure', 'inactive'])

function parseArgs(argv) {
  const options = { pollSeconds: 5, timeoutSeconds: 900 }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--') continue
    if (argument === '--help' || argument === '-h') return { help: true }
    if (!argument.startsWith('--') && !options.sha) {
      options.sha = argument
      continue
    }
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`missing value for ${argument}`)
    if (argument === '--repo') options.repo = value
    else if (argument === '--timeout-seconds') options.timeoutSeconds = Number(value)
    else if (argument === '--poll-seconds') options.pollSeconds = Number(value)
    else throw new Error(`unknown argument: ${argument}`)
    index += 1
  }
  if (!/^[0-9a-f]{40}$/i.test(options.sha || '')) throw new Error('merged main SHA must be a full 40-character commit SHA')
  if (!(options.timeoutSeconds > 0) || !(options.pollSeconds > 0)) {
    throw new Error('timeout and poll intervals must be positive numbers')
  }
  return options
}

function inferRepository() {
  const remote = execFileSync('git', ['config', '--get', 'remote.origin.url'], { encoding: 'utf8' }).trim()
  const match = remote.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/)
  if (!match) throw new Error('could not infer GitHub repository; pass --repo <owner/name>')
  return match[1]
}

function ghJson(args) {
  const output = execFileSync('gh', ['api', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return JSON.parse(output)
}

function newest(items, timestampField) {
  return [...items].sort((left, right) => String(right[timestampField] || '').localeCompare(String(left[timestampField] || '')))[0]
}

function isVercelActor(record) {
  return record?.creator?.login === 'vercel[bot]'
}

function findDeployment(repo, sha) {
  const deployments = ghJson([
    '--method',
    'GET',
    `repos/${repo}/deployments`,
    '-f',
    `sha=${sha}`,
    '-f',
    'environment=Production',
    '-f',
    'per_page=50',
  ])
  return newest(
    deployments.filter(
      (deployment) =>
        deployment.sha === sha && deployment.environment?.toLowerCase() === 'production' && isVercelActor(deployment)
    ),
    'created_at'
  )
}

function findStatus(repo, deploymentId) {
  const statuses = ghJson(['--method', 'GET', `repos/${repo}/deployments/${deploymentId}/statuses`, '-f', 'per_page=50'])
  return newest(
    statuses.filter(
      (status) => status.environment?.toLowerCase() === 'production' && isVercelActor(status)
    ),
    'updated_at'
  )
}

function printResult(deployment, status, sha) {
  console.log(`Deployment ID: ${deployment.id}`)
  console.log(`Target: ${deployment.environment}`)
  console.log(`State: ${status.state}`)
  console.log(`Git SHA: ${deployment.sha} (${deployment.sha === sha ? 'match' : 'mismatch'})`)
  if (status.environment_url || status.target_url) console.log(`URL: ${status.environment_url || status.target_url}`)
}

const wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds))

export async function run(argv) {
  let options
  try {
    options = parseArgs(argv)
    if (options.help) {
      console.log(`Usage: pnpm integration:deployment -- <merged-main-sha> [options]

Options:
  --repo <owner/name>       GitHub repository (default: inferred from origin)
  --timeout-seconds <n>     Maximum wait (default: 900)
  --poll-seconds <n>        Poll interval (default: 5)`)
      return
    }
    options.repo ||= inferRepository()
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
    return
  }

  const deadline = Date.now() + options.timeoutSeconds * 1000
  while (Date.now() <= deadline) {
    try {
      const deployment = findDeployment(options.repo, options.sha)
      const status = deployment ? findStatus(options.repo, deployment.id) : null
      if (deployment && status?.state === 'success') {
        printResult(deployment, status, options.sha)
        console.log('READY')
        return
      }
      if (deployment && status && FAILURE_STATES.has(status.state)) {
        printResult(deployment, status, options.sha)
        console.log('DEPLOYMENT FAILED')
        process.exitCode = 1
        return
      }
    } catch (error) {
      console.error(`GitHub deployment status query failed: ${error.stderr?.toString().trim() || error.message}`)
      process.exitCode = 1
      return
    }
    await wait(options.pollSeconds * 1000)
  }

  console.error(`Timed out waiting for Vercel Production deployment for ${options.sha}`)
  process.exitCode = 1
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (isMain) await run(process.argv.slice(2))
