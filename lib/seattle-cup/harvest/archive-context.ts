import 'server-only'

import { readFileSync } from 'node:fs'
import type { SeattleCupEditionArchive } from '../archive.ts'
import { verifySeattleCup2026Archive } from '../archive.ts'

let cachedArchive: SeattleCupEditionArchive | null = null

// Finished 2026 context comes only from the immutable checked-in archive. This
// module intentionally has no Golf Genius client or mutable live-cache fallback.
export function loadSeattleCup2026Archive(): SeattleCupEditionArchive {
  if (cachedArchive) return cachedArchive
  const path = new URL('../../../data/seattle-cup/archive/2026.json', import.meta.url)
  const archive = JSON.parse(readFileSync(path, 'utf8')) as SeattleCupEditionArchive
  if (!verifySeattleCup2026Archive(archive)) {
    throw new Error('Seattle Cup 2026 archive integrity check failed')
  }
  cachedArchive = archive
  return archive
}
