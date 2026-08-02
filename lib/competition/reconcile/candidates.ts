// Pure candidate selection. Classifies each persisted event row into one of:
//   active                       — in play window / upstream in_progress / unresolved → discover only
//   played-awaiting-finalization — individual + discovered + in_progress → discover (check status)
//   upstream-finalized           — upstream_status = completed + not yet durable → import + rebuild
//   unknown-unresolved           — event_format unknown/inconclusive → re-discover
//   old-current                  — already durably imported → skip
// Finalized import is authorized by UPSTREAM STATUS (completed), never by
// recency. See design spec §5 + plan issue #14.

export interface CandidateEvent {
  week_number: number
  event_date: string | null
  event_format: 'individual' | 'team' | 'unknown' | null
  discovery_state: 'pending' | 'discovered' | 'inconclusive' | 'failed' | null
  upstream_status: 'completed' | 'in_progress' | 'not_started' | null
  durable_imported_at: string | null
}

export type CandidateKind = 'active' | 'played-awaiting-finalization' | 'upstream-finalized' | 'unknown-unresolved' | 'old-current'
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

export function selectReconciliationCandidates(events: CandidateEvent[], _nowIso: string): Candidate[] {
  return events.map((e) => {
    const fmt = e.event_format ?? 'unknown'
    const ds = e.discovery_state ?? 'pending'
    const ups = e.upstream_status

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
  })
}
