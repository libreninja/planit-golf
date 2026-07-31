// Pure capability derivation. The UI reads only the resulting
// OccurrenceCapabilities to decide which controls render. No league
// assumptions. See design spec §6/§8.
//
// Grouping exposure is CONFIG-DRIVEN via liveGroupingPolicy, not a universal
// "live → none" rule: men's flights are unknown until final so the policy is
// 'hide-until-final'; a competition whose groupings are known during play
// passes 'available-while-live' and keeps them. The caller passes the durable
// availableGroupings (from finalized rows / configured groupings); this
// function applies the policy.

import type {
  GroupingAvailability,
  LiveGroupingPolicy,
  OccurrenceCapabilities,
  ResultStatus,
  ScoringMode,
  ScoringModeAvailability,
  View,
} from './types.ts'

export interface CapabilityInput {
  configViews: View[]
  scoringModes: ScoringMode[]            // resolved list; becomes scoring.modes
  supportsLiveResults: boolean
  supportsEventNavigation: boolean
  availableGroupings: GroupingAvailability
  resultStatus: ResultStatus
  liveGroupingPolicy: LiveGroupingPolicy
}

export function deriveOccurrenceCapabilities(input: CapabilityInput): OccurrenceCapabilities {
  const maskLive =
    input.liveGroupingPolicy === 'hide-until-final' &&
    input.resultStatus === 'live' &&
    input.availableGroupings.kind === 'multi'
  const groupings: GroupingAvailability = maskLive ? { kind: 'none' } : input.availableGroupings
  const scoring: ScoringModeAvailability = { modes: input.scoringModes }
  return {
    views: input.configViews,
    scoring,
    supportsLiveResults: input.supportsLiveResults,
    supportsEventNavigation: input.supportsEventNavigation,
    groupings,
  }
}