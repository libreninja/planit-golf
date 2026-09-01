#!/usr/bin/env node

// Fetches Planit's normalized Seattle Cup responses, validates the completed
// 2026 edition, and writes a content-hashed JSON archive. This command reads the
// public API only; it performs no database writes.

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import { buildSeattleCup2026Archive } from '../lib/seattle-cup/archive.ts'

function argument(name, fallback) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : fallback
}

const baseUrl = String(argument('--base-url', 'https://www.planit.golf')).replace(/\/$/, '')
const output = resolve(String(argument('--output', 'data/seattle-cup/archive/2026.json')))
const archivedAt = new Date().toISOString()

const responses = await Promise.all([1, 2, 3, 4].map(async (round) => {
  const endpoint = `${baseUrl}/api/seattle-cup/live?round=${round}`
  const response = await fetch(endpoint, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`${endpoint} returned HTTP ${response.status}`)
  return response.json()
}))

const archive = buildSeattleCup2026Archive(responses, { archivedAt, sourceBaseUrl: baseUrl })
await mkdir(dirname(output), { recursive: true })
await writeFile(output, `${JSON.stringify(archive, null, 2)}\n`, { flag: 'wx' })

console.log(JSON.stringify({
  output,
  archivedAt: archive.archivedAt,
  sha256: archive.integrity.contentSha256,
  champion: archive.content.championTeamKey,
  finalStandings: archive.content.finalStandings.map(({ teamKey, totalPoints }) => ({ teamKey, totalPoints })),
  completeness: archive.content.completeness,
}, null, 2))
