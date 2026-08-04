// Pure server view-model builder. Produces the plain serializable props the
// client shell renders from. Resolves scoring (URL > stored > default,
// validated), derives capabilities (config-driven grouping policy), and
// normalizes URL state. No React, no DB. See plan issue #16/#17.
//
// Note: this module is imported by a server component, but it is pure logic
// and unit-tested with node --test. Keep it free of React imports.

import { deriveOccurrenceCapabilities } from '../../lib/competition/capabilities.ts'
import { resolveScoring, scoringKey, type ScoringStorage } from '../../lib/competition/scoring-prefs.ts'
import type {
  GroupingAvailability, LiveGroupingPolicy, Occurrence, ResultStatus, ScoringMode, View,
} from '../../lib/competition/types.ts'

export interface UrlState { view: View | null; scoring: ScoringMode | null; grouping: string | null }

export interface ViewModelInput {
  competitionKey: string
  occurrences: Occurrence[]
  selectedOccurrenceId: string | null
  urlState: UrlState
  availableScoringModes: ScoringMode[]
  storedScoring: ScoringMode | null
  availableGroupings: GroupingAvailability
  resultStatus: ResultStatus
  liveGroupingPolicy: LiveGroupingPolicy
  configViews: View[]
  supportsLiveResults: boolean
  supportsEventNavigation: boolean
}

export interface StandingsViewModel {
  competitionKey: string
  selectedOccurrenceId: string | null
  view: View
  scoring: ScoringMode
  grouping: string | null
  occurrences: { id: string; label: string }[]
  capabilities: ReturnType<typeof deriveOccurrenceCapabilities>
}

export function buildStandingsViewModel(input: ViewModelInput): StandingsViewModel {
  // Scoring resolution: URL > stored > default, validated against available.
  const noopStore: ScoringStorage = { getItem: () => input.storedScoring as string | null, setItem: () => {} }
  const defaultMode = input.availableScoringModes[0] ?? 'net'
  const scoring = resolveScoring({
    competitionKey: input.competitionKey,
    urlValue: input.urlState.scoring,
    available: input.availableScoringModes,
    defaultMode,
    store: noopStore,
  })

  const capabilities = deriveOccurrenceCapabilities({
    configViews: input.configViews,
    scoringModes: input.availableScoringModes,
    supportsLiveResults: input.supportsLiveResults,
    supportsEventNavigation: input.supportsEventNavigation,
    availableGroupings: input.availableGroupings,
    resultStatus: input.resultStatus,
    liveGroupingPolicy: input.liveGroupingPolicy,
  })

  // Default view: if the competition supports Weekly / Live, that IS the
  // primary standings view — land on it whenever the URL doesn't name a view.
  // Season Points is secondary (one click away via the hoisted ViewTabs). The
  // primary-view default is NOT conditioned on whether the occurrence resolver
  // happens to believe a live/final occurrence exists — Weekly / Live is the
  // product's default, full stop. See §2.
  const view: View = input.urlState.view
    ?? (input.configViews.includes('weekly') ? 'weekly' : input.configViews[0] ?? 'weekly')
  const grouping = input.urlState.grouping ?? (capabilities.groupings.kind === 'multi' && capabilities.groupings.defaultAll ? 'all' : null)

  return {
    competitionKey: input.competitionKey,
    selectedOccurrenceId: input.selectedOccurrenceId,
    view,
    scoring,
    grouping,
    occurrences: input.occurrences.map((o) => ({ id: o.id, label: o.label })),
    capabilities,
  }
}
