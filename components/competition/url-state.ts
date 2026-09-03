// Pure URL/query-state normalization. No Next imports — operates on
// URLSearchParams so it's unit-testable. Relative imports only (no @/ alias)
// so node --test can load it.

import type { ScoringMode, View } from '../../lib/competition/types.ts'

export interface NormalizeUrlStateOptions {
  occurrenceParam: string
  allowedViews: View[]
  allowedScoring: ScoringMode[]
}

export interface NormalizedUrlState {
  view: View | null
  occurrenceId: string | null
  scoring: ScoringMode | null
  grouping: string | null
  placedOnly: boolean
}

export function normalizeUrlState(params: URLSearchParams, opts: NormalizeUrlStateOptions): NormalizedUrlState {
  const rawView = params.get('view')
  const view: View | null = rawView && opts.allowedViews.includes(rawView) ? (rawView as View) : null
  const occurrenceId = params.get(opts.occurrenceParam)
  const rawScoring = params.get('scoring')
  const scoring: ScoringMode | null = rawScoring && opts.allowedScoring.includes(rawScoring as ScoringMode) ? (rawScoring as ScoringMode) : null
  const grouping = params.get('grouping')
  const placedOnly = params.get('placed') === 'only'
  return { view, occurrenceId, scoring, grouping, placedOnly }
}
