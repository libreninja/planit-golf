// Pure candidate selection. Classifies each persisted event row into one of:
//   active                       — in play window / upstream in_progress / unresolved → discover only
//   played-awaiting-finalization — individual + discovered + in_progress → discover (check status)
//   upstream-finalized           — upstream_status = completed + not yet durable → import + rebuild
//   awaiting-official-flights    — durable scoring exists but Men's official flight membership does not → discover
//   unknown-unresolved           — event_format unknown/inconclusive → re-discover
//   old-current                  — already durably imported → skip
//   stale                        — last GG discovery was < STALENESS_MS ago → skip
// Finalized import is authorized by UPSTREAM STATUS (completed), never by
// recency. See design spec §5 + plan issue #14.
//
// STALENESS GATE: when reconcile runs frequently (pg_cron every ~2 min, see
// migration _reconcile_frequent.sql), a candidate that was already discovered
// from GG within STALENESS_MS is skipped this run rather than re-read. This is
// the "more than a minute since the data refreshed → read through to GG and
// update the DB" rule: a round is re-read at most once per minute. It also
// makes a faster cadence overlap-safe (two runs within a minute can't both
// re-discover the same occurrence). A round whose `discovered_at` is older than
// the threshold, or absent, is processed normally. Already-skipped candidates
// (old-current) are unaffected — the gate never re-enables work.

// Don't re-read GG for a candidate discovered within the last minute. Kept
// generous (60s) so the default 2-min cadence re-discovers the in-progress
// round every tick (2 min > 60s → not stale) while preventing sub-minute
// double-discovery on overlapping runs.
export const STALENESS_MS = 60_000

export interface CandidateEvent {
  week_number: number
  event_date: string | null
  event_format: 'individual' | 'team' | 'unknown' | null
  discovery_state: 'pending' | 'discovered' | 'inconclusive' | 'failed' | null
  upstream_status: 'completed' | 'in_progress' | 'not_started' | null
  durable_imported_at: string | null
  // Narrow Men’s League repair signal derived from stored canonical Flight
  // 1/2/3 result membership. Scoring can already be durable while official
  // flight membership is still unavailable. Optional so other competitions
  // and legacy callers retain their existing behavior.
  awaiting_official_flights?: boolean
  // Last time discovery read this occurrence from GG (igc_league_events
  // .discovered_at, refreshed on every discoverAndPersist). Optional: legacy
  // callers / tests that omit it are never gated (absent → always process).
  discovered_at?: string | null
}

export type CandidateKind = 'active' | 'played-awaiting-finalization' | 'upstream-finalized' | 'awaiting-official-flights' | 'unknown-unresolved' | 'old-current' | 'stale'
export type CandidateAction = 'discover' | 'import' | 'skip'

export interface Candidate {
  week_number: number
  kind: CandidateKind
  action: CandidateAction
}

// Whether the row is still unresolved (no positive format/classification yet).
function unresolved(fmt: string, ds: string): boolean {
  return fmt === 'unknown' || ds === 'inconclusive' || ds === 'pending' || ds === 'failed'
}

function classifyEvent(e: CandidateEvent): Candidate {
  const fmt = e.event_format ?? 'unknown'
  const ds = e.discovery_state ?? 'pending'
  const ups = e.upstream_status

  if (ups === 'completed' && e.durable_imported_at && e.awaiting_official_flights) {
    return { week_number: e.week_number, kind: 'awaiting-official-flights', action: 'discover' as const }
  }
  if (ups === 'completed' && e.durable_imported_at) {
    return { week_number: e.week_number, kind: 'old-current', action: 'skip' as const }
  }
  if (ups === 'completed' && !e.durable_imported_at) {
    return { week_number: e.week_number, kind: 'upstream-finalized', action: 'import' as const }
  }
  // In-progress rows: unresolved → still actively in play (discover only);
  // resolved individual → played, awaiting finalization (discover to recheck).
  if (ups === 'in_progress') {
    if (unresolved(fmt, ds)) {
      return { week_number: e.week_number, kind: 'active', action: 'discover' as const }
    }
    return { week_number: e.week_number, kind: 'played-awaiting-finalization', action: 'discover' as const }
  }
  // No upstream progress signal: unresolved → re-discover to resolve it.
  if (unresolved(fmt, ds)) {
    return { week_number: e.week_number, kind: 'unknown-unresolved', action: 'discover' as const }
  }
  // Discovered individual, no upstream status signal, not durable → still
  // active/awaiting; re-discover to refresh status.
  if (fmt === 'individual' && !e.durable_imported_at) {
    return { week_number: e.week_number, kind: 'active', action: 'discover' as const }
  }
  return { week_number: e.week_number, kind: 'old-current', action: 'skip' as const }
}

export function selectReconciliationCandidates(events: CandidateEvent[], nowIso: string): Candidate[] {
  const nowMs = nowIso ? Date.parse(nowIso) : Date.now()
  return events.map((e) => {
    const base = classifyEvent(e)
    // Staleness gate: skip a candidate whose last GG discovery was within
    // STALENESS_MS (see module note). Skip candidates (old-current) and
    // candidates with no discovered_at are never gated.
    if (base.action !== 'skip' && e.discovered_at) {
      const ageMs = nowMs - Date.parse(e.discovered_at)
      if (Number.isFinite(ageMs) && ageMs <= STALENESS_MS) {
        return { week_number: e.week_number, kind: 'stale' as const, action: 'skip' as const }
      }
    }
    return base
  })
}
