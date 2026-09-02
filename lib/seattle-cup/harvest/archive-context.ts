import 'server-only'

import seattleCup2026Archive from '@/data/seattle-cup/archive/2026.json'
import type { SeattleCupEditionArchive } from '../archive.ts'
import { verifySeattleCup2026Archive } from '../archive.ts'

let cachedArchive: SeattleCupEditionArchive | null = null

// Finished 2026 context comes only from the immutable checked-in archive. This
// module intentionally has no Golf Genius client or mutable live-cache fallback.
export function loadSeattleCup2026Archive(): SeattleCupEditionArchive {
  if (cachedArchive) return cachedArchive
  // Static import keeps the immutable archive inside the Next server bundle.
  // Runtime-relative URL resolution produced a cross-realm URL in the Vercel
  // bundle that node:fs rejected at runtime.
  const archive = seattleCup2026Archive as unknown as SeattleCupEditionArchive
  if (!verifySeattleCup2026Archive(archive)) {
    throw new Error('Seattle Cup 2026 archive integrity check failed')
  }
  cachedArchive = archive
  return archive
}
