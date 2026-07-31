// Pure durable-current decision (spec §5 + the version-contract correction).
// The live read path uses this to decide when to stop slow post-final polling:
// once our durable import has captured the finalized upstream state, the
// durable path is current and the live path no longer needs to refresh.
// Derived from a REAL comparison — never an arbitrary boolean.
//
// Two comparison modes, in priority order:
//   1. VERSION EQUALITY (authoritative): when BOTH sourceVersion and
//      durableSourceVersion are present, current iff they are equal. This is
//      immune to clock skew. A single version with no counterpart is NOT
//      proof of anything — fall through to the timestamp comparison.
//   2. TIMESTAMP FALLBACK: current iff durableImportedAt >= sourceFinalizedAt.
//      Used when GG does not expose a comparable version token on one or both
//      sides. Requires both timestamps to be parseable.
//
// The previous "if (src.sourceVersion) return true" single-version shortcut was
// a bug: a stored source version alone says nothing about whether the durable
// import captured THAT version. Both sides must carry a version for equality
// to be meaningful.

import type { DurableCurrentSource } from './types.ts'

export function isDurableCurrent(src: DurableCurrentSource): boolean {
  if (!src.durableImportedAt) return false
  if (!src.sourceFinalizedAt && !src.sourceVersion) return false

  // 1. Version equality — only when BOTH sides carry a version.
  if (src.sourceVersion != null && src.durableSourceVersion != null) {
    return src.sourceVersion === src.durableSourceVersion
  }

  // 2. Timestamp fallback.
  if (!src.sourceFinalizedAt) return false
  const fin = Date.parse(src.sourceFinalizedAt)
  const imp = Date.parse(src.durableImportedAt)
  if (!Number.isFinite(fin) || !Number.isFinite(imp)) return false
  return imp >= fin
}