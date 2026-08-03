// Generic competition/result domain. No imports, no league/GG shapes — shared
// UI and adapters depend on these types only. "Week" and "Flight" are labels
// supplied by CompetitionConfig, not domain primitives.

export type EventFormat = 'individual' | 'team' | 'unknown'
export type DiscoveryState = 'pending' | 'discovered' | 'inconclusive' | 'failed'
export type ResultStatus = 'live' | 'final' | 'not_started' | 'unknown'
export type View = 'season' | 'weekly' | string
export type ScoringMode = 'gross' | 'net' | string

export interface CompetitionSchedule {
  timezone: string                 // 'America/Los_Angeles' — IANA tz
  playDay?: number                 // 0=Sun..6=Sat; heuristic for reconcile effort only
  windowHours?: number             // nominal live window length after start
  playStartLocal?: string          // '16:00' local start on the play day (config-driven)
}

// Declarative label rule the SERVER interprets to produce Occurrence.label.
// No functions cross the server/client boundary.
export type LabelRule =
  | { kind: 'numberPrefix'; noun: string }
  | { kind: 'event_name' }
  | { kind: 'composite'; noun: string; separator: string }

export interface NavigationOptions {
  occurrenceNoun: 'week' | 'session' | 'round' | 'stage' | string
  queryParam: string
  labelRule: LabelRule
}

export interface ScoringModeAvailability {
  modes: ScoringMode[]             // [] or [gross] → no toggle; [gross, net] → toggle
}

export interface Grouping {
  key: string
  label: string
}

export type GroupingAvailability =
  | { kind: 'none' }
  | { kind: 'single'; grouping: Grouping }
  | { kind: 'multi'; groupings: Grouping[]; defaultAll: boolean }

// Whether groupings are exposed while the occurrence is live. Men's flights are
// unknown until final → 'hide-until-final'; a competition whose groupings are
// known during play (e.g. pre-seeded brackets) uses 'available-while-live'.
export type LiveGroupingPolicy = 'hide-until-final' | 'available-while-live'

export interface CompetitionCapabilities {
  views: View[]
  scoring: ScoringModeAvailability
  supportsLiveResults: boolean
  supportsEventNavigation: boolean
}

export interface OccurrenceCapabilities extends CompetitionCapabilities {
  groupings: GroupingAvailability
}

// Adapter config is opaque to shared code; only the adapter reads it.
// Carries GG ids + secrets — SERVER-ONLY, never sent to client components.
export interface GolfGeniusAdapterConfig {
  seasonId: string
  categoryId: string
  seasonPointsCategoryId?: string
  eventFilter: string               // 'mens' | 'womens'
  tenantKey: string                  // org/tenant scope for cache isolation
  teamFormatOverrides?: number[]     // known scramble occurrence numbers (positive evidence)
  // How an occurrence number maps to a GG round (index into points rounds) and
  // how the active occurrence is found by date window. Server-only.
  roundResolution: 'pointsRoundIndex' | 'byDateWindow'
}

export interface CompetitionConfig {
  key: string
  label: string
  adapter: 'golfgenius'
  adapterConfig: GolfGeniusAdapterConfig  // server-only
  navigation: NavigationOptions
  capabilities: CompetitionCapabilities
  liveGroupingPolicy: LiveGroupingPolicy
  schedule?: CompetitionSchedule
}

export interface ActiveWindow {
  start: string                     // ISO timestamp with offset
  end: string | null                 // null = open-ended (until upstream says final)
}

export interface Occurrence {
  id: string
  number: number | null
  label: string
  date: string | null                // ISO date (competition tz)
  activeWindow: ActiveWindow
  format: EventFormat
  discoveryState: DiscoveryState
  resultStatus: ResultStatus
}

// Durable-current contract (spec §5). `durableCurrent` is DERIVED from a real
// comparison (Task 11), never an arbitrary boolean. When both source and
// durable versions exist, current only when they are EQUAL; otherwise the
// timestamp comparison (durable_imported_at >= source_finalized_at) is used.
export interface DurableCurrentSource {
  sourceFinalizedAt: string | null     // GG finalization timestamp
  sourceVersion: string | null          // GG source version token, if exposed
  durableSourceVersion: string | null   // the source version our import captured
  durableImportedAt: string | null      // our import-completion timestamp
}

// Resolved occurrence — the typed result of GG discovery carrying every
// identifier and finalization datum orchestration needs to import without
// placeholders. Discovery returns it; orchestration passes it to import.
export interface ResolvedOccurrence {
  weekNumber: number
  ggEventId: string | null
  ggRoundId: string | null
  grossTournamentId: string | null
  netTournamentId: string | null
  upstreamStatus: 'completed' | 'in_progress' | 'not_started' | 'unknown'
  roundDate: string | null              // ISO date from the discovered GG round
  eventName: string | null
  sourceFinalizedAt: string | null
  sourceVersion: string | null
}

export interface HoleScore {
  hole: number
  par: number | null
  gross: number | null
  net: number | null
  toPar: number | null
  toParGross: number | null
  cumulativeToPar: number | null
}

export interface Scorecard {
  key: string
  memberCardId: string | null
  name: string
  netTotal: number | null
  grossTotal: number | null
  toParNet: number | null
  toParGross: number | null
  holesCompleted: number
  scorecardStatus: string | null
  isLive: boolean                    // derived card completeness — display hint only, NOT result status
  holes: HoleScore[]
}

export interface ResultEntry {
  key: string
  name: string
  positionLabel: string | null
  positionOrder: number
  points: number | null
  purse: string | null
}

export interface Leaderboard {
  occurrenceId: string
  scoringMode: ScoringMode
  grouping: Grouping | null
  entries: ResultEntry[]
  scorecards: Scorecard[]
  resultStatus: ResultStatus
  durableCurrent: boolean
}

export interface LiveResponse {
  occurrence: Occurrence
  leaderboard: Leaderboard | null
  resultStatus: ResultStatus
  eventFormat: EventFormat
  discoveryState: DiscoveryState
  durableCurrent: boolean
  showingLastKnown: boolean          // true when serving stale cache after upstream error
}
