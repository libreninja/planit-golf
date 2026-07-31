# Standings Redesign + Reusable Competition Capability — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the two standings data bugs (live week absent, season points lagging one week) and rebuild the Standings page as a live, scoreboard-style experience on a reusable, capability-driven competition abstraction that Men's and Women's League configure (and Seattle Cup can later adopt).

**Architecture:** A generic `lib/competition/` domain (types, classification, active-window, result-status, durable-current, capabilities, cache, reconcile) plus a Golf Genius adapter. A live read path (server-side GG discovery **from config, not persisted rows** + coalesced cache + stale-while-error) is separated from a durable reconciliation path (idempotent import + season-points rebuild, run by an hourly cron with one shared budget deadline). Shared `components/competition/*` UI renders from capabilities + plain data only. Existing `igc_league_*` tables are reused; the adapter maps them onto the generic types. The overloaded `gg_tournament_id IS NULL` team-event signal is replaced by an explicit `event_format` / `discovery_state` model, and result status is derived from upstream lifecycle + configured window + durable state — never from `Scorecard.isLive`.

**Tech Stack:** Next.js 16 App Router (TypeScript), Supabase (PostgreSQL + RLS), Tailwind + shadcn/ui, Node 24 built-in test runner (`node --test`) for pure unit tests, Playwright for smoke tests, pnpm.

## Global Constraints

- **Package manager:** `pnpm` (required). Never use npm/yarn.
- **Unit tests:** pure logic only, run with `node --test tests/<file>.test.ts`. Node 24 strips TS types natively — use relative imports (no `@/` alias) in test files. No DB/network/auth in unit tests.
- **Migrations:** additive, filename-ordered in `supabase/migrations/`. Next number is `026`. Never drop/retype existing columns.
- **No league-schema leakage:** `components/competition/*` and `lib/competition/types.ts` import only generic domain types — never `igc_league_*` shapes, `league_key`, `week_number`, `flight_name`, or GG field names. All mapping lives in the adapter and server wrapper.
- **Server-only config:** `CompetitionConfig` (adapter ids, schedule, label rules) never crosses to client components. Client components receive only plain serializable data + capabilities.
- **No hardcoded league days in shared code:** Tuesday/Wednesday live only in league config `schedule`, never in `lib/competition/*` or `components/competition/*`.
- **A null external id is data absence, not a semantic classification.** Never infer `team` from `gg_tournament_id IS NULL` or from "no individual tournaments found."
- **Live discovery must not depend on a persisted row.** `getLiveResults` resolves the active occurrence directly from the configured GG season/category + selected occurrence context. Persisted ids are hints only; stale hints fall back to full discovery. Persisted tournament ids are never synthesized as `individual` — their results are fetched/verified first, with full discovery as fallback.
- **Team classification is positive-evidence only.** Only explicit upstream metadata or an explicit config override may produce `eventFormat='team'`. A name match guides discovery or yields `unknown`/`inconclusive`; it cannot independently produce `team`.
- **Result status comes from the upstream lifecycle, not `Scorecard.isLive`.** Combine upstream round/tournament status + configured active window + results presence/completeness + durable finalization state. Absence of a partial card ≠ finality.
- **Completed-round guard stays** for season points; reconciliation re-runs after finalization (checking upstream status again) instead of dropping the guard.
- **Cache is service-role-only.** `competition_live_cache` has RLS enabled with NO public SELECT policy. Server routes read/write via the service client. The cache key includes tenant/organization scope.
- **Cache promise is best-effort.** "Approximately one upstream request per TTL window under normal operation, with possible duplicate requests during concurrent cold misses." Never promise strict cross-instance single-flight.
- **Lint must pass:** `pnpm lint` (`eslint . --max-warnings 0`).
- **Commit each task.** End every task with a commit.

---

## File Structure

**New files — `lib/competition/` (generic, no league/GG leakage in types + capabilities + UI-facing):**

- `lib/competition/types.ts` — domain types (CompetitionConfig, Occurrence, capabilities, Leaderboard, DurableCurrentSource, ResultStatusInput). Pure types, no imports.
- `lib/competition/classify.ts` — pure: `nameKind(name)` hint + `classifyEventFormat({ tournaments, teamOverride })` → EventFormat + DiscoveryState. Unit-tested.
- `lib/competition/active-window.ts` — pure: `isOccurrenceActive(window, nowIso, upstreamInProgress)`. Unit-tested.
- `lib/competition/result-status.ts` — pure: `deriveResultStatus(input)` from upstream lifecycle + window + completeness + durable. Unit-tested.
- `lib/competition/durable-current.ts` — pure: `isDurableCurrent(source)` comparing source-finalized version vs durable-imported timestamp. Unit-tested.
- `lib/competition/capabilities.ts` — pure: `deriveOccurrenceCapabilities(input)` with config-driven `liveGroupingPolicy`. Unit-tested.
- `lib/competition/scoring-prefs.ts` — pure: `scoringKey`, `resolveScoring`, `writeScoringPref`. Unit-tested.
- `lib/competition/cache-keys.ts` — pure: tenant-scoped `resultsCacheKey`, `discoveryCacheKey`. Unit-tested.
- `lib/competition/cache.ts` — DB-backed short-TTL cache + in-process single-flight + stale-while-error. Structured-arg API. Uses `createServiceClient`.
- `lib/competition/live.ts` — `getLiveResults(competitionKey, occurrenceId, scoring)` shared live read (config-driven discovery + results + cache + stale-while-error).
- `lib/competition/configs/mens-league.ts`, `lib/competition/configs/womens-league.ts` — CompetitionConfig (incl. `liveGroupingPolicy`, window construction config, tenant key).
- `lib/competition/registry.ts` — `getCompetitionConfig(key)`, `allCompetitionConfigs()`.
- `lib/competition/adapters/golfgenius/discovery.ts` — GG discovery from config (resolve parent event/round/tournaments), classify (positive evidence), normalize. DI for GG client.
- `lib/competition/adapters/golfgenius/normalize.ts` — pure: parse GG tournament results → generic Leaderboard/Scorecard. Unit-tested with fixtures.
- `lib/competition/adapters/golfgenius/mapping.ts` — map `igc_league_*` DB rows ↔ generic Occurrence/Leaderboard + configured active-window construction. Server-only.
- `lib/competition/reconcile/gg-helpers.ts` — extracted pure-ish helpers from the existing sync (`pickIndividualTournaments`, `parsePosition`, `parseNum`, `countCompletedHoles`, `totalOut`, `isSideOrTeamCompetition`).
- `lib/competition/reconcile/discover.ts` — durable: discover + persist `event_format`/`discovery_state` for an occurrence.
- `lib/competition/reconcile/import.ts` — durable: import finalized performances + results idempotently (DI for GG client + DB).
- `lib/competition/reconcile/season-points.ts` — durable: rebuild cumulative snapshot (completed-round guard kept).
- `lib/competition/reconcile/candidates.ts` — pure: `selectReconciliationCandidates(events, now)` → active/awaiting-finalization/upstream-finalized/unknown/old.
- `lib/competition/reconcile/reconcile.ts` — `reconcileCompetition(competitionKey, deadlineMs)`, `reconcileAllCompetitions(deadlineMs)` (one shared absolute deadline).

**New files — `components/competition/`:**

- `standings-workspace.tsx` — client shell: tabs (if >1 view), controls, table slot.
- `standings-view-model.ts` — pure server view-model builder. Unit-tested.
- `url-state.ts` — pure URL/query-state normalization. Unit-tested.
- `occurrence-nav.tsx`, `scoring-toggle.tsx`, `grouping-filter.tsx` — client controls.
- `leaderboard.tsx`, `scorecard.tsx` — client: one focused table + expandable card.
- `status-badge.tsx`, `states.tsx` — client: LIVE/FINAL + loading/empty/unavailable/team.
- `use-live-poll.ts` — client hook: bounded live/post-final polling using a pure `nextPollDecision`.
- `next-poll-decision.ts` — pure: polling state machine. Unit-tested with fake timers.

**New files — routes / tests:**

- `app/api/competition/live/route.ts` — generic live endpoint.
- `app/api/cron/reconcile/route.ts` — scheduled reconciliation.
- `supabase/migrations/026_igc_league_event_format.sql` — event_format/discovery_state/discovered_at + durable-current columns + backfill.
- `supabase/migrations/027_competition_live_cache.sql` — cache table (RLS, no public SELECT, tenant key).
- `tests/competition-*.test.ts` — pure unit tests (one per pure module).
- `tests/integration/*.mjs` (run against local Supabase)
- `scripts/sync-igc-league.mjs` — rewritten as thin CLI → `lib/competition/reconcile`.

**Modified files:**

- `app/api/igc/league/live/route.ts` — rewritten as compatibility handler calling `getLiveResults` (no redirect).
- `components/igc/league-standings-view.tsx` — rewritten as thin server wrapper → `<StandingsWorkspace>`.
- `app/igc/mens-league/page.tsx`, `app/igc/womens-league/page.tsx` — forward widened search params.
- `vercel.json` — add hourly cron.
- `package.json` — add `test:unit`, `reconcile` scripts.
- `tests/smoke.spec.ts` — extend with men's/women's standings assertions.

---

## Phase 1 — Data Model & Pure Domain (no DB, no UI)

### Task 1: Add `test:unit` script and run baseline

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the unit-test script**

In `package.json` `scripts`, add after `"test:smoke:headed"`:

```json
    "test:unit": "node --test tests/*.test.ts",
```

- [ ] **Step 2: Run existing unit tests to confirm green baseline**

Run: `pnpm test:unit`
Expected: all existing tests pass (`event-selection`, `refresh-schedule`, `activity-format`).

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "test: add test:unit script for node --test runner"
```

---

### Task 2: Migration 026 — explicit event format + discovery state + durable-current columns

**Files:**
- Create: `supabase/migrations/026_igc_league_event_format.sql`

This is SQL, not TDD. Verify by running the migration locally and inspecting columns. The durable-current columns are added here so the contract in Task 11 and the reconciliation in Phase 4 have columns to write.

- [ ] **Step 1: Write the migration**

`supabase/migrations/026_igc_league_event_format.sql`:

```sql
-- Replace the overloaded `gg_tournament_id IS NULL` team-event signal with an
-- explicit, independently-stored event format and discovery state. A null
-- external id is data absence, not a semantic classification (see design spec
-- §3). Also adds the durable-current contract columns (spec §5): the
-- reconciler records when the upstream source was finalized and when our
-- durable import captured that finalized state, so the live read path can
-- derive `durableCurrent` from a real comparison rather than a guess.
-- Additive only: no existing column is dropped/retyped.

ALTER TABLE igc_league_events
    ADD COLUMN event_format TEXT NOT NULL DEFAULT 'unknown'
        CHECK (event_format IN ('individual', 'team', 'unknown')),
    ADD COLUMN discovery_state TEXT NOT NULL DEFAULT 'pending'
        CHECK (discovery_state IN ('pending', 'discovered', 'inconclusive', 'failed')),
    ADD COLUMN discovered_at TIMESTAMPTZ,
    ADD COLUMN source_finalized_at TIMESTAMPTZ,   -- when GG said this round was finalized
    ADD COLUMN source_version TEXT,              -- GG source version token, if exposed
    ADD COLUMN durable_source_version TEXT,      -- the source version our durable import captured
    ADD COLUMN durable_imported_at TIMESTAMPTZ;  -- when our import captured the finalized source

CREATE INDEX idx_league_events_format_state
    ON igc_league_events(league_key, event_format, discovery_state);

-- Backfill (conservative; never asserts 'team' from a null id). Rows with a
-- linked individual tournament are known individual events; everything else
-- stays 'unknown' for the reconciler to re-classify from current GG data.
UPDATE igc_league_events
   SET event_format = 'individual', discovery_state = 'discovered'
 WHERE gg_tournament_id IS NOT NULL;
```

- [ ] **Step 2: Apply locally and verify**

Run: `pnpm supabase` (start local Supabase; the run-supabase script applies pending migrations). Verify columns exist:

```bash
node -e "import('./lib/supabase/service.ts').then(async m => { const s = m.createServiceClient(); const { data, error } = await s.from('igc_league_events').select('event_format, discovery_state, source_finalized_at, source_version, durable_source_version, durable_imported_at').limit(1); console.log(error ?? data); })"
```
Expected: prints a row (or empty array) with no error — columns exist.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/026_igc_league_event_format.sql
git commit -m "feat(db): explicit event_format/discovery_state + durable-current columns"
```

---

### Task 3: Generic domain types

**Files:**
- Create: `lib/competition/types.ts`

Pure types — verified by `pnpm lint`. No unit test (types only). Revised: `CapabilityInput` carries `scoringModes: ScoringMode[]`; `LiveResponse` carries `durableCurrent` with a defined source; `ResultStatusInput` is named here so the result-status module (Task 10) and the live path share one shape.

- [ ] **Step 1: Write the types**

`lib/competition/types.ts`:

```ts
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
```

- [ ] **Step 2: Typecheck**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/competition/types.ts
git commit -m "feat(competition): generic competition/result domain types"
```

---

### Task 4: Event-format classification (pure, positive-evidence only) — TDD

**Files:**
- Create: `lib/competition/classify.ts`
- Create: `tests/competition-classify.test.ts`

Covers spec tests #3 (team with positive evidence), #4 (inconclusive → not team), #5 (upcoming → pending), #6 (ambiguous → not team). Resolves plan issues #2 and the side-game correction: names never independently produce `team`; **side games never make the round a team event** — they are ignored when determining the primary format. Precedence:

- If any qualifying individual competition exists → `individual` (side games ignored).
- `team` only when (explicit `metadataFormat='team'` OR an occurrence-level config override) **and** no qualifying individual competition exists.
- Side games alone → `unknown`/`inconclusive`, not `team`.

- [ ] **Step 1: Write the failing tests**

`tests/competition-classify.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyEventFormat,
  nameKind,
  type DiscoveredTournament,
} from '../lib/competition/classify.ts'

function mkT(over: Partial<DiscoveredTournament> = {}): DiscoveredTournament {
  return {
    id: over.id ?? 't1',
    name: over.name ?? 'Gross Regular Season',
    metadataFormat: over.metadataFormat ?? null,
    nameKind: over.nameKind ?? 'individual',
  }
}

test('individual when ≥1 qualifying individual competition (metadata or gross/net name)', () => {
  const r = classifyEventFormat({ tournaments: [mkT()], teamOverride: false })
  assert.equal(r.eventFormat, 'individual')
  assert.equal(r.discoveryState, 'discovered')
})

test('Gross + Net + Closest to the Pin → individual (side game ignored, not team)', () => {
  const r = classifyEventFormat({
    tournaments: [
      mkT({ id: 'g1', name: 'Gross Regular Season', nameKind: 'individual' }),
      mkT({ id: 'n1', name: 'Net Regular Season', nameKind: 'individual' }),
      mkT({ id: 'kp1', name: 'Closest to the Pin', metadataFormat: 'side', nameKind: 'side' }),
    ],
    teamOverride: false,
  })
  assert.equal(r.eventFormat, 'individual')
  assert.equal(r.discoveryState, 'discovered')
})

test('side game only → unknown/inconclusive, never team', () => {
  const r = classifyEventFormat({
    tournaments: [mkT({ id: 'kp1', name: 'Closest to the Pin', metadataFormat: 'side', nameKind: 'side' })],
    teamOverride: false,
  })
  assert.equal(r.eventFormat, 'unknown')
  assert.ok(r.discoveryState === 'pending' || r.discoveryState === 'inconclusive',
    'side-only must not be team')
})

test('explicit team tournament with no individual tournament → team', () => {
  const r = classifyEventFormat({
    tournaments: [mkT({ id: 't1', metadataFormat: 'team', nameKind: 'team', name: 'Net Team Scramble' })],
    teamOverride: false,
  })
  assert.equal(r.eventFormat, 'team')
  assert.equal(r.discoveryState, 'discovered')
})

test('explicit team tournament + individual tournament → individual (metadata team does not override individual)', () => {
  const r = classifyEventFormat({
    tournaments: [
      mkT({ id: 'g1', name: 'Gross Regular Season', nameKind: 'individual' }),
      mkT({ id: 't1', metadataFormat: 'team', nameKind: 'team', name: 'Team Scramble' }),
    ],
    teamOverride: false,
  })
  assert.equal(r.eventFormat, 'individual')
})

test('explicit team tournament + individual + occurrence-level override → team (override forces whole-occurrence team)', () => {
  const r = classifyEventFormat({
    tournaments: [
      mkT({ id: 'g1', name: 'Gross Regular Season', nameKind: 'individual' }),
      mkT({ id: 't1', metadataFormat: 'team', nameKind: 'team', name: 'Team Scramble' }),
    ],
    teamOverride: true,
  })
  assert.equal(r.eventFormat, 'team')
  assert.equal(r.discoveryState, 'discovered')
})

test('team via explicit config override with no tournaments', () => {
  const r = classifyEventFormat({ tournaments: [], teamOverride: true })
  assert.equal(r.eventFormat, 'team')
  assert.equal(r.discoveryState, 'discovered')
})

test('a name that looks team-like but has NO positive metadata stays unknown (not team)', () => {
  const r = classifyEventFormat({
    tournaments: [mkT({ id: 't1', metadataFormat: null, nameKind: 'team', name: 'Some Team Thing' })],
    teamOverride: false,
  })
  assert.equal(r.eventFormat, 'unknown')
  assert.ok(r.discoveryState === 'pending' || r.discoveryState === 'inconclusive',
    'name-only team hint must not produce team')
})

test('empty tournament set (upcoming) → unknown/pending', () => {
  const r = classifyEventFormat({ tournaments: [], teamOverride: false })
  assert.equal(r.eventFormat, 'unknown')
  assert.equal(r.discoveryState, 'pending')
})

test('nameKind: gross/net/individual → individual hint; team/scramble → team hint; side games → side', () => {
  assert.equal(nameKind('Gross Regular Season'), 'individual')
  assert.equal(nameKind('Net Individual Play'), 'individual')
  assert.equal(nameKind('Team Scramble'), 'team')
  assert.equal(nameKind('Closest to the Pin'), 'side')
  assert.equal(nameKind('Mystery Round'), 'unknown')
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/competition-classify.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`lib/competition/classify.ts`:

```ts
// Pure event-format classification. Maps discovered tournaments + an explicit
// occurrence-level config override to (EventFormat, DiscoveryState). Rules
// (spec §3 + side-game correction):
//   - An occurrence is `individual` if ANY qualifying individual competition
//     exists (metadataFormat='individual' OR a gross/net/individual name).
//   - Side games (metadataFormat='side' / nameKind='side') are IGNORED when
//     determining the primary format — a round may have Gross + Net + Closest
//     to the Pin and is still individual.
//   - `team` only when (explicit metadataFormat='team' OR an occurrence-level
//     config override) AND no qualifying individual competition exists. A
//     name that merely looks team-like is a HINT and yields unknown/
//     inconclusive — never team. The occurrence-level override is the only
//     way an individual-bearing round becomes team.
//   - Otherwise 'unknown': 'pending' (no tournaments) or 'inconclusive'
//     (tournaments exist but none qualify, e.g. side games only / ambiguous).
// Persisted tournament ids are NOT classified here — the caller must
// fetch/verify their metadata/results before classification (discovery.ts).

export type NameKind = 'individual' | 'team' | 'side' | 'unknown'

export interface DiscoveredTournament {
  id: string
  name: string
  metadataFormat: 'individual' | 'team' | 'side' | null  // explicit upstream metadata; null if absent
  nameKind: NameKind                                     // hint derived from name
}

export interface ClassifyInput {
  tournaments: DiscoveredTournament[]
  teamOverride: boolean               // occurrence-level override (known scramble week)
}

export interface ClassifyResult {
  eventFormat: 'individual' | 'team' | 'unknown'
  discoveryState: 'pending' | 'discovered' | 'inconclusive' | 'failed'
}

// Name → hint. Names are hints only; never the sole basis for 'team'.
export function nameKind(name: string): NameKind {
  const n = name.toLowerCase()
  if (/team|scramble/.test(n)) return 'team'
  if (/closest to the pin|longest drive|kp hole/.test(n)) return 'side'
  if (/gross|net|individual/.test(n)) return 'individual'
  return 'unknown'
}

// A "qualifying individual competition" — explicit individual metadata OR a
// gross/net/individual name (those ARE individual competitions by GG
// convention). Side games never qualify.
function isQualifyingIndividual(t: DiscoveredTournament): boolean {
  return t.metadataFormat === 'individual' || t.nameKind === 'individual'
}

export function classifyEventFormat(input: ClassifyInput): ClassifyResult {
  const { tournaments, teamOverride } = input

  // Occurrence-level override forces team (explicit positive evidence) — the
  // only way an individual-bearing round is classified team.
  if (teamOverride) return { eventFormat: 'team', discoveryState: 'discovered' }

  // Any qualifying individual competition → individual (side games ignored).
  if (tournaments.some(isQualifyingIndividual)) {
    return { eventFormat: 'individual', discoveryState: 'discovered' }
  }

  // No individual: explicit team metadata (NOT side) makes it team.
  const hasTeamMeta = tournaments.some((t) => t.metadataFormat === 'team')
  if (hasTeamMeta) return { eventFormat: 'team', discoveryState: 'discovered' }

  // No individual, no team metadata: side games alone / ambiguous / empty.
  if (tournaments.length === 0) return { eventFormat: 'unknown', discoveryState: 'pending' }
  return { eventFormat: 'unknown', discoveryState: 'inconclusive' }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/competition-classify.test.ts`
Expected: PASS (10 tests).
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/competition-classify.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/competition/classify.ts tests/competition-classify.test.ts
git commit -m "feat(competition): positive-evidence-only event-format classification"
```

---

### Task 5: Active-window model (pure) — TDD

Covers spec test #17 (multi-day occurrence stays live across its window). Shared code never uses `event_date === today`.

**Files:**
- Create: `lib/competition/active-window.ts`
- Create: `tests/competition-active-window.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/competition-active-window.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isOccurrenceActive } from '../lib/competition/active-window.ts'

test('active when now is within the window', () => {
  assert.equal(isOccurrenceActive({ start: '2026-07-28T16:00:00-07:00', end: '2026-07-28T22:00:00-07:00' }, '2026-07-28T18:00:00-07:00', false), true)
})

test('not active before the window', () => {
  assert.equal(isOccurrenceActive({ start: '2026-07-28T16:00:00-07:00', end: '2026-07-28T22:00:00-07:00' }, '2026-07-28T15:00:00-07:00', false), false)
})

test('open-ended window (end null) active from start onward', () => {
  assert.equal(isOccurrenceActive({ start: '2026-07-28T16:00:00-07:00', end: null }, '2026-07-29T10:00:00-07:00', false), true)
})

test('multi-day occurrence stays active across both days', () => {
  const w = { start: '2026-07-28T08:00:00-07:00', end: '2026-07-29T20:00:00-07:00' }
  assert.equal(isOccurrenceActive(w, '2026-07-28T20:00:00-07:00', false), true)
  assert.equal(isOccurrenceActive(w, '2026-07-29T09:00:00-07:00', false), true)
  assert.equal(isOccurrenceActive(w, '2026-07-30T09:00:00-07:00', false), false)
})

test('upstream in-progress scoring keeps active even past window end', () => {
  assert.equal(isOccurrenceActive({ start: '2026-07-28T16:00:00-07:00', end: '2026-07-28T20:00:00-07:00' }, '2026-07-28T21:00:00-07:00', true), true)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/competition-active-window.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`lib/competition/active-window.ts`:

```ts
// Pure active-window decision. Activity is NEVER calendar-date equality. An
// occurrence is active when *now* falls within its configured window OR
// upstream scoring is in progress (which can run past the nominal end, e.g.
// delayed scoring after play). All timestamps are ISO strings with offsets.
// See design spec §4 "Active-window model".

export interface ActiveWindow {
  start: string
  end: string | null
}

export function isOccurrenceActive(window: ActiveWindow, nowIso: string, upstreamInProgress: boolean): boolean {
  if (upstreamInProgress) return true
  const now = Date.parse(nowIso)
  const start = Date.parse(window.start)
  if (!Number.isFinite(now) || !Number.isFinite(start)) return false
  if (now < start) return false
  if (window.end === null) return true
  const end = Date.parse(window.end)
  if (!Number.isFinite(end)) return true
  return now <= end
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/competition-active-window.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/competition/active-window.ts tests/competition-active-window.test.ts
git commit -m "feat(competition): configured active-window liveness model"
```

---

### Task 6: Capabilities derivation (pure, config-driven grouping policy) — TDD

Covers spec tests #9 (women's hides tab bar + grouping control), #10/#13 (men's groupings none while live, multi once final), #12. Resolves plan issues #7a (scoringModes: ScoringMode[]) and #7b (grouping masking is config-driven, not a universal shared rule).

**Files:**
- Create: `lib/competition/capabilities.ts`
- Create: `tests/competition-capabilities.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/competition-capabilities.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveOccurrenceCapabilities, type CapabilityInput } from '../lib/competition/capabilities.ts'

const mensBase: CapabilityInput = {
  configViews: ['season', 'weekly'],
  scoringModes: ['gross', 'net'],
  supportsLiveResults: true,
  supportsEventNavigation: true,
  availableGroupings: { kind: 'none' },
  resultStatus: 'live',
  liveGroupingPolicy: 'hide-until-final',
}

test('men\'s live with hide-until-final: groupings none even if durable groupings present', () => {
  const c = deriveOccurrenceCapabilities({
    ...mensBase,
    resultStatus: 'live',
    availableGroupings: { kind: 'multi', groupings: [
      { key: 'A', label: 'Flight A' }, { key: 'B', label: 'Flight B' }, { key: 'C', label: 'Flight C' },
    ], defaultAll: true },
  })
  assert.equal(c.groupings.kind, 'none')
  assert.deepEqual(c.views, ['season', 'weekly'])
  assert.deepEqual(c.scoring.modes, ['gross', 'net'])
})

test('men\'s final with hide-until-final: groupings multi (All/A/B/C)', () => {
  const c = deriveOccurrenceCapabilities({
    ...mensBase,
    resultStatus: 'final',
    availableGroupings: { kind: 'multi', groupings: [
      { key: 'A', label: 'Flight A' }, { key: 'B', label: 'Flight B' }, { key: 'C', label: 'Flight C' },
    ], defaultAll: true },
  })
  assert.equal(c.groupings.kind, 'multi')
})

test('available-while-live policy: groupings shown even while live', () => {
  const c = deriveOccurrenceCapabilities({
    ...mensBase,
    resultStatus: 'live',
    liveGroupingPolicy: 'available-while-live',
    availableGroupings: { kind: 'multi', groupings: [{ key: 'A', label: 'Bracket A' }], defaultAll: true },
  })
  assert.equal(c.groupings.kind, 'multi')
})

test('women\'s: single view → views length 1 (UI hides tab bar); single grouping → no control', () => {
  const c = deriveOccurrenceCapabilities({
    configViews: ['weekly'],
    scoringModes: ['gross', 'net'],
    supportsLiveResults: true,
    supportsEventNavigation: true,
    availableGroupings: { kind: 'single', grouping: { key: 'overall', label: 'Overall' } },
    resultStatus: 'live',
    liveGroupingPolicy: 'hide-until-final',
  })
  assert.equal(c.views.length, 1)
  assert.equal(c.groupings.kind, 'single')
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/competition-capabilities.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`lib/competition/capabilities.ts`:

```ts
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
  // The mask targets FLIGHTS (the `multi` case) — men's flights are unknown
  // until final. A `single` grouping (women's Overall) is always known; masking
  // it to `none` loses information with no UI benefit (both `single` and `none`
  // render no grouping control per spec §6). So the mask only fires for `multi`.
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
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/competition-capabilities.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/competition/capabilities.ts tests/competition-capabilities.test.ts
git commit -m "feat(competition): config-driven capability derivation"
```

---

### Task 7: Scoring preference storage (pure) — TDD

Covers spec test #14 (per-competition isolation + validation). Revision 7.

**Files:**
- Create: `lib/competition/scoring-prefs.ts`
- Create: `tests/competition-scoring-prefs.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/competition-scoring-prefs.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scoringKey, resolveScoring, writeScoringPref } from '../lib/competition/scoring-prefs.ts'

function makeStore() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v) },
  }
}

test('key is competition-scoped, not global', () => {
  assert.equal(scoringKey('mens-league'), 'standings:mens-league:scoring')
  assert.equal(scoringKey('womens-league'), 'standings:womens-league:scoring')
})

test('URL value wins and is validated against available modes', () => {
  const store = makeStore(); store.setItem(scoringKey('mens-league'), 'net')
  const r = resolveScoring({ competitionKey: 'mens-league', urlValue: 'gross', available: ['gross', 'net'], defaultMode: 'net', store })
  assert.equal(r, 'gross')
})

test('falls back to stored pref when URL absent, validated against available', () => {
  const store = makeStore(); store.setItem(scoringKey('mens-league'), 'net')
  const r = resolveScoring({ competitionKey: 'mens-league', urlValue: null, available: ['gross', 'net'], defaultMode: 'gross', store })
  assert.equal(r, 'net')
})

test('stored pref from another competition does not leak', () => {
  const store = makeStore(); store.setItem(scoringKey('womens-league'), 'net')
  const r = resolveScoring({ competitionKey: 'mens-league', urlValue: null, available: ['gross', 'net'], defaultMode: 'gross', store })
  assert.equal(r, 'gross', 'womens-league pref must not select a mode for mens-league')
})

test('stale stored value not in available modes is ignored for default', () => {
  const store = makeStore(); store.setItem(scoringKey('mens-league'), 'stableford')
  const r = resolveScoring({ competitionKey: 'mens-league', urlValue: null, available: ['gross', 'net'], defaultMode: 'gross', store })
  assert.equal(r, 'gross')
})

test('writeScoringPref persists under the namespaced key', () => {
  const store = makeStore()
  writeScoringPref('mens-league', 'net', store)
  assert.equal(store.getItem(scoringKey('mens-league')), 'net')
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/competition-scoring-prefs.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`lib/competition/scoring-prefs.ts`:

```ts
// Per-competition scoring-mode preference. The localStorage key is
// competition-scoped (`standings:${competitionKey}:scoring`) and any stored
// value is validated against the occurrence's available modes before use.
// A preference from one competition never selects a mode in another. The
// storage interface mirrors localStorage so this is unit-testable with a Map.
// See design spec §8 (revision 7).

import type { ScoringMode } from './types.ts'

export interface ScoringStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function scoringKey(competitionKey: string): string {
  return `standings:${competitionKey}:scoring`
}

export interface ResolveScoringInput {
  competitionKey: string
  urlValue: ScoringMode | null
  available: ScoringMode[]
  defaultMode: ScoringMode
  store: ScoringStorage
}

export function resolveScoring(input: ResolveScoringInput): ScoringMode {
  const valid = (m: ScoringMode | null | undefined): m is ScoringMode =>
    !!m && input.available.includes(m)
  if (valid(input.urlValue)) return input.urlValue as ScoringMode
  const stored = input.store.getItem(scoringKey(input.competitionKey)) as ScoringMode | null
  if (valid(stored)) return stored as ScoringMode
  return input.defaultMode
}

export function writeScoringPref(competitionKey: string, mode: ScoringMode, store: ScoringStorage): void {
  store.setItem(scoringKey(competitionKey), String(mode))
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/competition-scoring-prefs.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/competition/scoring-prefs.ts tests/competition-scoring-prefs.test.ts
git commit -m "feat(competition): per-competition validated scoring preference"
```

---

### Task 8: Cache key composition (pure, tenant-scoped) — TDD

Resolves plan issue #8 (cache key includes tenant/organization scope) and underpins #3 (structured cache API — callers never compose raw keys).

**Files:**
- Create: `lib/competition/cache-keys.ts`
- Create: `tests/competition-cache-keys.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/competition-cache-keys.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resultsCacheKey, discoveryCacheKey } from '../lib/competition/cache-keys.ts'

test('results key includes tenant, competition, occurrence, scoring', () => {
  assert.equal(resultsCacheKey({ tenantKey: 'igc', competitionKey: 'mens-league', occurrenceId: 'wk18', scoring: 'gross' }), 'results:igc:mens-league:wk18:gross')
})

test('discovery key includes tenant + competition + occurrence, no scoring', () => {
  assert.equal(discoveryCacheKey({ tenantKey: 'igc', competitionKey: 'mens-league', occurrenceId: 'wk18' }), 'discovery:igc:mens-league:wk18')
})

test('keys differ by tenant (no cross-tenant read)', () => {
  assert.notEqual(
    resultsCacheKey({ tenantKey: 'igc', competitionKey: 'mens-league', occurrenceId: 'wk18', scoring: 'gross' }),
    resultsCacheKey({ tenantKey: 'other-org', competitionKey: 'mens-league', occurrenceId: 'wk18', scoring: 'gross' }),
  )
})

test('keys differ by competition (no cross-competition read)', () => {
  assert.notEqual(
    resultsCacheKey({ tenantKey: 'igc', competitionKey: 'mens-league', occurrenceId: 'wk18', scoring: 'gross' }),
    resultsCacheKey({ tenantKey: 'igc', competitionKey: 'womens-league', occurrenceId: 'wk18', scoring: 'gross' }),
  )
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/competition-cache-keys.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`lib/competition/cache-keys.ts`:

```ts
// Cache key composition. Every key is tenant- AND competition-scoped so no
// tenant or competition reads another's cache. Results rows include the
// scoring mode; discovery rows do not. Callers use the structured cache API
// in cache.ts (readCachedResult/writeCachedResult) and never compose these
// keys directly. See design spec §4 cache schema + revision 8.

import type { ScoringMode } from './types.ts'

export interface ResultsKeyInput {
  tenantKey: string
  competitionKey: string
  occurrenceId: string
  scoring: ScoringMode
}
export interface DiscoveryKeyInput {
  tenantKey: string
  competitionKey: string
  occurrenceId: string
}

export function resultsCacheKey(input: ResultsKeyInput): string {
  return `results:${input.tenantKey}:${input.competitionKey}:${input.occurrenceId}:${input.scoring}`
}

export function discoveryCacheKey(input: DiscoveryKeyInput): string {
  return `discovery:${input.tenantKey}:${input.competitionKey}:${input.occurrenceId}`
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/competition-cache-keys.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/competition/cache-keys.ts tests/competition-cache-keys.test.ts
git commit -m "feat(competition): tenant-scoped cache key composition"
```

---

### Task 9: Migration 027 — live cache table (RLS, no public SELECT)

Resolves plan issue #8 (security): RLS enabled with NO public SELECT policy; service-role-only reads/writes; tenant_key column.

**Files:**
- Create: `supabase/migrations/027_competition_live_cache.sql`

- [ ] **Step 1: Write the migration**

`supabase/migrations/027_competition_live_cache.sql`:

```sql
-- Short-TTL server cache for coalesced live-result + discovery reads. Written
-- and read ONLY by the service role from server routes; there is no
-- browser-side need for direct reads. RLS is ENABLED with NO public SELECT
-- policy, so anon/authenticated roles cannot read it. The cache key includes
-- tenant_key so competition keys need not be globally unique across tenants.
-- See design spec §4 (revision 8).

CREATE TABLE competition_live_cache (
    cache_key          TEXT PRIMARY KEY,
    tenant_key         TEXT NOT NULL,
    competition_key    TEXT NOT NULL,
    occurrence_id      TEXT NOT NULL,
    scope              TEXT NOT NULL CHECK (scope IN ('results', 'discovery')),
    scoring            TEXT,                            -- null for discovery rows
    payload            JSONB NOT NULL,
    result_status      TEXT,
    fetched_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at         TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_competition_live_cache_expires ON competition_live_cache(expires_at);
CREATE INDEX idx_competition_live_cache_comp_occ ON competition_live_cache(tenant_key, competition_key, occurrence_id);

ALTER TABLE competition_live_cache ENABLE ROW LEVEL SECURITY;
-- Intentionally NO public SELECT policy: only the service role (server routes)
-- reads/writes. No INSERT/UPDATE/DELETE policies either — all writes go
-- through the service client which bypasses RLS.
```

- [ ] **Step 2: Apply locally and verify**

Run: `pnpm supabase`, then verify the table exists and is RLS-protected:

```bash
node -e "import('./lib/supabase/service.ts').then(async m => { const s = m.createServiceClient(); const { error } = await s.from('competition_live_cache').select('cache_key').limit(1); console.log(error ? 'ERR '+error.message : 'ok'); })"
```
Expected: `ok` (service role bypasses RLS).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/027_competition_live_cache.sql
git commit -m "feat(db): competition_live_cache (RLS, service-role-only)"
```

---

### Task 10: Result-status derivation (pure) — TDD

Resolves plan issue #5: result status is derived from the upstream lifecycle + configured active window + results presence/completeness + durable finalization — never from `Scorecard.isLive`. Absence of a partial card is NOT finality.

**Files:**
- Create: `lib/competition/result-status.ts`
- Create: `tests/competition-result-status.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/competition-result-status.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveResultStatus, type ResultStatusInput } from '../lib/competition/result-status.ts'

function mk(over: Partial<ResultStatusInput>): ResultStatusInput {
  return {
    upstreamStatus: 'unknown',
    active: false,
    hasResults: false,
    anyPartial: false,
    durableFinalized: false,
    ...over,
  }
}

test('durable-finalized → final (authoritative, regardless of upstream)', () => {
  assert.equal(deriveResultStatus(mk({ durableFinalized: true, upstreamStatus: 'in_progress' })), 'final')
})

test('upstream completed → final only after upstream finalization', () => {
  assert.equal(deriveResultStatus(mk({ upstreamStatus: 'completed', hasResults: true })), 'final')
})

test('upstream in_progress → live even when all cards currently complete (do not infer final from completeness)', () => {
  assert.equal(deriveResultStatus(mk({ upstreamStatus: 'in_progress', active: true, hasResults: true, anyPartial: false })), 'live')
})

test('upstream unknown + active + partial cards → live', () => {
  assert.equal(deriveResultStatus(mk({ upstreamStatus: 'unknown', active: true, hasResults: true, anyPartial: true })), 'live')
})

test('upstream unknown + active + complete cards but no upstream signal → live (completeness alone is not final)', () => {
  assert.equal(deriveResultStatus(mk({ upstreamStatus: 'unknown', active: true, hasResults: true, anyPartial: false })), 'live')
})

test('upstream not_started → not_started', () => {
  assert.equal(deriveResultStatus(mk({ upstreamStatus: 'not_started' })), 'not_started')
})

test('upstream unknown + inactive + no results → unknown/inconclusive (never infer final)', () => {
  assert.equal(deriveResultStatus(mk({ upstreamStatus: 'unknown', active: false, hasResults: false })), 'unknown')
})

test('upstream unknown + inactive + hasResults but not durable → unknown (DB path must set durableFinalized)', () => {
  assert.equal(deriveResultStatus(mk({ upstreamStatus: 'unknown', active: false, hasResults: true })), 'unknown')
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/competition-result-status.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`lib/competition/result-status.ts`:

```ts
// Pure result-status derivation. Status is NEVER inferred from Scorecard.isLive
// (card completeness). It combines, in priority order:
//   1. durableFinalized — the durable reconciliation captured finalized results
//   2. upstream round/tournament status — 'completed' → final, 'in_progress' → live
//   3. configured active window + card evidence — but completeness alone never
//      yields 'final'; only 'live' (while active) or 'unknown'.
// The DB/historical path sets durableFinalized=true for persisted finalized
// results, so it doesn't need upstream status. The live path supplies upstream
// status from GG. See design spec §4 (revision: result-status model).

import type { ResultStatus } from './types.ts'

export type UpstreamStatus = 'completed' | 'in_progress' | 'not_started' | 'unknown'

export interface ResultStatusInput {
  upstreamStatus: UpstreamStatus
  active: boolean                 // from isOccurrenceActive
  hasResults: boolean             // at least one result/scorecard present
  anyPartial: boolean              // at least one in-progress scorecard
  durableFinalized: boolean        // durable import captured finalized source
}

export function deriveResultStatus(input: ResultStatusInput): ResultStatus {
  if (input.durableFinalized) return 'final'
  if (input.upstreamStatus === 'completed') return 'final'
  if (input.upstreamStatus === 'in_progress') return 'live'
  if (input.upstreamStatus === 'not_started') return 'not_started'
  // upstream unknown: use window + card evidence. Completeness is NEVER final.
  if (input.active && (input.anyPartial || input.hasResults)) return 'live'
  return 'unknown'
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/competition-result-status.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/competition/result-status.ts tests/competition-result-status.test.ts
git commit -m "feat(competition): result-status from upstream lifecycle (not card completeness)"
```

---

### Task 11: Durable-current contract (pure) — TDD

Resolves plan issue #12: `durableCurrent` is derived from a real comparison of source-finalized vs durable-imported state — never an arbitrary boolean.

**Files:**
- Create: `lib/competition/durable-current.ts`
- Create: `tests/competition-durable-current.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/competition-durable-current.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isDurableCurrent } from '../lib/competition/durable-current.ts'

// DurableCurrentSource = {
//   sourceFinalizedAt, sourceVersion, durableSourceVersion, durableImportedAt
// }

test('false when no durable import recorded', () => {
  assert.equal(isDurableCurrent({ sourceFinalizedAt: '2026-07-28T22:00:00Z', sourceVersion: null, durableSourceVersion: null, durableImportedAt: null }), false)
})

test('false when source not yet finalized (still live/pending)', () => {
  assert.equal(isDurableCurrent({ sourceFinalizedAt: null, sourceVersion: null, durableSourceVersion: null, durableImportedAt: '2026-07-28T20:00:00Z' }), false)
})

test('true when durable import captured the finalized source (imported at/after finalization, no versions)', () => {
  assert.equal(isDurableCurrent({ sourceFinalizedAt: '2026-07-28T22:00:00Z', sourceVersion: null, durableSourceVersion: null, durableImportedAt: '2026-07-28T22:05:00Z' }), true)
})

test('false when durable import predates source finalization (stale import, no versions)', () => {
  assert.equal(isDurableCurrent({ sourceFinalizedAt: '2026-07-28T22:00:00Z', sourceVersion: null, durableSourceVersion: null, durableImportedAt: '2026-07-28T20:00:00Z' }), false)
})

test('version equality wins: sourceVersion == durableSourceVersion → current even if timestamps skew', () => {
  assert.equal(isDurableCurrent({ sourceFinalizedAt: '2026-07-28T22:00:00Z', sourceVersion: 'v9', durableSourceVersion: 'v9', durableImportedAt: '2026-07-28T19:00:00Z' }), true)
})

test('version mismatch → NOT current, even with a recent import (the durable path captured a different finalized state)', () => {
  assert.equal(isDurableCurrent({ sourceFinalizedAt: '2026-07-28T22:00:00Z', sourceVersion: 'v10', durableSourceVersion: 'v9', durableImportedAt: '2026-07-29T00:00:00Z' }), false)
})

test('sourceVersion present but durableSourceVersion absent → fall back to timestamp comparison', () => {
  // no durable version recorded; timestamp says stale
  assert.equal(isDurableCurrent({ sourceFinalizedAt: '2026-07-28T22:00:00Z', sourceVersion: 'v9', durableSourceVersion: null, durableImportedAt: '2026-07-28T20:00:00Z' }), false)
  // no durable version recorded; timestamp says current
  assert.equal(isDurableCurrent({ sourceFinalizedAt: '2026-07-28T22:00:00Z', sourceVersion: 'v9', durableSourceVersion: null, durableImportedAt: '2026-07-28T22:05:00Z' }), true)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/competition-durable-current.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`lib/competition/durable-current.ts`:

```ts
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
```

> **Note for the implementer:** the reconciler MUST persist `durable_source_version` = the `source_version` it observed at import time (Migration 026 column), so the version-equality branch can fire. If GG exposes no version token for a given round, both version fields stay null and the timestamp fallback governs. Never set `durableSourceVersion` to a synthesized placeholder — leave it null and rely on timestamps.

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/competition-durable-current.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/competition/durable-current.ts tests/competition-durable-current.test.ts
git commit -m "feat(competition): durable-current contract (source vs import comparison)"
```

---

## Phase 2 — Adapter & Discovery

### Task 12: GG results normalization (pure, fixture-tested) — TDD

The pure parsing of a GG tournament results payload into the generic `Leaderboard`/`Scorecard`. Reuses the existing pure helpers from `lib/igc/weekly-results.ts` (`buildHoles`, `positionOrder`, `positionLabelOf`, `playerKey`).

**Files:**
- Create: `lib/competition/adapters/golfgenius/normalize.ts`
- Create: `tests/competition-normalize.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/competition-normalize.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeTournament, type GGResultsFixture } from '../lib/competition/adapters/golfgenius/normalize.ts'

function fixture(): GGResultsFixture {
  return {
    event: {
      scopes: [
        {
          name: 'Flight 1',
          aggregates: [
            {
              name: 'Hans Olson',
              position: '1',
              points: '50',
              purse: '$55.00',
              member_cards: [{ member_card_id_str: 'mc-1' }],
              net_scores: [4, 5, 4],
              gross_scores: [5, 6, 5],
              to_par_net: [-1, 0, -1],
              to_par_gross: [0, 0, 0],
              totals: { net_scores: { out: 13, total: 13 }, gross_scores: { out: 16, total: 16 } },
              scorecard_statuses: [{ status: 'completed' }],
            },
          ],
        },
      ],
    },
  }
}

test('normalizes one player into a generic ResultEntry + Scorecard', () => {
  const { entriesByFlight, scorecards } = normalizeTournament(fixture(), 'gross')
  assert.equal(entriesByFlight.size, 1)
  const flight = entriesByFlight.get('Flight 1')!
  assert.equal(flight.length, 1)
  assert.equal(flight[0].name, 'Hans Olson')
  assert.equal(flight[0].positionLabel, '1')
  assert.equal(flight[0].points, 50)
  assert.equal(scorecards.size, 1)
  const card = scorecards.get('mc-1')!
  assert.equal(card.holesCompleted, 3)
  assert.equal(card.grossTotal, 16)
})

test('empty scopes → empty result, no crash', () => {
  const { entriesByFlight, scorecards } = normalizeTournament({ event: { scopes: [] } }, 'net')
  assert.equal(entriesByFlight.size, 0)
  assert.equal(scorecards.size, 0)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/competition-normalize.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`lib/competition/adapters/golfgenius/normalize.ts`:

```ts
// Pure normalization of a GG tournament-results payload into generic domain
// types. No network, no Supabase. Reuses the pure parsing helpers already
// exported from lib/igc/weekly-results.ts (buildHoles, positionOrder,
// positionLabelOf, playerKey). Emits generic ResultEntry + Scorecard keyed
// by flight and by player key. Also reports upstream round/tournament status
// when GG exposes it, so the caller can derive ResultStatus.

import {
  buildHoles,
  positionOrder,
  positionLabelOf,
  playerKey,
} from '../../../igc/weekly-results.ts'
import type { ResultEntry, Scorecard, ScoringMode, ResultStatus } from '../../types.ts'

export interface GGAggregate {
  name?: string
  position?: string | number | null
  points?: string | number | null
  purse?: string | null
  member_cards?: { member_card_id_str?: string }[]
  net_scores?: (number | null)[]
  gross_scores?: (number | null)[]
  to_par_net?: (number | null)[]
  to_par_gross?: (number | null)[]
  totals?: {
    net_scores?: { out?: number | null; in?: number | null; total?: number | null }
    gross_scores?: { out?: number | null; in?: number | null; total?: number | null }
    to_par_net?: { out?: number | null; in?: number | null; total?: number | null }
    to_par_gross?: { out?: number | null; in?: number | null; total?: number | null }
  }
  scorecard_statuses?: { status?: string }[]
}
export interface GGScope { name?: string; aggregates?: GGAggregate[] }
export interface GGResultsFixture {
  event?: {
    scopes?: GGScope[]
    // Upstream lifecycle status when GG exposes it on the round/tournament:
    status?: string   // e.g. 'completed' | 'in_progress' | 'not_started'
  }
}

function parseNum(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : parseFloat(String(value))
  return Number.isFinite(n) ? n : null
}
function totalOut(totals: GGAggregate['totals'], key: 'net_scores' | 'gross_scores' | 'to_par_net' | 'to_par_gross'): number | null {
  return totals?.[key]?.out ?? totals?.[key]?.total ?? null
}

export function normalizeTournament(
  results: GGResultsFixture,
  competition: ScoringMode,
): {
  competition: ScoringMode
  entriesByFlight: Map<string, ResultEntry[]>
  scorecards: Map<string, Scorecard>
  upstreamStatus: 'completed' | 'in_progress' | 'not_started' | 'unknown'
} {
  const scopes = results?.event?.scopes ?? []
  const entriesByFlight = new Map<string, ResultEntry[]>()
  const scorecards = new Map<string, Scorecard>()

  for (const scope of scopes) {
    const flightName = scope.name?.trim() || 'Overall'
    for (const a of scope.aggregates ?? []) {
      if (!a.name) continue
      const memberCardId = a.member_cards?.[0]?.member_card_id_str ?? null
      const key = playerKey(memberCardId, a.name)
      const holes = buildHoles(a.gross_scores ?? null, a.net_scores ?? null, a.to_par_net ?? null, a.to_par_gross ?? null)
      const holesCompleted = holes.filter((h) => h.gross !== null || h.net !== null).length
      const totalHoles = holes.length || 18

      if (!scorecards.has(key)) {
        scorecards.set(key, {
          key,
          memberCardId,
          name: a.name,
          netTotal: totalOut(a.totals, 'net_scores'),
          grossTotal: totalOut(a.totals, 'gross_scores'),
          toParNet: totalOut(a.totals, 'to_par_net'),
          toParGross: totalOut(a.totals, 'to_par_gross'),
          holesCompleted,
          scorecardStatus: a.scorecard_statuses?.[0]?.status ?? null,
          isLive: holesCompleted > 0 && holesCompleted < totalHoles,
          holes,
        })
      }

      const entry: ResultEntry = {
        key,
        name: a.name,
        positionLabel: positionLabelOf(a.position),
        positionOrder: positionOrder(a.position),
        points: parseNum(a.points),
        purse: a.purse ?? null,
      }
      if (!entriesByFlight.has(flightName)) entriesByFlight.set(flightName, [])
      entriesByFlight.get(flightName)!.push(entry)
    }
  }

  const rawStatus = results?.event?.status?.toLowerCase() ?? ''
  let upstreamStatus: 'completed' | 'in_progress' | 'not_started' | 'unknown' = 'unknown'
  if (rawStatus === 'completed' || rawStatus === 'final') upstreamStatus = 'completed'
  else if (rawStatus === 'in_progress' || rawStatus === 'live') upstreamStatus = 'in_progress'
  else if (rawStatus === 'not_started' || rawStatus === 'upcoming') upstreamStatus = 'not_started'

  return { competition, entriesByFlight, scorecards, upstreamStatus }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/competition-normalize.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/competition/adapters/golfgenius/normalize.ts tests/competition-normalize.test.ts
git commit -m "feat(competition): pure GG results normalization to generic types"
```

---

### Task 13: GG discovery from config (server-side, no persisted-row dependency) — TDD

Resolves plan issue #1 (live discovery independent of persisted row) and #2 (positive-evidence classification; persisted ids never synthesized as individual). `discoverOccurrence` resolves the occurrence directly from the configured GG season/category + selected occurrence context; persisted ids are hints only, fetched/verified first with full discovery as fallback.

**Files:**
- Create: `lib/competition/adapters/golfgenius/discovery.ts`
- Create: `tests/competition-discovery.test.ts`

- [ ] **Step 1: Write the failing tests (inject a fake GG client)**

`tests/competition-discovery.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { discoverOccurrence, type DiscoverInput } from '../lib/competition/adapters/golfgenius/discovery.ts'

// Fake GG client records calls and serves canned responses by endpoint suffix.
// `throwOn` lets a test simulate a genuine upstream failure (network/auth/5xx)
// on a specific endpoint substring — the client THROWS, mimicking the real
// client's contract that genuine errors reject while 404/empty returns null.
function fakeGg(opts: {
  events?: any[]                  // GET /seasons/{sid}/events
  rounds?: any[]                   // GET /events/{eid}/rounds (full discovery)
  tournaments?: any[]              // GET /events/{eid}/rounds/{rid}/tournaments
  results?: Record<string, any>   // GET .../tournaments/{tid}.json
  throwOn?: string                // endpoint substring that should reject
  eventRounds?: any[]             // GET /events/{eid}/rounds when verifying a hinted event id
}) {
  const calls: string[] = []
  const fn = async (endpoint: string) => {
    calls.push(endpoint)
    if (opts.throwOn && endpoint.includes(opts.throwOn)) {
      throw new Error('upstream failure: ' + endpoint)
    }
    // Hint verification: GET /events/{eid}/rounds for a hinted event id.
    if (/\/events\/[^/]+\/rounds$/.test(endpoint) && opts.eventRounds !== undefined) return opts.eventRounds
    if (endpoint.endsWith('/tournaments') && !endpoint.includes('.json')) return opts.tournaments ?? []
    if (/\/events\/[^/]+\/rounds$/.test(endpoint)) return opts.rounds ?? []
    if (/\/seasons\/[^/]+\/events$/.test(endpoint)) return opts.events ?? []
    const tId = endpoint.split('/').slice(-1)[0].replace('.json', '')
    return opts.results?.[tId] ?? { event: { scopes: [] } }
  }
  return { fn, calls }
}

const baseInput = (over: Partial<DiscoverInput>): DiscoverInput => ({
  competitionKey: 'mens-league',
  tenantKey: 'igc',
  adapterConfig: {
    seasonId: 'S', categoryId: 'C', eventFilter: 'mens', tenantKey: 'igc',
    roundResolution: 'pointsRoundIndex',
  },
  occurrenceContext: { number: 18, date: null },
  persistedHints: null,
  teamOverride: false,
  ggClient: (async () => []) as any,
  scoringMode: 'gross',
  ...over,
})

test('no persisted row but discoverable: resolves event + round + tournaments from config and returns occurrence metadata', async () => {
  const gg = fakeGg({
    events: [{ id: 'E', name: 'Mens League', category_id: 'C' }],
    rounds: [{ id: 'R1', name: 'Round 18', is_points_round: true, position: 18, date: '2026-07-28' }],
    tournaments: [
      { event: { id: 'g1', name: 'Gross Regular Season' } },
      { event: { id: 'n1', name: 'Net Regular Season' } },
    ],
    results: {
      g1: { event: { status: 'in_progress', completed_at: null, version: 'v9', scopes: [{ name: 'Flight 1', aggregates: [{ name: 'Hans Olson', position: '1', gross_scores: [5,6], net_scores: [4,5], to_par_net: [-1,0], to_par_gross: [0,0], totals: { gross_scores: { out: 11 } } }] }] } },
    },
  })
  const r = await discoverOccurrence({ ...baseInput({ ggClient: gg.fn }), persistedHints: null })
  assert.equal(r.eventFormat, 'individual')
  assert.equal(r.discoveryState, 'discovered')
  // Occurrence metadata is carried on r.resolved (ResolvedOccurrence).
  assert.equal(r.resolved.ggEventId, 'E')
  assert.equal(r.resolved.ggRoundId, 'R1')
  assert.equal(r.resolved.grossTournamentId, 'g1')
  assert.equal(r.resolved.roundDate, '2026-07-28', 'round date carried from discovered GG round')
  assert.equal(r.resolved.eventName, 'Mens League')
  assert.equal(r.resolved.sourceVersion, 'v9')
  assert.ok(r.leaderboard, 'leaderboard produced from full discovery')
  assert.equal(r.resultStatus, 'live')
  assert.ok(gg.calls.some((c) => c.endsWith('/events')), 'resolved parent event from config')
})

test('row without gg_event_id but with config → full discovery (not a team verdict)', async () => {
  const gg = fakeGg({
    events: [{ id: 'E', name: 'Mens League', category_id: 'C' }],
    rounds: [{ id: 'R1', is_points_round: true, position: 18 }],
    tournaments: [],
  })
  const r = await discoverOccurrence({ ...baseInput({ ggClient: gg.fn }), persistedHints: { ggEventId: null, ggRoundId: null, grossTournamentId: null, netTournamentId: null } })
  assert.equal(r.eventFormat, 'unknown')
  assert.equal(r.discoveryState, 'pending')
  assert.equal(r.leaderboard, null)
})

test('stale persisted tournament ids fail to fetch → falls back to full discovery', async () => {
  // Persisted hint says gross=g1, but the GG fetch for g1 is empty. The
  // adapter must NOT synthesize individual from the persisted id; it falls
  // back to listing tournaments and re-discovers g2.
  const gg = fakeGg({
    events: [{ id: 'E', name: 'Mens League', category_id: 'C' }],
    rounds: [{ id: 'R1', is_points_round: true, position: 18 }],
    tournaments: [{ event: { id: 'g2', name: 'Gross Regular Season' } }],
    results: {
      g1: { event: { scopes: [] } },              // stale: empty
      g2: { event: { status: 'in_progress', scopes: [{ name: 'Flight 1', aggregates: [{ name: 'Hans Olson', position: '1', gross_scores: [5], net_scores: [4], to_par_net: [-1], to_par_gross: [0], totals: { gross_scores: { out: 5 } } }] }] } },
    },
  })
  const r = await discoverOccurrence({
    ...baseInput({ ggClient: gg.fn }),
    persistedHints: { ggEventId: 'E', ggRoundId: 'R1', grossTournamentId: 'g1', netTournamentId: null },
  })
  assert.equal(r.eventFormat, 'individual')
  assert.equal(r.resolved.grossTournamentId, 'g2', 'fell back to freshly discovered tournament id')
  assert.ok(r.leaderboard, 'results produced after fallback')
})

test('stale persisted gg_event_id hint (event no longer has rounds) → falls back to full config discovery', async () => {
  // Persisted gg_event_id 'ESTALE' returns no rounds when verified, so the
  // adapter falls back to listing events from config and finds 'E'.
  const gg = fakeGg({
    events: [{ id: 'E', name: 'Mens League', category_id: 'C' }],
    rounds: [{ id: 'R1', is_points_round: true, position: 18, date: '2026-07-28' }],
    eventRounds: [],   // verifying hinted event 'ESTALE' yields no rounds → stale
    tournaments: [{ event: { id: 'g1', name: 'Gross Regular Season' } }],
    results: { g1: { event: { status: 'in_progress', scopes: [{ name: 'Flight 1', aggregates: [{ name: 'Hans Olson', position: '1', gross_scores: [5], net_scores: [4], to_par_net: [-1], to_par_gross: [0], totals: { gross_scores: { out: 5 } } }] }] } } },
  })
  const r = await discoverOccurrence({
    ...baseInput({ ggClient: gg.fn }),
    persistedHints: { ggEventId: 'ESTALE', ggRoundId: 'R1', grossTournamentId: null, netTournamentId: null },
  })
  assert.equal(r.resolved.ggEventId, 'E', 'fell back to config-discovered event id, not the stale hint')
  assert.ok(gg.calls.some((c) => /\/seasons\/[^/]+\/events$/.test(c)), 'fell back to listing events from config')
})

test('team override produces team even with no tournaments', async () => {
  const gg = fakeGg({ events: [{ id: 'E', category_id: 'C' }], rounds: [{ id: 'R1', is_points_round: true, position: 18 }], tournaments: [] })
  const r = await discoverOccurrence({ ...baseInput({ ggClient: gg.fn, teamOverride: true }) })
  assert.equal(r.eventFormat, 'team')
  assert.equal(r.discoveryState, 'discovered')
  assert.equal(r.leaderboard, null)
})

test('genuine upstream failure THROWS (not swallowed) so stale-while-error can catch it', async () => {
  // The GG client rejects on the tournament-results fetch. discoverOccurrence
  // must propagate the rejection — NOT swallow it into pending/inconclusive.
  // The caller's stale-while-error handler relies on the thrown error to serve
  // last-known data with showingLastKnown=true.
  const gg = fakeGg({
    events: [{ id: 'E', name: 'Mens League', category_id: 'C' }],
    rounds: [{ id: 'R1', is_points_round: true, position: 18, date: '2026-07-28' }],
    tournaments: [{ event: { id: 'g1', name: 'Gross Regular Season' } }],
    throwOn: '/tournaments/',   // the results .json fetch will reject
  })
  await assert.rejects(
    () => discoverOccurrence({ ...baseInput({ ggClient: gg.fn }) }),
    /upstream failure/,
    'a thrown GG error must propagate, not be swallowed into pending/failed',
  )
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/competition-discovery.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`lib/competition/adapters/golfgenius/discovery.ts`:

```ts
// Server-side GG discovery. Resolves an occurrence's competitions and results
// DIRECTLY from Golf Genius using the adapter config + selected occurrence
// context, independent of any persisted row. Persisted ids are HINTS, verified
// against GG before use: a hinted event/round/tournament that returns empty
// (not-found-yet / stale) falls back to full config discovery; a hinted id
// whose fetch THROWS (network/auth/5xx) propagates the error so the caller's
// stale-while-error handler can serve last-known data. Persisted tournament
// ids are NEVER synthesized as 'individual' — classification comes from fetched
// metadata or a fresh tournament list. Team requires positive evidence
// (metadata or config override); side games never make the round team. The GG
// client is injected so this is unit-testable with fixtures.
//
// ERROR CONTRACT (Corrections 3 & 7): the GG client throws on genuine upstream
// failure (network, auth 401/403, 5xx). A 404 or "no data yet" is returned as
// null/[] — that is "not found yet", NOT a failure. This module does NOT wrap
// fetches in a swallowing try/catch; thrown errors propagate out of
// discoverOccurrence. Only "empty but resolved" results map to pending/
// inconclusive. This is what lets the caller's stale-while-error distinguish
// "GG is down" (serve last-known, showingLastKnown=true) from "round not posted
// yet" (show not_started).
//
// OCCURRENCE METADATA (Correction 3): discoverOccurrence returns a
// ResolvedOccurrence carrying every identifier + finalization datum the
// reconciler needs to import WITHOUT placeholders — ggEventId, ggRoundId, the
// gross/net tournament ids, the discovered round date, event name, upstream
// status, and the source finalization timestamp + version token. The caller
// passes `resolved` straight into importOccurrence (Task 19B).

import { classifyEventFormat, nameKind, type DiscoveredTournament } from '../../classify.ts'
import { normalizeTournament } from './normalize.ts'
import type { GolfGeniusAdapterConfig, Leaderboard, ScoringMode, EventFormat, DiscoveryState, ResultStatus, ResolvedOccurrence } from '../../types.ts'
import type { UpstreamStatus } from '../../result-status.ts'

export type GGClient = (endpoint: string) => Promise<any>

export interface OccurrenceContext {
  number: number | null      // occurrence number (league week)
  date: string | null        // ISO date for byDateWindow resolution
}

export interface PersistedHints {
  ggEventId: string | null
  ggRoundId: string | null
  grossTournamentId: string | null
  netTournamentId: string | null
}

export interface DiscoverInput {
  competitionKey: string
  tenantKey: string
  adapterConfig: GolfGeniusAdapterConfig
  occurrenceContext: OccurrenceContext
  persistedHints: PersistedHints | null
  teamOverride: boolean
  ggClient: GGClient
  scoringMode: ScoringMode
}

export interface DiscoverResult {
  eventFormat: EventFormat
  discoveryState: DiscoveryState
  resultStatus: ResultStatus
  leaderboard: Leaderboard | null
  resolved: ResolvedOccurrence
}

function emptyResolved(weekNumber: number | null): ResolvedOccurrence {
  return {
    weekNumber: weekNumber ?? 0,
    ggEventId: null, ggRoundId: null, grossTournamentId: null, netTournamentId: null,
    upstreamStatus: 'unknown', roundDate: null, eventName: null,
    sourceFinalizedAt: null, sourceVersion: null,
  }
}

// Coerce a GG rounds response to an array (list or {rounds:[...]}).
function asRounds(list: any): any[] {
  return Array.isArray(list) ? list : (list?.rounds ?? [])
}
// Coerce a GG list response to an array (list or {<key>:[...]}).
function asArr(list: any, key: string): any[] {
  return Array.isArray(list) ? list : (list?.[key] ?? [])
}

// Resolve the parent GG event from config (season + category). Returns the
// event {id, name} matching the adapter's eventFilter. Does NOT swallow errors.
async function resolveEventFromConfig(input: DiscoverInput): Promise<{ id: string; name: string | null } | null> {
  const list = await input.ggClient(`/seasons/${input.adapterConfig.seasonId}/events`)
  const events = asArr(list, 'events')
  const match = events.find((e: any) =>
    e?.id && (e.category_id === input.adapterConfig.categoryId || String(e.name ?? '').toLowerCase().includes(input.adapterConfig.eventFilter)),
  )
  return match?.id ? { id: match.id, name: match.name ?? null } : null
}

// Select a round from a rounds array by pointsRoundIndex or byDateWindow.
function selectRound(input: DiscoverInput, rounds: any[]): { id: string; date: string | null } | null {
  const pts = rounds.filter((r: any) => r?.is_points_round !== false)
  if (input.adapterConfig.roundResolution === 'byDateWindow' && input.occurrenceContext.date) {
    const d = input.occurrenceContext.date.slice(0, 10)
    const m = pts.find((r: any) => r?.date?.slice?.(0, 10) === d)
    if (m) return { id: m.id, date: m.date ?? null }
  }
  const idx = (input.occurrenceContext.number ?? 1) - 1
  const r = pts[idx] ?? pts[pts.length - 1]
  return r?.id ? { id: r.id, date: r.date ?? null } : null
}

// List tournaments and map to DiscoveredTournament (canonical flat {id,name}).
async function listTournaments(input: DiscoverInput, ggEventId: string, ggRoundId: string): Promise<DiscoveredTournament[]> {
  const list = await input.ggClient(`/events/${ggEventId}/rounds/${ggRoundId}/tournaments`)
  const arr = asArr(list, 'tournaments')
  return arr
    .map((t: any) => ({ id: t?.event?.id ?? t?.id, name: t?.event?.name ?? t?.name }))
    .filter((t: { id?: string; name?: string }) => t.id && t.name)
    .map((t: { id: string; name: string }) => ({
      id: t.id, name: t.name,
      metadataFormat: null as DiscoveredTournament['metadataFormat'],  // GG exposes no explicit format field here
      nameKind: nameKind(t.name),
    }))
}

function pickGrossNet(tournaments: DiscoveredTournament[]): { gross: string | null; net: string | null } {
  const individual = tournaments.filter((t) => t.nameKind === 'individual')
  const gross = individual.find((t) => /gross/i.test(t.name))?.id ?? null
  const net = individual.find((t) => /net/i.test(t.name))?.id ?? (individual.length === 1 ? individual[0].id : null)
  return { gross, net }
}

export async function discoverOccurrence(input: DiscoverInput): Promise<DiscoverResult> {
  const { teamOverride, scoringMode } = input
  const weekNumber = input.occurrenceContext.number ?? 0

  // 1. Resolve event + round. Verify hinted event/round ids against GG first;
  //    stale (empty) hints fall back to full config discovery. Thrown errors
  //    propagate (genuine upstream failure → caller's stale-while-error).
  let ggEventId: string | null = null
  let eventName: string | null = null
  let ggRoundId: string | null = null
  let roundDate: string | null = null
  let rounds: any[] = []

  const evHint = input.persistedHints?.ggEventId ?? null
  if (evHint) {
    // Verify the hinted event by fetching its rounds. Empty → stale, fall back.
    // A throw propagates (genuine upstream failure).
    const r = await input.ggClient(`/events/${evHint}/rounds`)
    rounds = asRounds(r)
    if (rounds.length) {
      ggEventId = evHint
      // eventName is unknown from a hint without an extra fetch; leave null —
      // the caller's persisted row carries the name (Task 15 mapper).
    }
  }
  if (!ggEventId) {
    const ev = await resolveEventFromConfig(input)
    if (!ev) {
      return { eventFormat: 'unknown', discoveryState: 'pending', resultStatus: 'unknown',
        leaderboard: null, resolved: emptyResolved(weekNumber) }
    }
    ggEventId = ev.id
    eventName = ev.name
    const r = await input.ggClient(`/events/${ggEventId}/rounds`)
    rounds = asRounds(r)
  }

  // 2. Resolve round. Prefer a verified hint present in the rounds list; else
  //    select by position/date. A hinted round not in the fetched list is stale.
  const rdHint = input.persistedHints?.ggRoundId ?? null
  if (rdHint && rounds.some((r: any) => r?.id === rdHint)) {
    const rd = rounds.find((r: any) => r?.id === rdHint)
    ggRoundId = rdHint
    roundDate = rd?.date ?? null
  } else {
    const sel = selectRound(input, rounds)
    if (!sel) {
      return { eventFormat: 'unknown', discoveryState: 'inconclusive', resultStatus: 'unknown',
        leaderboard: null,
        resolved: { ...emptyResolved(weekNumber), ggEventId, eventName } }
    }
    ggRoundId = sel.id
    roundDate = sel.date
  }

  // 3. Resolve tournaments. Try persisted tournament-id hints (fetch+verify);
  //    stale → full discovery. Never synthesize individual from a hint id.
  let grossId = input.persistedHints?.grossTournamentId ?? null
  let netId = input.persistedHints?.netTournamentId ?? null
  let discoveredTournaments: DiscoveredTournament[] = []
  let payloadForScoring: any = null

  if (grossId || netId) {
    const tryId = scoringMode === 'gross' ? grossId : netId
    const fetched = tryId ? await input.ggClient(`/events/${ggEventId}/rounds/${ggRoundId}/tournaments/${tryId}.json`) : null
    if (fetched && fetched?.event?.scopes?.length) {
      payloadForScoring = fetched
      discoveredTournaments = await listTournaments(input, ggEventId, ggRoundId)
      if (!discoveredTournaments.length) {
        // We have real results in hand for the hinted id — that IS positive
        // evidence an individual competition exists. Mark individual so
        // classification reflects the verified results, not the empty list.
        discoveredTournaments = [grossId, netId].filter(Boolean).map((id) => ({
          id: id as string, name: '', metadataFormat: 'individual' as const, nameKind: 'individual' as const,
        }))
      }
    } else {
      // Stale hints: fall back to full discovery. Do NOT classify from hint ids.
      grossId = null; netId = null
      discoveredTournaments = await listTournaments(input, ggEventId, ggRoundId)
      const gn = pickGrossNet(discoveredTournaments)
      grossId = gn.gross; netId = gn.net
    }
  } else {
    discoveredTournaments = await listTournaments(input, ggEventId, ggRoundId)
    const gn = pickGrossNet(discoveredTournaments)
    grossId = gn.gross; netId = gn.net
  }

  // 4. Classify (positive evidence only; side games ignored).
  const cls = classifyEventFormat({ tournaments: discoveredTournaments, teamOverride })
  if (cls.eventFormat !== 'individual') {
    return {
      eventFormat: cls.eventFormat, discoveryState: cls.discoveryState, resultStatus: 'not_started',
      leaderboard: null,
      resolved: { weekNumber, ggEventId, ggRoundId, grossTournamentId: grossId, netTournamentId: netId,
        upstreamStatus: 'unknown', roundDate, eventName, sourceFinalizedAt: null, sourceVersion: null },
    }
  }

  // 5. Fetch the scoring-mode competition's results (if not already fetched).
  const tournamentId = scoringMode === 'gross' ? grossId : netId
  if (!tournamentId) {
    return {
      eventFormat: 'individual', discoveryState: 'discovered', resultStatus: 'not_started',
      leaderboard: null,
      resolved: { weekNumber, ggEventId, ggRoundId, grossTournamentId: grossId, netTournamentId: netId,
        upstreamStatus: 'unknown', roundDate, eventName, sourceFinalizedAt: null, sourceVersion: null },
    }
  }
  let payload = payloadForScoring
  if (!payload) {
    payload = await input.ggClient(`/events/${ggEventId}/rounds/${ggRoundId}/tournaments/${tournamentId}.json`)
  }
  if (!payload || !payload?.event?.scopes?.length) {
    // No results posted yet (not-found-yet) → not_started, NOT a failure.
    return {
      eventFormat: 'individual', discoveryState: 'discovered', resultStatus: 'not_started',
      leaderboard: null,
      resolved: { weekNumber, ggEventId, ggRoundId, grossTournamentId: grossId, netTournamentId: netId,
        upstreamStatus: 'unknown', roundDate, eventName, sourceFinalizedAt: null, sourceVersion: null },
    }
  }

  const norm = normalizeTournament(payload, scoringMode)
  const upstreamStatus: UpstreamStatus = norm.upstreamStatus
  const sourceFinalizedAt = payload?.event?.completed_at ?? null
  const sourceVersion = payload?.event?.version ?? payload?.event?.updated_at ?? null
  const anyPlayers = [...norm.entriesByFlight.values()].some((es) => es.length > 0)
  if (!anyPlayers) {
    return {
      eventFormat: 'individual', discoveryState: 'discovered', resultStatus: 'not_started',
      leaderboard: null,
      resolved: { weekNumber, ggEventId, ggRoundId, grossTournamentId: grossId, netTournamentId: netId,
        upstreamStatus, roundDate, eventName, sourceFinalizedAt, sourceVersion },
    }
  }

  // Result status is finalized by the caller via deriveResultStatus (combining
  // upstreamStatus + active window + durable). Here we return the raw upstream
  // signal; default to 'live' as a safe interim until the caller decides.
  const resultStatus: ResultStatus = upstreamStatus === 'completed' ? 'final' : 'live'
  const entries = [...norm.entriesByFlight.values()].flat()
  const leaderboard: Leaderboard = {
    occurrenceId: '',                             // filled by caller
    scoringMode,
    grouping: null,
    entries,
    scorecards: [...norm.scorecards.values()],
    resultStatus,
    durableCurrent: false,
  }
  return {
    eventFormat: 'individual', discoveryState: 'discovered', resultStatus,
    leaderboard,
    resolved: { weekNumber, ggEventId, ggRoundId, grossTournamentId: grossId, netTournamentId: netId,
      upstreamStatus, roundDate, eventName, sourceFinalizedAt, sourceVersion },
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/competition-discovery.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/competition/adapters/golfgenius/discovery.ts tests/competition-discovery.test.ts
git commit -m "feat(competition): config-driven GG discovery (metadata + error propagation, no persisted-row dependency)"
```

---

### Task 14: League configs + registry

Resolves plan issues #6 (window construction config) and #8 (tenant key). Configs carry `liveGroupingPolicy`, `tenantKey`, window-construction params, and `teamFormatOverrides`.

**Files:**
- Create: `lib/competition/configs/mens-league.ts`
- Create: `lib/competition/configs/womens-league.ts`
- Create: `lib/competition/registry.ts`

- [ ] **Step 1: Write the configs**

`lib/competition/configs/mens-league.ts`:

```ts
import type { CompetitionConfig } from '../types.ts'

export const mensLeagueConfig: CompetitionConfig = {
  key: 'mens-league',
  label: "Men's League",
  adapter: 'golfgenius',
  adapterConfig: {
    seasonId: process.env.IGC_MENS_SEASON_ID || '',
    categoryId: process.env.IGC_MENS_CATEGORY_ID || '',
    seasonPointsCategoryId: process.env.IGC_MENS_POINTS_CATEGORY_ID || '',
    eventFilter: 'mens',
    tenantKey: 'igc',
    teamFormatOverrides: [],                       // populate with known scramble week numbers
    roundResolution: 'pointsRoundIndex',
  },
  navigation: { occurrenceNoun: 'week', queryParam: 'week', labelRule: { kind: 'composite', noun: 'Week', separator: ' – ' } },
  capabilities: {
    views: ['season', 'weekly'],
    scoring: { modes: ['gross', 'net'] },
    supportsLiveResults: true,
    supportsEventNavigation: true,
  },
  liveGroupingPolicy: 'hide-until-final',
  schedule: { timezone: 'America/Los_Angeles', playDay: 2, windowHours: 8, playStartLocal: '16:00' },
}
```

`lib/competition/configs/womens-league.ts`:

```ts
import type { CompetitionConfig } from '../types.ts'

export const womensLeagueConfig: CompetitionConfig = {
  key: 'womens-league',
  label: "Women's League",
  adapter: 'golfgenius',
  adapterConfig: {
    seasonId: process.env.IGC_WOMENS_SEASON_ID || '',
    categoryId: process.env.IGC_WOMENS_CATEGORY_ID || '',
    eventFilter: 'womens',
    tenantKey: 'igc',
    teamFormatOverrides: [],
    roundResolution: 'pointsRoundIndex',
  },
  navigation: { occurrenceNoun: 'week', queryParam: 'week', labelRule: { kind: 'composite', noun: 'Week', separator: ' – ' } },
  capabilities: {
    views: ['weekly'],
    scoring: { modes: ['gross', 'net'] },
    supportsLiveResults: true,
    supportsEventNavigation: true,
  },
  liveGroupingPolicy: 'hide-until-final',
  schedule: { timezone: 'America/Los_Angeles', playDay: 3, windowHours: 8, playStartLocal: '16:00' },
}
```

`lib/competition/registry.ts`:

```ts
import type { CompetitionConfig } from './types.ts'
import { mensLeagueConfig } from './configs/mens-league.ts'
import { womensLeagueConfig } from './configs/womens-league.ts'

const REGISTRY: Record<string, CompetitionConfig> = {
  'mens-league': mensLeagueConfig,
  'womens-league': womensLeagueConfig,
}

export function getCompetitionConfig(key: string): CompetitionConfig | null {
  return REGISTRY[key] ?? null
}

export function allCompetitionConfigs(): CompetitionConfig[] {
  return Object.values(REGISTRY)
}
```

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/competition/configs lib/competition/registry.ts
git commit -m "feat(competition): Men's/Women's league configs + registry"
```

---

### Task 15: DB row ↔ generic Occurrence mapping + configured active-window (server-only) — TDD

Resolves plan issue #6: occurrence-window construction moves into the adapter config / server-side resolver with valid ISO offsets and a real end from configured duration — no hardcoded `16:00` in shared code.

**Files:**
- Create: `lib/competition/adapters/golfgenius/mapping.ts`
- Create: `tests/competition-mapping.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/competition-mapping.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildLeagueActiveWindow, leagueOccurrenceLabel, mapLeagueEventToOccurrence } from '../lib/competition/adapters/golfgenius/mapping.ts'

test('buildLeagueActiveWindow: valid ISO with offset from date + config', () => {
  const w = buildLeagueActiveWindow({ date: '2026-07-28', tz: 'America/Los_Angeles', playStartLocal: '16:00', windowHours: 8 })
  assert.ok(w)
  // July 28 2026 in America/Los_Angeles is PDT (-07:00). Start must carry an offset.
  assert.equal(w!.start, '2026-07-28T16:00:00-07:00')
  assert.equal(w!.end, '2026-07-29T00:00:00-07:00')
})

test('buildLeagueActiveWindow: null date → null window', () => {
  assert.equal(buildLeagueActiveWindow({ date: null, tz: 'America/Los_Angeles', playStartLocal: '16:00', windowHours: 8 }), null)
})

test('buildLeagueActiveWindow: open-ended when windowHours absent', () => {
  const w = buildLeagueActiveWindow({ date: '2026-07-28', tz: 'America/Los_Angeles', playStartLocal: '16:00' })
  assert.equal(w!.end, null)
})

test('leagueOccurrenceLabel: composite with event name', () => {
  assert.equal(leagueOccurrenceLabel({ kind: 'composite', noun: 'Week', separator: ' – ' }, 18, 'Open Championship'), 'Week 18 – Open Championship')
})

test('leagueOccurrenceLabel: composite without event name falls back to prefix', () => {
  assert.equal(leagueOccurrenceLabel({ kind: 'composite', noun: 'Week', separator: ' – ' }, 18, null), 'Week 18')
})

test('mapLeagueEventToOccurrence: maps row to generic Occurrence', () => {
  const occ = mapLeagueEventToOccurrence({
    week_number: 18, event_name: 'Open', event_date: '2026-07-28',
    event_format: 'individual', discovery_state: 'discovered',
  }, 'Week 18 – Open', { start: '2026-07-28T16:00:00-07:00', end: '2026-07-29T00:00:00-07:00' }, 'final')
  assert.equal(occ.id, '18')
  assert.equal(occ.number, 18)
  assert.equal(occ.format, 'individual')
  assert.equal(occ.resultStatus, 'final')
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/competition-mapping.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`lib/competition/adapters/golfgenius/mapping.ts`:

```ts
// Map igc_league_* DB rows to generic Occurrence/Leaderboard. SERVER-ONLY.
// This is the only place igc_league_* column names appear in the new shared
// layer; everything downstream consumes generic types. The active window is
// BUILT here from config (date + playStartLocal + windowHours + tz) producing
// valid ISO timestamps with real offsets — no hardcoded evening start in
// shared code. See design spec §4/§6 (revision 6).

import type { Occurrence, ActiveWindow, EventFormat, DiscoveryState, ResultStatus } from '../../types.ts'

export interface LeagueEventRow {
  week_number: number
  event_name: string | null
  event_date: string | null
  event_format: EventFormat | null
  discovery_state: DiscoveryState | null
}

// Compute the IANA offset for a given date in a tz, e.g. -07:00 for PDT.
// Uses Intl.DateTimeFormat to avoid pulling a tz library.
function tzOffsetMinutes(tz: string, dateIso: string): number {
  const dt = new Date(dateIso + 'T12:00:00Z')
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' })
  const parts = fmt.formatToParts(dt)
  const off = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+0'
  // off like 'GMT-7' or 'GMT+5:30'
  const m = off.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/)
  if (!m) return 0
  const sign = m[1] === '-' ? -1 : 1
  const h = parseInt(m[2], 10)
  const min = m[3] ? parseInt(m[3], 10) : 0
  return sign * (h * 60 + min)
}
function formatOffset(minutes: number): string {
  const sign = minutes >= 0 ? '+' : '-'
  const abs = Math.abs(minutes)
  const h = String(Math.floor(abs / 60)).padStart(2, '0')
  const mm = String(abs % 60).padStart(2, '0')
  return `${sign}${h}:${mm}`
}

export interface WindowBuildInput {
  date: string | null
  tz: string
  playStartLocal?: string       // '16:00'
  windowHours?: number
}

export function buildLeagueActiveWindow(input: WindowBuildInput): ActiveWindow | null {
  if (!input.date) return null
  const d = input.date.slice(0, 10)
  const start = input.playStartLocal ?? '00:00'
  const offset = formatOffset(tzOffsetMinutes(input.tz, d))
  const startIso = `${d}T${start}:00${offset}`
  if (!input.windowHours) return { start: startIso, end: null }
  // Add windowHours to the wall-clock start, keeping the same offset (league
  // rounds are short enough that DST transitions mid-window are not a concern;
  // if they ever are, recompute the end offset separately).
  const [h, m] = start.split(':').map((s) => parseInt(s, 10))
  const startMin = h * 60 + m + input.windowHours * 60
  const endH = Math.floor(startMin / 60) % 24
  const endM = startMin % 60
  // Handle crossing midnight: add a day to the date if startMin >= 1440.
  const crossesMidnight = startMin >= 1440
  let endD = d
  if (crossesMidnight) {
    const dt = new Date(d + 'T00:00:00Z')
    dt.setUTCDate(dt.getUTCDate() + 1)
    endD = dt.toISOString().slice(0, 10)
  }
  const endIso = `${endD}T${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}:00${offset}`
  return { start: startIso, end: endIso }
}

export function mapLeagueEventToOccurrence(
  row: LeagueEventRow,
  label: string,
  activeWindow: ActiveWindow,
  resultStatus: ResultStatus,
): Occurrence {
  return {
    id: String(row.week_number),
    number: row.week_number,
    label,
    date: row.event_date ? row.event_date.slice(0, 10) : null,
    activeWindow,
    format: row.event_format ?? 'unknown',
    discoveryState: row.discovery_state ?? 'pending',
    resultStatus,
  }
}

export function leagueOccurrenceLabel(
  rule: { kind: 'composite'; noun: string; separator: string } | { kind: 'numberPrefix'; noun: string } | { kind: 'event_name' },
  number: number | null,
  eventName: string | null,
): string {
  if (rule.kind === 'event_name') return eventName ?? `${number ?? ''}`.trim()
  const prefix = `${rule.noun} ${number ?? ''}`.trim()
  if (rule.kind === 'numberPrefix') return prefix
  return eventName ? `${prefix}${rule.separator}${eventName}` : prefix
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/competition-mapping.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/competition/adapters/golfgenius/mapping.ts tests/competition-mapping.test.ts
git commit -m "feat(competition): igc_league_* mapping + configured active-window construction"
```

---

## Phase 3 — Live Read Path

### Task 16: Cache module (structured API + single-flight + stale-while-error) — TDD

Resolves plan issues #3 (consistent structured cache key API — callers never compose raw keys), #4 (stale-while-error: fresh / stale / fill), and #8 (tenant scope, service-role-only). The DB cache reads/writes via the service client; cross-instance coalescing is best-effort.

**Files:**
- Create: `lib/competition/cache.ts`
- Create: `tests/competition-cache-singleflight.test.ts`
- Create: `tests/competition-cache-stale.test.ts`

- [ ] **Step 1: Write the failing single-flight tests**

`tests/competition-cache-singleflight.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeSingleFlight } from '../lib/competition/cache.ts'

test('in-process single-flight: N concurrent calls share one upstream fetch', async () => {
  let calls = 0
  const sf = makeSingleFlight<string>()
  const work = async () => { calls++; await new Promise((r) => setTimeout(r, 20)); return 'result' }
  const results = await Promise.all([sf.run('k1', work), sf.run('k1', work), sf.run('k1', work)])
  assert.equal(calls, 1, 'only one upstream call for the same key')
  assert.deepEqual(results, ['result', 'result', 'result'])
})

test('different keys run independently', async () => {
  let calls = 0
  const sf = makeSingleFlight<string>()
  const work = async () => { calls++; await new Promise((r) => setTimeout(r, 10)); return 'r' }
  await Promise.all([sf.run('a', work), sf.run('b', work)])
  assert.equal(calls, 2)
})

test('key is freed after completion so a later call re-fetches', async () => {
  let calls = 0
  const sf = makeSingleFlight<string>()
  const work = async () => { calls++; return 'r' }
  await sf.run('k', work)
  await sf.run('k', work)
  assert.equal(calls, 2)
})
```

- [ ] **Step 2: Write the failing stale-while-error tests**

`tests/competition-cache-stale.test.ts` (uses an injected fake DB layer so the stale-read path is unit-testable without Supabase):

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeLiveCacheStore, type CacheRow } from '../lib/competition/cache.ts'

function row(key: string, payload: any, ageMs: number, status = 'live'): CacheRow {
  return { cache_key: key, payload, result_status: status, fetched_at: new Date(Date.now() - ageMs).toISOString(), expires_at: new Date(Date.now() + (ageMs < 60_000 ? 30_000 : -1000)).toISOString() }
}

test('readCachedResult returns fresh payload only when not expired', async () => {
  const store = makeLiveCacheStore(new Map([['results:igc:mens-league:wk18:gross', row('results:igc:mens-league:wk18:gross', { resultStatus: 'live' }, 10_000)]]))
  const r = await store.readCachedResult({ tenantKey: 'igc', competitionKey: 'mens-league', occurrenceId: 'wk18', scoring: 'gross' })
  assert.ok(r, 'fresh hit')
  assert.equal(r!.resultStatus, 'live')
})

test('readCachedResult returns null when expired (fresh miss)', async () => {
  const store = makeLiveCacheStore(new Map([['results:igc:mens-league:wk18:gross', row('results:igc:mens-league:wk18:gross', { resultStatus: 'live' }, 120_000)]]))
  const r = await store.readCachedResult({ tenantKey: 'igc', competitionKey: 'mens-league', occurrenceId: 'wk18', scoring: 'gross' })
  assert.equal(r, null)
})

test('readStaleResult returns most recent row regardless of expiry (stale-while-error)', async () => {
  const store = makeLiveCacheStore(new Map([['results:igc:mens-league:wk18:gross', row('results:igc:mens-league:wk18:gross', { resultStatus: 'live' }, 120_000)]]))
  const r = await store.readStaleResult({ tenantKey: 'igc', competitionKey: 'mens-league', occurrenceId: 'wk18', scoring: 'gross' })
  assert.ok(r, 'stale hit even when expired')
  assert.equal(r!.resultStatus, 'live')
})

test('readStaleResult returns null when no row exists', async () => {
  const store = makeLiveCacheStore(new Map())
  const r = await store.readStaleResult({ tenantKey: 'igc', competitionKey: 'mens-league', occurrenceId: 'wk18', scoring: 'gross' })
  assert.equal(r, null)
})
```

- [ ] **Step 3: Run to verify failure**

Run: `node --test tests/competition-cache-singleflight.test.ts tests/competition-cache-stale.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

`lib/competition/cache.ts`:

```ts
// Coalesced live-result cache. Two layers:
//   1. In-process single-flight (promise map) — GUARANTEED within one instance.
//      Prevents N concurrent in-process requests from each calling upstream.
//   2. DB-backed short-TTL cache (competition_live_cache) — prevents most
//      repeated upstream calls AFTER the first write, across requests. Two
//      cold instances missing simultaneously can both call upstream before
//      either writes — this is BEST-EFFORT cross-instance coalescing, not a
//      strict single-flight guarantee. If strict cross-instance single-flight
//      is ever required, add a Postgres advisory lock around the fill (future).
// Stale-while-error: on upstream failure the caller returns the most recent
// cached row (even if expired) with showingLastKnown=true, preserving the
// leaderboard. See design spec §4.
//
// Callers use the STRUCTURED API (readCachedResult/readStaleResult/
// writeCachedResult with {tenantKey,competitionKey,occurrenceId,scoring}) and
// never compose raw keys. The DB layer is injectable for unit tests via
// makeLiveCacheStore.

import { resultsCacheKey, discoveryCacheKey } from './cache-keys.ts'
import type { LiveResponse, ScoringMode } from './types.ts'

export function makeSingleFlight<T>() {
  const inFlight = new Map<string, Promise<T>>()
  return {
    async run(key: string, work: () => Promise<T>): Promise<T> {
      const existing = inFlight.get(key)
      if (existing) return existing
      const p = work().finally(() => inFlight.delete(key))
      inFlight.set(key, p)
      return p
    },
  }
}

const RESULTS_TTL_SECONDS = 60
const DISCOVERY_TTL_SECONDS = 120

export interface CacheKeyArgs {
  tenantKey: string
  competitionKey: string
  occurrenceId: string
}
export interface ResultCacheKeyArgs extends CacheKeyArgs { scoring: ScoringMode }

export interface CacheRow {
  cache_key: string
  payload: LiveResponse
  result_status: string | null
  fetched_at: string
  expires_at: string
}

// Injectable DB layer. The default uses the service client; tests inject an
// in-memory store. This keeps readCachedResult/readStaleResult unit-testable.
export interface LiveCacheStore {
  readCachedResult(args: ResultCacheKeyArgs): Promise<LiveResponse | null>
  readStaleResult(args: ResultCacheKeyArgs): Promise<LiveResponse | null>
  writeCachedResult(args: ResultCacheKeyArgs, payload: LiveResponse): Promise<void>
  readCachedDiscovery(args: CacheKeyArgs): Promise<unknown | null>
  writeCachedDiscovery(args: CacheKeyArgs, payload: unknown): Promise<void>
  cleanExpired(): Promise<void>
}

export function makeLiveCacheStore(rows: Map<string, CacheRow>): LiveCacheStore {
  const keyOf = (args: ResultCacheKeyArgs) => resultsCacheKey(args)
  return {
    async readCachedResult(args) {
      const k = keyOf(args)
      const r = rows.get(k)
      if (!r) return null
      if (Date.parse(r.expires_at) <= Date.now()) return null
      return r.payload
    },
    async readStaleResult(args) {
      // most recent row regardless of expiry
      const matching = [...rows.entries()].filter(([k]) => k === keyOf(args))
      if (!matching.length) return null
      matching.sort((a, b) => Date.parse(b[1].fetched_at) - Date.parse(a[1].fetched_at))
      return matching[0][1].payload
    },
    async writeCachedResult(args, payload) {
      rows.set(keyOf(args), {
        cache_key: keyOf(args), payload, result_status: payload.resultStatus,
        fetched_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + RESULTS_TTL_SECONDS * 1000).toISOString(),
      })
    },
    async readCachedDiscovery(args) {
      const k = discoveryCacheKey(args)
      return rows.has(k) ? rows.get(k)!.payload : null
    },
    async writeCachedDiscovery(args, payload) {
      rows.set(discoveryCacheKey(args), {
        cache_key: discoveryCacheKey(args), payload: payload as LiveResponse, result_status: null,
        fetched_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + DISCOVERY_TTL_SECONDS * 1000).toISOString(),
      })
    },
    async cleanExpired() {
      for (const [k, r] of rows) if (Date.parse(r.expires_at) <= Date.now() - 24 * 3600_000) rows.delete(k)
    },
  }
}

// Service-role DB-backed store. Created lazily so unit tests that import the
// module for makeSingleFlight/makeLiveCacheStore don't require Supabase.
let _dbStore: LiveCacheStore | null = null
async function dbStore(): Promise<LiveCacheStore> {
  if (_dbStore) return _dbStore
  const { createServiceClient } = await import('../supabase/service.ts')
  const supabase = createServiceClient()
  _dbStore = {
    async readCachedResult(args) {
      const { data } = await supabase.from('competition_live_cache')
        .select('payload, expires_at').eq('cache_key', resultsCacheKey(args))
        .gt('expires_at', new Date().toISOString()).maybeSingle()
      return (data?.payload as LiveResponse) ?? null
    },
    async readStaleResult(args) {
      const { data } = await supabase.from('competition_live_cache')
        .select('payload, fetched_at').eq('cache_key', resultsCacheKey(args))
        .order('fetched_at', { ascending: false }).limit(1).maybeSingle()
      return (data?.payload as LiveResponse) ?? null
    },
    async writeCachedResult(args, payload) {
      await supabase.from('competition_live_cache').upsert({
        cache_key: resultsCacheKey(args), tenant_key: args.tenantKey, competition_key: args.competitionKey,
        occurrence_id: args.occurrenceId, scope: 'results', scoring: args.scoring,
        payload: payload as unknown as Record<string, unknown>, result_status: payload.resultStatus,
        fetched_at: new Date().toISOString(), expires_at: new Date(Date.now() + RESULTS_TTL_SECONDS * 1000).toISOString(),
      })
    },
    async readCachedDiscovery(args) {
      const { data } = await supabase.from('competition_live_cache')
        .select('payload').eq('cache_key', discoveryCacheKey(args))
        .gt('expires_at', new Date().toISOString()).maybeSingle()
      return data?.payload ?? null
    },
    async writeCachedDiscovery(args, payload) {
      await supabase.from('competition_live_cache').upsert({
        cache_key: discoveryCacheKey(args), tenant_key: args.tenantKey, competition_key: args.competitionKey,
        occurrence_id: args.occurrenceId, scope: 'discovery', scoring: null,
        payload: payload as Record<string, unknown>, fetched_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + DISCOVERY_TTL_SECONDS * 1000).toISOString(),
      })
    },
    async cleanExpired() {
      await supabase.from('competition_live_cache').delete()
        .lt('expires_at', new Date(Date.now() - 24 * 3600_000).toISOString())
    },
  }
  return _dbStore
}

// Public entry points used by live.ts. Each takes structured args — callers
// never compose keys.
export async function readCachedResult(args: ResultCacheKeyArgs, store?: LiveCacheStore): Promise<LiveResponse | null> {
  return (store ?? await dbStore()).readCachedResult(args)
}
export async function readStaleResult(args: ResultCacheKeyArgs, store?: LiveCacheStore): Promise<LiveResponse | null> {
  return (store ?? await dbStore()).readStaleResult(args)
}
export async function writeCachedResult(args: ResultCacheKeyArgs, payload: LiveResponse, store?: LiveCacheStore): Promise<void> {
  await (store ?? await dbStore()).writeCachedResult(args, payload)
}
export async function cleanExpiredCache(store?: LiveCacheStore): Promise<void> {
  await (store ?? await dbStore()).cleanExpired()
}
```

- [ ] **Step 5: Run to verify pass**

Run: `node --test tests/competition-cache-singleflight.test.ts tests/competition-cache-stale.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/competition/cache.ts tests/competition-cache-singleflight.test.ts tests/competition-cache-stale.test.ts
git commit -m "feat(competition): structured cache API + single-flight + stale-while-error"
```

---

### Task 17: Shared `getLiveResults` (config-driven discovery + stale-while-error) — TDD

Resolves plan issues #1 (discovery from config when row missing/stale), #4 (stale-while-error on upstream failure), #5 (result status via `deriveResultStatus`), #12 (`durableCurrent` via `isDurableCurrent`). Auth is the route's responsibility. The GG client, DB event-row reader, and cache store are injected for deterministic tests.

**Files:**
- Create: `lib/competition/live.ts`
- Create: `tests/competition-live.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/competition-live.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getLiveResults } from '../lib/competition/live.ts'
import { makeLiveCacheStore } from '../lib/competition/cache.ts'

// Fake GG serving parent event + round + tournaments + results.
function fakeGg(opts: { tournaments: any[]; results: Record<string, any>; events?: any[]; rounds?: any[] }) {
  return async (endpoint: string) => {
    if (endpoint.endsWith('/events')) return opts.events ?? [{ id: 'E', name: 'Mens', category_id: 'C' }]
    if (endpoint.endsWith('/rounds')) return opts.rounds ?? [{ id: 'R1', is_points_round: true, position: 18 }]
    if (endpoint.endsWith('/tournaments') && !endpoint.includes('.json')) return opts.tournaments
    const tId = endpoint.split('/').slice(-1)[0].replace('.json', '')
    return opts.results[tId] ?? { event: { scopes: [] } }
  }
}

function fakeEventReader(ev: any | null) {
  return async (_competitionKey: string, occurrenceId: string) =>
    ev ? { ...ev, week_number: Number(occurrenceId) } : null
}

const adapterConfig = { seasonId: 'S', categoryId: 'C', eventFilter: 'mens', tenantKey: 'igc', roundResolution: 'pointsRoundIndex' as const }

test('live results appear WITHOUT a persisted row (discovery from config)', async () => {
  const gg = fakeGg({
    tournaments: [{ event: { id: 'g1', name: 'Gross Regular Season' } }, { event: { id: 'n1', name: 'Net Regular Season' } }],
    results: { g1: { event: { status: 'in_progress', scopes: [{ name: 'Flight 1', aggregates: [{ name: 'Hans Olson', position: '1', gross_scores: [5,6], net_scores: [4,5], to_par_net: [-1,0], to_par_gross: [0,0], totals: { gross_scores: { out: 11 } } }] }] } } },
  })
  const cache = makeLiveCacheStore(new Map())
  const r = await getLiveResults({
    competitionKey: 'mens-league', occurrenceId: '18', scoring: 'gross',
    nowIso: '2026-07-28T18:00:00-07:00',
    deps: { adapterConfig, ggClient: gg, readEvent: fakeEventReader(null), cacheStore: cache },
  })
  assert.equal(r.eventFormat, 'individual')
  assert.equal(r.resultStatus, 'live')
  assert.ok(r.leaderboard, 'leaderboard produced with no persisted row')
  assert.equal(r.leaderboard!.entries.length > 0, true)
  assert.equal(r.showingLastKnown, false)
})

test('no persisted row + discovered round dated today + unknown lifecycle + live partial cards + configured window → live', async () => {
  // Correction 3: with no event row, discovery returns a round dated TODAY.
  // The tournament payload has NO status (lifecycle unknown) but partial cards.
  // The discovered round date must drive the active window so the occurrence
  // shows live even though the persisted event_date was absent.
  const gg = fakeGg({
    events: [{ id: 'E', name: 'Mens League', category_id: 'C' }],
    rounds: [{ id: 'R1', is_points_round: true, position: 18, date: '2026-07-28' }],
    tournaments: [{ event: { id: 'g1', name: 'Gross Regular Season' } }],
    results: { g1: { event: { scopes: [{ name: 'Flight 1', aggregates: [{ name: 'Hans Olson', position: '1', gross_scores: [5], net_scores: [4], to_par_net: [-1], to_par_gross: [0], totals: { gross_scores: { out: 5 } } }] }] } } },
  })
  const cache = makeLiveCacheStore(new Map())
  const r = await getLiveResults({
    competitionKey: 'mens-league', occurrenceId: '18', scoring: 'gross',
    nowIso: '2026-07-28T18:00:00-07:00',
    deps: { adapterConfig, ggClient: gg, readEvent: fakeEventReader(null), cacheStore: cache },
  })
  assert.equal(r.resultStatus, 'live', 'discovered round date drives the window → live despite unknown lifecycle')
  assert.ok(r.leaderboard)
  assert.equal(r.showingLastKnown, false)
})

test('upstream failure → stale-while-error returns last known with showingLastKnown=true', async () => {
  // Correction 7: a thrown GG error must reach the stale-while-error catch
  // (NOT be swallowed into pending/inconclusive), so last-known data is served.
  // Seed a stale cache row from a prior successful fetch.
  const prior: any = {
    occurrence: { id: '18', number: 18, label: 'Week 18', date: null, activeWindow: { start: '', end: null }, format: 'individual', discoveryState: 'discovered', resultStatus: 'live' },
    leaderboard: { occurrenceId: '18', scoringMode: 'gross', grouping: null, entries: [{ key: 'k', name: 'Hans', positionLabel: '1', positionOrder: 1, points: 50, purse: null }], scorecards: [], resultStatus: 'live', durableCurrent: false },
    resultStatus: 'live', eventFormat: 'individual', discoveryState: 'discovered', durableCurrent: false, showingLastKnown: false,
  }
  const cache = makeLiveCacheStore(new Map([['results:igc:mens-league:wk18:gross', {
    cache_key: 'results:igc:mens-league:wk18:gross', payload: prior, result_status: 'live',
    fetched_at: new Date(Date.now() - 120_000).toISOString(), expires_at: new Date(Date.now() - 60_000).toISOString(),
  }]]))
  // GG throws on every call — the first discovery fetch rejects and propagates.
  const throwingGg = async () => { throw new Error('GG down') }
  const r = await getLiveResults({
    competitionKey: 'mens-league', occurrenceId: '18', scoring: 'gross',
    nowIso: '2026-07-28T18:00:00-07:00',
    deps: { adapterConfig, ggClient: throwingGg, readEvent: fakeEventReader(null), cacheStore: cache },
  })
  assert.equal(r.showingLastKnown, true)
  assert.ok(r.leaderboard, 'last known leaderboard preserved')
  assert.equal(r.leaderboard!.entries[0].name, 'Hans')
})

test('durableCurrent derived from event row source vs import (version equality)', async () => {
  const gg = fakeGg({ tournaments: [], results: {} })
  const cache = makeLiveCacheStore(new Map())
  const r = await getLiveResults({
    competitionKey: 'mens-league', occurrenceId: '18', scoring: 'gross',
    nowIso: '2026-07-28T18:00:00-07:00',
    deps: {
      adapterConfig,
      ggClient: async () => { throw new Error('down') },
      readEvent: fakeEventReader({ event_date: '2026-07-28', event_format: 'individual', discovery_state: 'discovered', source_finalized_at: '2026-07-28T22:00:00Z', source_version: 'v9', durable_source_version: 'v9', durable_imported_at: '2026-07-28T19:00:00Z' }),
      cacheStore: cache,
    },
  })
  assert.equal(r.durableCurrent, true, 'version equality (v9==v9) → current despite older import timestamp')
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/competition-live.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`lib/competition/live.ts`:

```ts
// Shared live read function used by BOTH /api/competition/live and the
// /api/igc/league/live compatibility handler. Resolves the occurrence directly
// from the configured GG season/category + selected occurrence context — it
// does NOT require a persisted event row. A persisted row (when present)
// supplies hints (gg_event_id, tournament ids) and the durable-current columns.
// Discovery, result-status derivation, durable-current derivation, and
// stale-while-error are all handled here. Auth is the route's responsibility.

import { discoverOccurrence, type GGClient } from './adapters/golfgenius/discovery.ts'
import { buildLeagueActiveWindow, leagueOccurrenceLabel, mapLeagueEventToOccurrence } from './adapters/golfgenius/mapping.ts'
import { deriveResultStatus, type UpstreamStatus } from './result-status.ts'
import { isDurableCurrent } from './durable-current.ts'
import { isOccurrenceActive } from './active-window.ts'
import { readCachedResult, readStaleResult, writeCachedResult, makeSingleFlight, type LiveCacheStore } from './cache.ts'
import { getCompetitionConfig } from './registry.ts'
import type { GolfGeniusAdapterConfig, LiveResponse, Occurrence, ScoringMode, DurableCurrentSource } from './types.ts'

const sf = makeSingleFlight<LiveResponse>()

export interface EventRow {
  week_number: number
  event_name: string | null
  event_date: string | null
  event_format: 'individual' | 'team' | 'unknown' | null
  discovery_state: 'pending' | 'discovered' | 'inconclusive' | 'failed' | null
  gg_event_id: string | null
  gg_round_id: string | null
  gg_gross_tournament_id: string | null
  gg_net_tournament_id: string | null
  source_finalized_at: string | null
  source_version: string | null
  durable_source_version: string | null
  durable_imported_at: string | null
}

export interface LiveDeps {
  adapterConfig: GolfGeniusAdapterConfig
  ggClient: GGClient
  readEvent: (competitionKey: string, occurrenceId: string) => Promise<EventRow | null>
  cacheStore?: LiveCacheStore
}

export interface GetLiveResultsInput {
  competitionKey: string
  occurrenceId: string
  scoring: ScoringMode
  nowIso: string
  deps?: Partial<LiveDeps>   // production path omits deps → uses real GG + DB
}

export async function getLiveResults(input: GetLiveResultsInput): Promise<LiveResponse> {
  const config = getCompetitionConfig(input.competitionKey)
  if (!config) throw new Error(`unknown competition ${input.competitionKey}`)
  const tenantKey = config.adapterConfig.tenantKey
  const cacheArgs = { tenantKey, competitionKey: input.competitionKey, occurrenceId: input.occurrenceId, scoring: input.scoring }

  // Resolve deps (injected in tests, real in prod).
  const adapterConfig = input.deps?.adapterConfig ?? config.adapterConfig
  const ggClient = input.deps?.ggClient ?? ((async (endpoint: string) => {
    const { makeGolfGeniusRequest } = await import('../gg/client.ts')
    return makeGolfGeniusRequest({ endpoint })
  }) as GGClient)
  const readEvent = input.deps?.readEvent ?? (async (competitionKey: string, occurrenceId: string) => {
    const { createClient } = await import('../supabase/server.ts')
    const supabase = await createClient()
    const leagueKey = competitionKey === 'mens-league' ? 'mens' : 'womens'
    const { data } = await supabase.from('igc_league_events')
      .select('week_number, event_name, event_date, event_format, discovery_state, gg_event_id, gg_round_id, gg_gross_tournament_id, gg_net_tournament_id, source_finalized_at, source_version, durable_source_version, durable_imported_at')
      .eq('league_key', leagueKey).eq('week_number', Number(occurrenceId)).maybeSingle()
    return (data as EventRow | null) ?? null
  })

  // 1. Fresh cache hit.
  const cacheStore = input.deps?.cacheStore
  const cached = cacheStore ? await readCachedResult(cacheArgs, cacheStore) : await readCachedResult(cacheArgs)
  if (cached) return { ...cached, showingLastKnown: false }

  // 2. Single-flight the fresh fetch+discover.
  const fresh = await sf.run(`${input.competitionKey}:${input.occurrenceId}:${input.scoring}`, () =>
    fetchFresh(input, config, adapterConfig, ggClient, readEvent, input.nowIso, cacheStore),
  )
  // 3. Write back (best-effort).
  if (fresh && !fresh.showingLastKnown) {
    try { await writeCachedResult(cacheArgs, fresh, cacheStore) } catch { /* best-effort */ }
  }
  return fresh
}

async function fetchFresh(
  input: GetLiveResultsInput,
  config: ReturnType<typeof getCompetitionConfig> extends infer C ? Exclude<C, null> : never,
  adapterConfig: GolfGeniusAdapterConfig,
  ggClient: GGClient,
  readEvent: (competitionKey: string, occurrenceId: string) => Promise<EventRow | null>,
  nowIso: string,
  cacheStore?: LiveCacheStore,
): Promise<LiveResponse> {
  const ev = await readEvent(input.competitionKey, input.occurrenceId)
  const occurrenceNumber = Number(input.occurrenceId)
  const occurrenceDate = ev?.event_date ?? null

  const teamOverride = (adapterConfig.teamFormatOverrides ?? []).includes(occurrenceNumber)
  const persistedHints = ev ? {
    ggEventId: ev.gg_event_id, ggRoundId: ev.gg_round_id,
    grossTournamentId: ev.gg_gross_tournament_id, netTournamentId: ev.gg_net_tournament_id,
  } : null

  // Durable-current contract from the persisted row (may be null when no row).
  const dcs: DurableCurrentSource = {
    sourceFinalizedAt: ev?.source_finalized_at ?? null,
    sourceVersion: ev?.source_version ?? null,
    durableSourceVersion: ev?.durable_source_version ?? null,
    durableImportedAt: ev?.durable_imported_at ?? null,
  }
  const durableCurrent = isDurableCurrent(dcs)

  try {
    const r = await discoverOccurrence({
      competitionKey: input.competitionKey,
      tenantKey: adapterConfig.tenantKey,
      adapterConfig,
      occurrenceContext: { number: Number.isFinite(occurrenceNumber) ? occurrenceNumber : null, date: occurrenceDate },
      persistedHints,
      teamOverride,
      ggClient,
      scoringMode: input.scoring,
    })

    // Correction 3: when the persisted row has no event_date, use the round
    // date GG discovery returned so the active window still covers play. The
    // discovered date is the authoritative temporal signal when no row exists.
    const effectiveDate = occurrenceDate ?? r.resolved.roundDate ?? null

    // Build the active window from config (no hardcoded start). Built AFTER
    // discovery so it can use the discovered round date.
    const window = buildLeagueActiveWindow({
      date: effectiveDate, tz: config.schedule?.timezone ?? 'America/Los_Angeles',
      playStartLocal: config.schedule?.playStartLocal, windowHours: config.schedule?.windowHours,
    }) ?? { start: effectiveDate ?? '', end: null }

    const active = isOccurrenceActive(window, nowIso, r.resolved.upstreamStatus === 'in_progress')
    const resultStatus = deriveResultStatus({
      upstreamStatus: r.resolved.upstreamStatus,
      active,
      hasResults: !!r.leaderboard && r.leaderboard.entries.length > 0,
      anyPartial: r.leaderboard?.scorecards.some((c) => c.isLive) ?? false,
      durableFinalized: durableCurrent,
    })

    const label = leagueOccurrenceLabel(config.navigation.labelRule, Number.isFinite(occurrenceNumber) ? occurrenceNumber : null, ev?.event_name ?? r.resolved.eventName ?? null)
    const occurrence: Occurrence = mapLeagueEventToOccurrence(
      { week_number: occurrenceNumber, event_name: ev?.event_name ?? r.resolved.eventName ?? null, event_date: effectiveDate, event_format: r.eventFormat, discovery_state: r.discoveryState },
      label, window, resultStatus,
    )
    const leaderboard = r.leaderboard ? { ...r.leaderboard, occurrenceId: input.occurrenceId, resultStatus, durableCurrent } : null

    return {
      occurrence, leaderboard, resultStatus, eventFormat: r.eventFormat, discoveryState: r.discoveryState,
      durableCurrent, showingLastKnown: false,
    }
  } catch (err) {
    // Stale-while-error (Correction 7): a THROWN GG error reaches here — it is
    // NOT swallowed into pending/inconclusive upstream. Return the most recent
    // cached row (even if expired) with showingLastKnown=true, preserving the
    // leaderboard. Log and fall through.
    console.error(`[getLiveResults] ${input.competitionKey}/${input.occurrenceId}:`, err)
    const stale = cacheStore ? await readStaleResult({ tenantKey: adapterConfig.tenantKey, competitionKey: input.competitionKey, occurrenceId: input.occurrenceId, scoring: input.scoring }, cacheStore)
      : await readStaleResult({ tenantKey: adapterConfig.tenantKey, competitionKey: input.competitionKey, occurrenceId: input.occurrenceId, scoring: input.scoring })
    if (stale) return { ...stale, showingLastKnown: true }
    // No stale row: honest unknown state (NOT a team verdict).
    const fallbackWindow = buildLeagueActiveWindow({
      date: occurrenceDate, tz: config.schedule?.timezone ?? 'America/Los_Angeles',
      playStartLocal: config.schedule?.playStartLocal, windowHours: config.schedule?.windowHours,
    }) ?? { start: occurrenceDate ?? '', end: null }
    const label = leagueOccurrenceLabel(config.navigation.labelRule, Number.isFinite(occurrenceNumber) ? occurrenceNumber : null, ev?.event_name ?? null)
    return {
      occurrence: mapLeagueEventToOccurrence(
        { week_number: occurrenceNumber, event_name: ev?.event_name ?? null, event_date: occurrenceDate, event_format: 'unknown', discovery_state: 'pending' },
        label, fallbackWindow, 'unknown',
      ),
      leaderboard: null, resultStatus: 'unknown', eventFormat: 'unknown', discoveryState: 'pending',
      durableCurrent, showingLastKnown: false,
    }
  }
}
```

> **Note for the implementer:** the `config` parameter type in `fetchFresh` is awkward in plain TS; simplify it to `config: NonNullable<ReturnType<typeof getCompetitionConfig>>` (or import `CompetitionConfig` from `./types.ts` and type it directly — preferred). The runtime behavior is unaffected; pick whichever type the linter accepts.

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/competition-live.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/competition/live.ts tests/competition-live.test.ts
git commit -m "feat(competition): config-driven live read path + discovered-date window + stale-while-error"
```

---

### Task 18: `/api/competition/live` route + compatibility handler (no redirect)

Covers spec test #18 (compat handler returns without redirect). Both routes call the same `getLiveResults`.

**Files:**
- Create: `app/api/competition/live/route.ts`
- Modify: `app/api/igc/league/live/route.ts`

- [ ] **Step 1: Implement the generic route**

`app/api/competition/live/route.ts`:

```ts
import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { getLiveResults } from '@/lib/competition/live'

export const dynamic = 'force-dynamic'

async function authenticatedUserId(): Promise<string | undefined> {
  const supabase = await createClient()
  const claims: any = await supabase.auth.getClaims()
  const id = claims.data?.claims?.sub as string | undefined
  if (id) return id
  const user: any = await supabase.auth.getUser()
  return user.data?.user?.id as string | undefined
}

export async function GET(request: Request) {
  const userId = await authenticatedUserId()
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const url = new URL(request.url)
  const competition = url.searchParams.get('competition')
  const occurrence = url.searchParams.get('occurrence')
  const scoring = (url.searchParams.get('scoring') as 'gross' | 'net') || 'net'
  if (!competition || !occurrence) {
    return NextResponse.json({ error: 'competition and occurrence required' }, { status: 400 })
  }
  try {
    const nowIso = new Date().toISOString()
    const results = await getLiveResults({ competitionKey: competition, occurrenceId: occurrence, scoring, nowIso })
    return NextResponse.json({ results })
  } catch (err) {
    console.error(`[api/competition/live] ${competition}/${occurrence}:`, err)
    return NextResponse.json({ error: 'Failed to fetch live results' }, { status: 502 })
  }
}
```

- [ ] **Step 2: Rewrite the compatibility handler**

`app/api/igc/league/live/route.ts` (replace entirely):

```ts
import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { getLiveResults } from '@/lib/competition/live'

// Compatibility handler for the legacy /api/igc/league/live endpoint. Parses
// legacy params (league=mens|womens, week=N), maps them to the generic request,
// and invokes the SAME getLiveResults function the generic route uses. Does
// NOT redirect. Returns the same normalized response shape. Removed in a later
// cleanup. See design spec §4.
export const dynamic = 'force-dynamic'

async function authenticatedUserId(): Promise<string | undefined> {
  const supabase = await createClient()
  const claims: any = await supabase.auth.getClaims()
  const id = claims.data?.claims?.sub as string | undefined
  if (id) return id
  const user: any = await supabase.auth.getUser()
  return user.data?.user?.id as string | undefined
}

export async function GET(request: Request) {
  const userId = await authenticatedUserId()
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const url = new URL(request.url)
  const league = url.searchParams.get('league')
  const weekParam = url.searchParams.get('week')
  if (league !== 'mens' && league !== 'womens') {
    return NextResponse.json({ error: 'Invalid league' }, { status: 400 })
  }
  const week = weekParam ? Number.parseInt(weekParam, 10) : NaN
  if (!Number.isFinite(week)) {
    return NextResponse.json({ error: 'Invalid week' }, { status: 400 })
  }

  const competitionKey = league === 'mens' ? 'mens-league' : 'womens-league'
  const scoring = (url.searchParams.get('scoring') as 'gross' | 'net') || 'net'
  try {
    const nowIso = new Date().toISOString()
    const results = await getLiveResults({ competitionKey, occurrenceId: String(week), scoring, nowIso })
    return NextResponse.json({ results })
  } catch (err) {
    console.error(`[api/igc/league/live] ${league} wk${week}:`, err)
    return NextResponse.json({ error: 'Failed to fetch live results' }, { status: 502 })
  }
}
```

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/competition/live/route.ts app/api/igc/league/live/route.ts
git commit -m "feat(competition): generic live route + compat handler (no redirect)"
```

---

## Phase 4 — Durable Reconciliation

Decomposes the monolithic `scripts/sync-igc-league.mjs` into reusable, idempotent application logic with dependency injection (GG client + DB ops) so each step is unit-testable. Season-points rebuild keeps the completed-round guard. One **shared absolute deadline** is created once and passed to every competition (plan issue #15). Candidate selection distinguishes active / played-awaiting-finalization / upstream-finalized / unknown / old (plan issue #14) and authorizes finalized import by **upstream status**, not recency.

### Task 19A: Extract existing sync helpers (gg-helpers.ts) with parity tests

Pure-ish helpers ported verbatim from the existing `scripts/sync-igc-league.mjs` so the scoring math stays identical and is unit-testable. No behavior change.

**Files:**
- Create: `lib/competition/reconcile/gg-helpers.ts`
- Create: `tests/competition-gg-helpers.test.ts`

- [ ] **Step 1: Write the parity tests**

`tests/competition-gg-helpers.test.ts` — port the exact assertions that reproduce the current script's behavior for the pure helpers:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsePosition, parseNum, countCompletedHoles, totalOut, pickIndividualTournaments } from '../lib/competition/reconcile/gg-helpers.ts'

test('parsePosition: "1" → 1, "T2" → 2, "--" → null', () => {
  assert.equal(parsePosition('1'), 1)
  assert.equal(parsePosition('T2'), 2)
  assert.equal(parsePosition('--'), null)
})

test('parseNum: numeric strings → numbers, blanks → null', () => {
  assert.equal(parseNum('50'), 50)
  assert.equal(parseNum(''), null)
  assert.equal(parseNum(null), null)
})

test('countCompletedHoles: counts non-null gross/net entries', () => {
  assert.equal(countCompletedHoles([5, 6, null, 4], [4, 5, null, 3]), 3)
})

test('totalOut: out falls back to total', () => {
  assert.equal(totalOut({ net_scores: { out: 13 } }, 'net_scores'), 13)
  assert.equal(totalOut({ net_scores: { total: 39 } }, 'net_scores'), 39)
  assert.equal(totalOut({}, 'net_scores'), null)
})

test('pickIndividualTournaments: separates gross/net by name, drops side/team games (canonical flat {id,name})', () => {
  // GG returns tournaments as {event:{id,name}}; pickIndividualTournaments
  // normalizes each to the canonical flat {id,name} shape used everywhere
  // (19A parity, discovery, import, existing-script port). Side/team games
  // are dropped — only qualifying individual competitions are returned.
  const ts = [
    { event: { id: 'g1', name: 'Gross Regular Season' } },
    { event: { id: 'n1', name: 'Net Regular Season' } },
    { event: { id: 's1', name: 'Closest to the Pin' } },
    { event: { id: 't1', name: 'Team Scramble' } },
  ]
  const r = pickIndividualTournaments(ts)
  assert.equal(r.gross?.id, 'g1')
  assert.equal(r.net?.id, 'n1')
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/competition-gg-helpers.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Port the helpers verbatim**

`lib/competition/reconcile/gg-helpers.ts` — copy `pickIndividualTournaments`, `isSideOrTeamCompetition`, `parsePosition`, `parseNum`, `countCompletedHoles`, `totalOut` verbatim from `scripts/sync-igc-league.mjs` (see lines ~75–125 of the current script). Export each. These are mechanical ports; keep the exact logic and names so parity holds.

`pickIndividualTournaments` returns the **canonical flat `{id, name}` tournament shape** — `{ gross: {id,name}|null, net: {id,name}|null }` — the same shape used in discovery (Task 13 `DiscoveredTournament.id/.name`), import (Task 19B), and the existing-script port. The existing script already produces this flat shape (`tournaments.map(t => t.event).filter(e => e && e.id && e.name)` then pick gross/net by name); port that logic unchanged. `isSideOrTeamCompetition(name)` matches `closest to the pin` / `kp hole` / `team` / `scramble` — side games and team events are excluded from the individual pick (consistent with the classify correction in Task 4: side games never make the round team, and they are not individual either).

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/competition-gg-helpers.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/competition/reconcile/gg-helpers.ts tests/competition-gg-helpers.test.ts
git commit -m "feat(competition): extract GG sync helpers (parity-preserving)"
```

---

### Task 19B: `importOccurrence` (idempotent, DI) — TDD

Imports finalized performances + results for one occurrence (both competitions). Idempotent: upserts keyed by natural keys. GG client + DB writer injected for deterministic tests.

**Files:**
- Create: `lib/competition/reconcile/import.ts`
- Create: `tests/competition-import.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/competition-import.test.ts` — assert idempotency (two imports produce identical writes) and that both gross+net competitions are written. The import takes a `resolved: ResolvedOccurrence` carrying the ids discovery already resolved — NO re-listing, NO placeholders:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { importOccurrence } from '../lib/competition/reconcile/import.ts'

function fakeGg(opts: { results: Record<string, any> }) {
  return async (endpoint: string) => {
    // Import fetches only the per-tournament results .json (ids come from
    // `resolved`, not from a tournament list).
    const tId = endpoint.split('/').slice(-1)[0].replace('.json', '')
    return opts.results[tId] ?? { event: { scopes: [] } }
  }
}

const adapterConfig = { seasonId: 'S', categoryId: 'C', eventFilter: 'mens', tenantKey: 'igc', roundResolution: 'pointsRoundIndex' as const }

// The ResolvedOccurrence discovery would have produced for week 18.
const resolved = {
  weekNumber: 18, ggEventId: 'E', ggRoundId: 'R1',
  grossTournamentId: 'g1', netTournamentId: 'n1',
  upstreamStatus: 'completed' as const, roundDate: '2026-07-28', eventName: 'Mens League',
  sourceFinalizedAt: '2026-07-28T22:00:00Z', sourceVersion: 'v9',
}

test('importOccurrence writes both gross+net results and is idempotent on re-run', async () => {
  const results = {
    g1: { event: { scopes: [{ name: 'Flight 1', aggregates: [{ name: 'Hans Olson', position: '1', points: '50', member_cards: [{ member_card_id_str: 'mc-1' }], gross_scores: [5,6,5], net_scores: [4,5,4], to_par_net: [-1,0,-1], to_par_gross: [0,0,0], totals: { gross_scores: { out: 16 } } }] }] } },
    n1: { event: { scopes: [{ name: 'Flight 1', aggregates: [{ name: 'Hans Olson', position: '1', points: '50', member_cards: [{ member_card_id_str: 'mc-1' }], gross_scores: [5,6,5], net_scores: [4,5,4], to_par_net: [-1,0,-1], to_par_gross: [0,0,0], totals: { net_scores: { out: 13 } } }] }] } },
  }
  const writes: any[] = []
  const db = {
    upsertPerformances: async (rows: any[]) => { writes.push({ kind: 'perf', rows }); return { ok: true } },
    upsertResults: async (rows: any[]) => { writes.push({ kind: 'res', rows }); return { ok: true } },
    upsertEvent: async (row: any) => { writes.push({ kind: 'event', row }); return { ok: true } },
    setDurableImported: async (week: number, atIso: string, sourceVersion: string | null) => { writes.push({ kind: 'durable', week, atIso, sourceVersion }); return { ok: true } },
  }
  const gg = fakeGg({ results })
  const a1 = await importOccurrence({ competitionKey: 'mens-league', resolved, adapterConfig, ggClient: gg, db, nowIso: '2026-07-28T22:05:00Z' })
  const w1 = writes.length
  const a2 = await importOccurrence({ competitionKey: 'mens-league', resolved, adapterConfig, ggClient: gg, db, nowIso: '2026-07-28T22:06:00Z' })
  // Idempotent: same number of write operations on re-run (upserts overwrite).
  assert.equal(a2.performances, a1.performances)
  assert.equal(a2.results, a1.results)
  assert.equal(writes.length - w1, 4, 're-run wrote the same 4 buckets (event, perf, res, durable)')
  // Both competitions present in the results upsert.
  const resRows = writes.filter((w) => w.kind === 'res').flatMap((w) => w.rows)
  const competitions = new Set(resRows.map((r: any) => r.competition))
  assert.ok(competitions.has('gross') && competitions.has('net'), 'both gross+net written')
  // The event upsert carries the resolved ids + source version — no placeholders.
  const ev = writes.find((w) => w.kind === 'event')!.row
  assert.equal(ev.gg_event_id, 'E')
  assert.equal(ev.gg_round_id, 'R1')
  assert.equal(ev.gg_gross_tournament_id, 'g1')
  assert.equal(ev.gg_net_tournament_id, 'n1')
  assert.equal(ev.source_version, 'v9')
  assert.equal(ev.source_finalized_at, '2026-07-28T22:00:00Z')
  // The durable write records the source version it captured.
  const durable = writes.find((w) => w.kind === 'durable')!
  assert.equal(durable.sourceVersion, 'v9')
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/competition-import.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`lib/competition/reconcile/import.ts` — port the per-round upsert loop from `scripts/sync-igc-league.mjs` (lines ~191–397), factored to accept injected `ggClient` and `db`. Per Corrections 4 & 6, the import takes a `resolved: ResolvedOccurrence` (the ids discovery already resolved) — it does NOT re-list tournaments and does NOT accept placeholder id strings:

```ts
// Idempotent import of one occurrence's finalized performances + results
// (BOTH competitions). Upserts are keyed by natural keys so re-runs overwrite
// cleanly. GG client + DB writer are injected for deterministic tests.
// Mirrors the existing sync's write shape; do not change the scoring math
// (helpers come from gg-helpers.ts).
//
// CORRECTION 4 & 6: the occurrence's GG ids (event, round, gross/net
// tournament) arrive in `resolved: ResolvedOccurrence` — the typed result of
// discovery. Import fetches each competition's results .json by the resolved
// tournament id; it does NOT re-list tournaments and does NOT accept
// placeholder id strings ('' / null synthesized as if real). On success it
// sets durable_imported_at AND durable_source_version (the source version it
// captured) so the durable-current version-equality contract (Task 11) can fire.

import { parsePosition } from './gg-helpers.ts'
import { normalizeTournament } from '../adapters/golfgenius/normalize.ts'
import type { GolfGeniusAdapterConfig, ResolvedOccurrence } from '../types.ts'
import type { GGClient } from '../adapters/golfgenius/discovery.ts'

export interface ImportDb {
  upsertEvent(row: Record<string, unknown>): Promise<{ ok: boolean }>
  upsertPerformances(rows: Record<string, unknown>[]): Promise<{ ok: boolean }>
  upsertResults(rows: Record<string, unknown>[]): Promise<{ ok: boolean }>
  setDurableImported(week: number, atIso: string, sourceVersion: string | null): Promise<{ ok: boolean }>
}

export interface ImportInput {
  competitionKey: string
  resolved: ResolvedOccurrence
  adapterConfig: GolfGeniusAdapterConfig
  ggClient: GGClient
  db: ImportDb
  nowIso: string
}

export interface ImportSummary { performances: number; results: number; durable: boolean }

export async function importOccurrence(input: ImportInput): Promise<ImportSummary> {
  const leagueKey = input.competitionKey === 'mens-league' ? 'mens' : 'womens'
  const { ggEventId, ggRoundId, grossTournamentId, netTournamentId, weekNumber, sourceFinalizedAt, sourceVersion } = input.resolved

  const perfRows: Record<string, unknown>[] = []
  const resultRows: Record<string, unknown>[] = []

  for (const competition of ['gross', 'net'] as const) {
    const tId = competition === 'gross' ? grossTournamentId : netTournamentId
    if (!tId) continue
    const payload = await input.ggClient(`/events/${ggEventId}/rounds/${ggRoundId}/tournaments/${tId}.json`)
    const norm = normalizeTournament(payload, competition)
    for (const [flightName, entries] of norm.entriesByFlight) {
      for (const e of entries) {
        const card = norm.scorecards.get(e.key)
        resultRows.push({
          league_key: leagueKey, week_number: weekNumber,
          member_card_id: card?.memberCardId ?? e.key,
          player_name: e.name, competition,
          flight_name: flightName, position_label: e.positionLabel,
          flight_position: parsePosition(e.positionLabel), points: e.points, purse: e.purse,
        })
        if (card && !perfRows.find((r) => r.member_card_id === card.memberCardId)) {
          perfRows.push({
            league_key: leagueKey, week_number: weekNumber,
            member_card_id: card.memberCardId, player_name: card.name,
            flight_name: flightName, position_label: card.scorecardStatus,
            holes_completed: card.holesCompleted,
            gross_scores: card.holes.map((h) => h.gross),
            net_scores: card.holes.map((h) => h.net),
            to_par_net: card.holes.map((h) => h.toPar),
            to_par_gross: card.holes.map((h) => h.toPar),
            net_total: card.netTotal, gross_total: card.grossTotal,
            to_par_net_total: card.toParNet, to_par_gross_total: card.toParGross,
          })
        }
      }
    }
  }

  // Persist the resolved ids + source finalization/version on the event row —
  // no placeholders (the ids came from discovery). status reflects that this
  // occurrence has been durably imported.
  await input.db.upsertEvent({
    league_key: leagueKey, week_number: weekNumber,
    gg_event_id: ggEventId, gg_round_id: ggRoundId,
    gg_gross_tournament_id: grossTournamentId, gg_net_tournament_id: netTournamentId,
    event_format: 'individual', discovery_state: 'discovered',
    source_finalized_at: sourceFinalizedAt, source_version: sourceVersion,
    status: 'finalized',
  })
  if (perfRows.length) await input.db.upsertPerformances(perfRows)
  if (resultRows.length) await input.db.upsertResults(resultRows)
  // Record both the import time AND the source version captured, so the
  // durable-current version-equality branch (Task 11) can compare
  // source_version vs durable_source_version.
  await input.db.setDurableImported(weekNumber, input.nowIso, sourceVersion)
  return { performances: perfRows.length, results: resultRows.length, durable: true }
}
```

> **Note for the implementer:** the production `ImportDb` wraps `createServiceClient()` with the same upsert natural keys the existing script uses (`igc_league_performances` unique on `(league_key, week_number, member_card_id)`; `igc_league_results` unique on `(league_key, week_number, member_card_id, competition)`). Wire `setDurableImported` to `UPDATE igc_league_events SET durable_imported_at = $1, durable_source_version = $2 WHERE league_key = $3 AND week_number = $4`. Wire `upsertEvent` to UPDATE the event row's `gg_*` ids, `event_format`, `discovery_state`, `source_finalized_at`, `source_version`, and `status`. Keep the helper signatures consistent with Task 19A.

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/competition-import.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add lib/competition/reconcile/import.ts tests/competition-import.test.ts
git commit -m "feat(competition): idempotent occurrence import (DI, both competitions)"
```

---

### Task 19C: `rebuildSeasonPoints` (completed-round guard) — TDD

Ports the snapshot build (existing script lines ~429–500) keeping the completed-round guard and `seasonCum`/`cumBeforeLast` accumulation. Resolves plan issue #14's season-points cadence: points only advance when the upstream round is `completed` with authoritative `season_points`; reconciliation re-checks after finalization. A delayed-finalization test proves the guard.

**Files:**
- Create: `lib/competition/reconcile/season-points.ts`
- Create: `tests/competition-season-points.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/competition-season-points.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rebuildSeasonPoints, rankByTotalPoints } from '../lib/competition/reconcile/season-points.ts'

// One completed round's authoritative event.season_points entries (gross + net
// share one season_point_category, so both competitions' entries are summed).
type SP = { member_card_id: string; total_points: number; player_name?: string | null }

function fakeDeps(opts: {
  rounds: SP[][]
  eventsPlayed?: Map<string, number>
  wins?: Map<string, number>
  names?: Map<string, string | null>
}) {
  const state: { replaced: any[] | null; deleted: boolean } = { replaced: null, deleted: false }
  return {
    state,
    async listCompletedRoundsWithPoints() { return opts.rounds },
    async readEventsPlayed() { return opts.eventsPlayed ?? new Map<string, number>() },
    async readWins() { return opts.wins ?? new Map<string, number>() },
    async readNames() { return opts.names ?? new Map<string, string | null>() },
    async replaceSnapshot(rows: any[]) { state.replaced = rows; return rows },
    async deleteSnapshot() { state.deleted = true; return null },
  }
}

test('rankByTotalPoints: tied totals share the lower rank, next jumps (1224)', () => {
  // totals: a=50, b=40, c=40, d=30 → ranks 1,2,2,4
  const r = rankByTotalPoints(new Map([['a', 50], ['b', 40], ['c', 40], ['d', 30]]))
  assert.equal(r.get('a'), 1)
  assert.equal(r.get('b'), 2)
  assert.equal(r.get('c'), 2, 'tied with b shares lower rank 2')
  assert.equal(r.get('d'), 4, 'next jumps to 4')
})

test('guard: only completed rounds with authoritative season_points are summed', async () => {
  // The deps supply ONLY completed rounds' season_points (a not-yet-completed
  // round is excluded upstream — the guard is in listCompletedRoundsWithPoints).
  const deps = fakeDeps({
    rounds: [[ { member_card_id: 'mc-1', total_points: 40 } ]],
    eventsPlayed: new Map([['mc-1', 1]]), wins: new Map([['mc-1', 0]]), names: new Map([['mc-1', 'Hans']]),
  })
  const rows = await rebuildSeasonPoints({ competitionKey: 'mens-league', deps: deps as any })
  assert.equal(rows[0].total_points, 40)
  assert.equal(rows[0].events_played, 1)
})

test('cumulative = sum across completed rounds AND both competitions', async () => {
  const deps = fakeDeps({
    rounds: [
      [ { member_card_id: 'mc-1', total_points: 40 }, { member_card_id: 'mc-1', total_points: 10 } ], // wk17 gross+net
      [ { member_card_id: 'mc-1', total_points: 50 } ],                                              // wk18
    ],
    eventsPlayed: new Map([['mc-1', 2]]), wins: new Map([['mc-1', 1]]), names: new Map([['mc-1', 'Hans Olson']]),
  })
  const rows = await rebuildSeasonPoints({ competitionKey: 'mens-league', deps: deps as any })
  assert.equal(rows[0].total_points, 100, '40+10+50')
  assert.equal(rows[0].position, 1)
  assert.equal(rows[0].events_played, 2)
  assert.equal(rows[0].wins, 1)
})

test('golden parity: two completed rounds reproduce the exact snapshot (byte-equivalent)', async () => {
  // Round 17: Hans 40 (gross) + 10 (net) = 50; Sue 30.
  // Round 18: Hans 20; Sue 60.
  // seasonCum (all):           Hans 70, Sue 90  → positions Sue=1, Hans=2
  // cumBeforeLast (thru wk17): Hans 50, Sue 30  → prev positions Hans=1, Sue=2
  // leaderTotal = 90.
  const deps = fakeDeps({
    rounds: [
      [ { member_card_id: 'mc-1', total_points: 40, player_name: 'Hans Olson' },
        { member_card_id: 'mc-1', total_points: 10 },
        { member_card_id: 'mc-2', total_points: 30, player_name: 'Sue Park' } ],
      [ { member_card_id: 'mc-1', total_points: 20 },
        { member_card_id: 'mc-2', total_points: 60 } ],
    ],
    eventsPlayed: new Map([['mc-1', 2], ['mc-2', 2]]),
    wins: new Map([['mc-1', 1], ['mc-2', 1]]),
    names: new Map([['mc-1', 'Hans Olson'], ['mc-2', 'Sue Park']]),
  })
  const rows = await rebuildSeasonPoints({ competitionKey: 'mens-league', deps: deps as any })
  const expected = [
    { member_card_id: 'mc-2', player_name: 'Sue Park',  total_points: 90, position: 1, previous_position: 2, events_played: 2, wins: 1, points_behind: 0 },
    { member_card_id: 'mc-1', player_name: 'Hans Olson', total_points: 70, position: 2, previous_position: 1, events_played: 2, wins: 1, points_behind: 20 },
  ]
  assert.deepEqual(rows, expected, 'byte-equivalent golden snapshot (positions, previous_position, points_behind, events_played, wins)')
  assert.equal(deps.state.deleted, false, 'snapshot replaced, not deleted')
  assert.equal(deps.state.replaced?.length, 2)
})

test('single completed round: previous_position is null for everyone (cumBeforeLast empty)', async () => {
  const deps = fakeDeps({
    rounds: [[ { member_card_id: 'mc-1', total_points: 50, player_name: 'Hans' } ]],
    eventsPlayed: new Map([['mc-1', 1]]), wins: new Map([['mc-1', 0]]), names: new Map([['mc-1', 'Hans']]),
  })
  const rows = await rebuildSeasonPoints({ competitionKey: 'mens-league', deps: deps as any })
  assert.equal(rows[0].position, 1)
  assert.equal(rows[0].previous_position, null, 'no prior completed round → no previous position')
})

test('no completed rounds with points → delete stale snapshot, return []', async () => {
  const deps = fakeDeps({ rounds: [] })
  const rows = await rebuildSeasonPoints({ competitionKey: 'mens-league', deps: deps as any })
  assert.deepEqual(rows, [])
  assert.equal(deps.state.deleted, true, 'stale snapshot deleted when no points')
})

test('delayed finalization: re-run after a round flips to completed advances the snapshot', async () => {
  let rounds: any[][] = []
  const deps = {
    async listCompletedRoundsWithPoints() { return rounds },
    async readEventsPlayed() { return new Map([['mc-1', 1]]) },
    async readWins() { return new Map([['mc-1', 0]]) },
    async readNames() { return new Map([['mc-1', 'Hans']]) },
    async replaceSnapshot(r: any[]) { return r },
    async deleteSnapshot() { return null },
  }
  const before = await rebuildSeasonPoints({ competitionKey: 'mens-league', deps: deps as any })
  assert.equal(before.length, 0, 'no points while round not completed')
  rounds = [[ { member_card_id: 'mc-1', total_points: 50 } ]]
  const after = await rebuildSeasonPoints({ competitionKey: 'mens-league', deps: deps as any })
  assert.equal(after[0].total_points, 50, 'snapshot advanced after finalization')
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/competition-season-points.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`lib/competition/reconcile/season-points.ts`:

```ts
// FAITHFUL PORT of the existing season-points algorithm (scripts/sync-igc-league.mjs
// lines ~114–125, 259, 382–385, 437–500). The completed-round guard STAYS: only
// rounds GG marks completed AND that carry authoritative event.season_points
// are summed. Cumulative = sum across completed rounds AND both competitions
// (they share one season_point_category). previous_position is derived from
// `cumBeforeLast` — the cumulative through the SECOND-TO-LAST completed round
// (snapshotted before each round's accumulation) — NOT from a stored prior
// snapshot. Ranking uses `rankByTotalPoints` (competition ranking 1224: tied
// totals share the lower rank, next jumps). The snapshot is DELETE+REPLACED
// wholesale (no stale rows); if no points exist, the stale snapshot is deleted.
// See design spec §5 + revision (completed-round guard).
//
// DB access is injected so the accumulator is unit-testable. The production
// deps (Task 19F) read AUTHORITATIVE event.season_points per completed round —
// NOT igc_league_results.points (those are weekly per-competition points and are
// only used if proven identical to event.season_points, which they are not).
// events_played comes from igc_league_performances (weeks with non-null
// gross_scores); wins from igc_league_results flight_position=1.

export interface SeasonPointsRow {
  member_card_id: string
  player_name: string | null
  total_points: number
  position: number
  previous_position: number | null
  events_played: number
  wins: number
  points_behind: number
}

export interface SeasonPointsEntry {
  member_card_id: string
  total_points: number
  player_name?: string | null
}

export interface SeasonPointsDeps {
  // Completed rounds IN CHRONOLOGICAL ORDER, each carrying its authoritative
  // event.season_points entries (gross + net both present for individual weeks).
  listCompletedRoundsWithPoints(): Promise<SeasonPointsEntry[][]>
  // member_card_id → count of weeks with a non-null gross_scores performance.
  readEventsPlayed(): Promise<Map<string, number>>
  // member_card_id → count of flight_position=1 results.
  readWins(): Promise<Map<string, number>>
  // member_card_id → display name (from igc_league_members / performances).
  readNames(): Promise<Map<string, string | null>>
  // Wholesale delete the league's snapshot rows then insert the new set.
  replaceSnapshot(rows: SeasonPointsRow[]): Promise<unknown>
  // Delete the league's snapshot rows when there are no points (stale cleanup).
  deleteSnapshot(): Promise<unknown>
}

export interface RebuildInput {
  competitionKey: string
  deps: SeasonPointsDeps
}

// Competition ranking (1224): sort by total desc; tied totals share the lower
// rank; the next distinct total jumps by the number of tied entries it skipped.
// Verbatim semantics from the existing script's rankByTotalPoints.
export function rankByTotalPoints(totals: Map<string, number>): Map<string, number> {
  const ordered = [...totals.entries()].sort((a, b) => b[1] - a[1])
  const ranks = new Map<string, number>()
  let lastTotal = NaN
  let lastRank = 0
  let i = 0
  for (const [id, total] of ordered) {
    i++
    if (total === lastTotal) {
      ranks.set(id, lastRank)          // share the lower rank
    } else {
      ranks.set(id, i)
      lastTotal = total
      lastRank = i
    }
  }
  return ranks
}

export async function rebuildSeasonPoints(input: RebuildInput): Promise<SeasonPointsRow[]> {
  const rounds = await input.deps.listCompletedRoundsWithPoints()
  const eventsPlayed = await input.deps.readEventsPlayed()
  const wins = await input.deps.readWins()
  const names = await input.deps.readNames()

  // Accumulate cumulative totals per member, snapshotting cumBeforeLast before
  // each completed round's accumulation. After the loop, seasonCum holds the
  // sum through ALL completed rounds; cumBeforeLast holds the sum through the
  // SECOND-TO-LAST completed round (the snapshot taken before the last round).
  const seasonCum = new Map<string, number>()
  let cumBeforeLast = new Map<string, number>()
  for (const round of rounds) {
    cumBeforeLast = new Map(seasonCum)          // snapshot BEFORE this round's accumulation
    for (const sp of round) {
      const add = Number(sp.total_points) || 0
      seasonCum.set(sp.member_card_id, (seasonCum.get(sp.member_card_id) ?? 0) + add)
    }
  }

  if (seasonCum.size === 0) {
    await input.deps.deleteSnapshot()
    return []
  }

  const currentRankById = rankByTotalPoints(seasonCum)
  const prevRankById = cumBeforeLast.size > 0 ? rankByTotalPoints(cumBeforeLast) : new Map<string, number>()
  const leaderTotal = Math.max(...seasonCum.values())

  const rows: SeasonPointsRow[] = [...seasonCum.entries()].map(([member_card_id, total_points]) => ({
    member_card_id,
    player_name: names.get(member_card_id) ?? null,
    total_points,
    position: currentRankById.get(member_card_id) ?? 0,
    previous_position: prevRankById.has(member_card_id) ? (prevRankById.get(member_card_id) ?? null) : null,
    events_played: eventsPlayed.get(member_card_id) ?? 0,
    wins: wins.get(member_card_id) ?? 0,
    points_behind: leaderTotal - total_points,
  }))
  rows.sort((a, b) => a.position - b.position)
  await input.deps.replaceSnapshot(rows)
  return rows
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/competition-season-points.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/competition/reconcile/season-points.ts tests/competition-season-points.test.ts
git commit -m "feat(competition): season-points rebuild (faithful port: cumBeforeLast + rankByTotalPoints + delete/replace)"
```

---

### Task 19D: `discoverAndPersistEventClassification` — TDD

Durable discovery: discover the occurrence from config, classify (positive evidence), persist `event_format`/`discovery_state`/`discovered_at` and `source_finalized_at`. Uses the same `discoverOccurrence` as the live path but writes the verdict.

**Files:**
- Create: `lib/competition/reconcile/discover.ts`
- Create: `tests/competition-reconcile-discover.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/competition-reconcile-discover.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { discoverAndPersistEventClassification } from '../lib/competition/reconcile/discover.ts'

function fakeGg(opts: { tournaments: any[]; results: Record<string, any>; events?: any[]; rounds?: any[]; roundStatus?: string }) {
  return async (endpoint: string) => {
    if (endpoint.endsWith('/events')) return opts.events ?? [{ id: 'E', category_id: 'C' }]
    if (endpoint.endsWith('/rounds')) return opts.rounds ?? [{ id: 'R1', is_points_round: true, position: 18, status: opts.roundStatus }]
    if (endpoint.endsWith('/tournaments') && !endpoint.includes('.json')) return opts.tournaments
    const tId = endpoint.split('/').slice(-1)[0].replace('.json', '')
    return opts.results[tId] ?? { event: { scopes: [], status: opts.roundStatus } }
  }
}

const adapterConfig = { seasonId: 'S', categoryId: 'C', eventFilter: 'mens', tenantKey: 'igc', roundResolution: 'pointsRoundIndex' as const }

test('persists individual/discovered and source_finalized_at when upstream completed', async () => {
  const writes: any[] = []
  const db = { updateClassification: async (w: any) => { writes.push(w); return { ok: true } } }
  const gg = fakeGg({
    tournaments: [{ event: { id: 'g1', name: 'Gross Regular Season' } }],
    results: { g1: { event: { status: 'completed', scopes: [{ name: 'Flight 1', aggregates: [{ name: 'Hans', position: '1', gross_scores: [5,6], net_scores: [4,5], to_par_net: [-1,0], to_par_gross: [0,0], totals: { gross_scores: { out: 11 } } }] }] } } },
    roundStatus: 'completed',
  })
  const r = await discoverAndPersistEventClassification({ competitionKey: 'mens-league', weekNumber: 18, adapterConfig, ggClient: gg, db: db as any, nowIso: '2026-07-28T22:00:00Z' })
  assert.equal(r.eventFormat, 'individual')
  assert.equal(r.discoveryState, 'discovered')
  assert.ok(writes[0].source_finalized_at, 'source_finalized_at persisted when completed')
})

test('persists unknown/pending for an upcoming round with no tournaments', async () => {
  const writes: any[] = []
  const db = { updateClassification: async (w: any) => { writes.push(w); return { ok: true } } }
  const gg = fakeGg({ tournaments: [], results: {}, roundStatus: 'not_started' })
  const r = await discoverAndPersistEventClassification({ competitionKey: 'mens-league', weekNumber: 19, adapterConfig, ggClient: gg, db: db as any, nowIso: '2026-07-29T22:00:00Z' })
  assert.equal(r.eventFormat, 'unknown')
  assert.equal(r.discoveryState, 'pending')
  assert.equal(writes[0].source_finalized_at, null)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/competition-reconcile-discover.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`lib/competition/reconcile/discover.ts`:

```ts
// Durable discovery + classification persistence. Reuses the live-path
// discoverOccurrence (config-driven, positive evidence) and writes the
// verdict to igc_league_events: event_format, discovery_state, discovered_at,
// and source_finalized_at (set only when upstream status is completed).

import { discoverOccurrence } from '../adapters/golfgenius/discovery.ts'
import type { GolfGeniusAdapterConfig } from '../types.ts'
import type { GGClient } from '../adapters/golfgenius/discovery.ts'

export interface ClassifyDb {
  updateClassification(w: {
    league_key: string; week_number: number
    event_format: 'individual' | 'team' | 'unknown'
    discovery_state: 'pending' | 'discovered' | 'inconclusive' | 'failed'
    discovered_at: string
    source_finalized_at: string | null
    source_version: string | null
  }): Promise<{ ok: boolean }>
}

export interface DiscoverPersistInput {
  competitionKey: string
  weekNumber: number
  adapterConfig: GolfGeniusAdapterConfig
  ggClient: GGClient
  db: ClassifyDb
  nowIso: string
}

// Returns the DiscoverResult (carrying `resolved: ResolvedOccurrence`) so the
// orchestrator (Task 19F) can pass `resolved` straight into importOccurrence
// without re-discovering or placeholders.
export async function discoverAndPersistEventClassification(input: DiscoverPersistInput) {
  const r = await discoverOccurrence({
    competitionKey: input.competitionKey,
    tenantKey: input.adapterConfig.tenantKey,
    adapterConfig: input.adapterConfig,
    occurrenceContext: { number: input.weekNumber, date: null },
    persistedHints: null,                                   // durable path re-discovers fresh
    teamOverride: (input.adapterConfig.teamFormatOverrides ?? []).includes(input.weekNumber),
    ggClient: input.ggClient,
    scoringMode: 'net',
  })
  const finalized = r.resolved.upstreamStatus === 'completed' ? (r.resolved.sourceFinalizedAt ?? input.nowIso) : null
  await input.db.updateClassification({
    league_key: input.competitionKey === 'mens-league' ? 'mens' : 'womens',
    week_number: input.weekNumber,
    event_format: r.eventFormat,
    discovery_state: r.discoveryState,
    discovered_at: input.nowIso,
    source_finalized_at: finalized,
    source_version: r.resolved.sourceVersion,
  })
  return r
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/competition-reconcile-discover.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/competition/reconcile/discover.ts tests/competition-reconcile-discover.test.ts
git commit -m "feat(competition): durable discovery + classification persistence"
```

---

### Task 19E: `selectReconciliationCandidates` (pure) — TDD

Resolves plan issue #14: explicitly distinguish active / played-awaiting-finalization / upstream-finalized / unknown-unresolved / old-current. Finalized import is authorized by **upstream status = completed**, not recency.

**Files:**
- Create: `lib/competition/reconcile/candidates.ts`
- Create: `tests/competition-candidates.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/competition-candidates.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { selectReconciliationCandidates, type CandidateEvent } from '../lib/competition/reconcile/candidates.ts'

function ev(over: Partial<CandidateEvent>): CandidateEvent {
  return {
    week_number: 18, event_date: '2026-07-28',
    event_format: 'unknown', discovery_state: 'pending',
    upstream_status: null, durable_imported_at: null,
    ...over,
  }
}

test('active: unresolved + in play window → discovery only', () => {
  const c = selectReconciliationCandidates([ev({ event_format: 'unknown', discovery_state: 'pending', upstream_status: 'in_progress' })], '2026-07-28T18:00:00Z')
  assert.equal(c[0].kind, 'active')
  assert.equal(c[0].action, 'discover')
})

test('played-awaiting-finalization: in_progress but not completed → check status, no points', () => {
  const c = selectReconciliationCandidates([ev({ event_format: 'individual', discovery_state: 'discovered', upstream_status: 'in_progress' })], '2026-07-28T20:00:00Z')
  assert.equal(c[0].kind, 'played-awaiting-finalization')
  assert.equal(c[0].action, 'discover')
})

test('upstream-finalized: completed status → import + rebuild points', () => {
  const c = selectReconciliationCandidates([ev({ event_format: 'individual', discovery_state: 'discovered', upstream_status: 'completed', durable_imported_at: null })], '2026-07-28T22:00:00Z')
  assert.equal(c[0].kind, 'upstream-finalized')
  assert.equal(c[0].action, 'import')
})

test('upstream-finalized already durable: skipped (old-current)', () => {
  const c = selectReconciliationCandidates([ev({ event_format: 'individual', discovery_state: 'discovered', upstream_status: 'completed', durable_imported_at: '2026-07-28T22:05:00Z' })], '2026-07-29T10:00:00Z')
  assert.equal(c[0].kind, 'old-current')
  assert.equal(c[0].action, 'skip')
})

test('unknown-unresolved: stale inconclusive → re-discover', () => {
  const c = selectReconciliationCandidates([ev({ event_format: 'unknown', discovery_state: 'inconclusive', upstream_status: null })], '2026-07-29T10:00:00Z')
  assert.equal(c[0].kind, 'unknown-unresolved')
  assert.equal(c[0].action, 'discover')
})

test('old finalized with no upstream status and already durable: skip', () => {
  const c = selectReconciliationCandidates([ev({ event_format: 'individual', discovery_state: 'discovered', upstream_status: null, durable_imported_at: '2026-07-01T22:00:00Z' })], '2026-07-29T10:00:00Z')
  assert.equal(c[0].kind, 'old-current')
  assert.equal(c[0].action, 'skip')
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/competition-candidates.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`lib/competition/reconcile/candidates.ts`:

```ts
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
    if (fmt === 'unknown' || ds === 'inconclusive' || ds === 'pending' || ds === 'failed') {
      return { week_number: e.week_number, kind: 'unknown-unresolved', action: 'discover' as const }
    }
    if (ups === 'in_progress') {
      return { week_number: e.week_number, kind: 'played-awaiting-finalization', action: 'discover' as const }
    }
    // discovered individual, no upstream status signal, not durable → still
    // active/awaiting; re-discover to refresh status.
    if (fmt === 'individual' && !e.durable_imported_at) {
      return { week_number: e.week_number, kind: 'active', action: 'discover' as const }
    }
    return { week_number: e.week_number, kind: 'old-current', action: 'skip' as const }
  })
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/competition-candidates.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/competition/reconcile/candidates.ts tests/competition-candidates.test.ts
git commit -m "feat(competition): reconciliation candidate selection (upstream-status-gated)"
```

---

### Task 19F: Orchestrate within a shared budget — TDD

Resolves plan issues #13 (orchestration real, not placeholder) and #15 (one shared absolute deadline created once, passed to every competition; leave time to serialize/log + clean cache). Wires the modules from 19A–19E with a budget check at the top of every iteration.

**Files:**
- Create: `lib/competition/reconcile/reconcile.ts`
- Create: `tests/competition-reconcile.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/competition-reconcile.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reconcileCompetition } from '../lib/competition/reconcile/reconcile.ts'

// Fake ops: track discover/import calls. discoverAndPersist returns a
// ResolvedOccurrence (carried on `resolved`) whose upstreamStatus drives the
// import decision — mirroring the real discovery→import handoff (Correction 6).
function makeOps(opts: { events: any[]; completedWeeks: number[] }) {
  const calls: string[] = []
  const imported: any[] = []
  return {
    calls, imported,
    async listEvents() { return opts.events },
    async discoverAndPersist(_competitionKey: string, week: number, _nowIso: string) {
      calls.push(`discover:${week}`)
      return { resolved: {
        weekNumber: week, ggEventId: 'E', ggRoundId: 'R1',
        grossTournamentId: 'g1', netTournamentId: 'n1',
        upstreamStatus: opts.completedWeeks.includes(week) ? 'completed' : 'in_progress',
        roundDate: '2026-07-28', eventName: 'Mens League',
        sourceFinalizedAt: opts.completedWeeks.includes(week) ? '2026-07-28T22:00:00Z' : null,
        sourceVersion: opts.completedWeeks.includes(week) ? 'v9' : null,
      } }
    },
    async importOccurrence(_competitionKey: string, week: number, _nowIso: string, resolved: any) {
      calls.push(`import:${week}`); imported.push(resolved)
    },
    async rebuildSeasonPoints(_competitionKey: string) { calls.push('points') },
  }
}

const baseEvents = (over: Partial<any>[]) => over.map((o, i) => ({
  week_number: i + 1, event_date: '2026-07-28', upstream_status: null, durable_imported_at: null,
  event_format: 'unknown', discovery_state: 'pending', ...o,
}))

test('upstream-finalized → discover + import + rebuild; old-current → skip', async () => {
  const ops = makeOps({ events: baseEvents([
    { week_number: 18, event_format: 'individual', discovery_state: 'discovered', upstream_status: 'completed', durable_imported_at: null },
    { week_number: 17, event_format: 'individual', discovery_state: 'discovered', upstream_status: 'completed', durable_imported_at: '2026-07-01T00:00:00Z' },
  ]), completedWeeks: [18] })
  const summary = await reconcileCompetition({
    competitionKey: 'mens-league', deadlineMs: Date.now() + 60_000, nowIso: '2026-07-28T22:00:00Z', ops: ops as any,
  })
  assert.ok(ops.calls.includes('discover:18'))
  assert.ok(ops.calls.includes('import:18'))
  assert.ok(ops.calls.includes('points'))
  assert.ok(!ops.calls.includes('import:17'), 'old-current skipped import')
  assert.equal(summary.imported, 1)
  assert.equal(summary.skipped, 1)
  // Correction 6: the ResolvedOccurrence flowed discovery → import (no placeholders).
  assert.equal(ops.imported[0].ggEventId, 'E')
  assert.equal(ops.imported[0].grossTournamentId, 'g1')
})

test('unresolved candidate whose discovery returns completed → import + rebuild in the SAME run', async () => {
  // Candidate pre-classifies as unknown-unresolved (upstream_status null,
  // event_format unknown) → 'discover' action. But discovery finds the round
  // is now completed and returns resolved IDs. The same run imports + rebuilds.
  const ops = makeOps({ events: baseEvents([
    { week_number: 18, event_format: 'unknown', discovery_state: 'pending', upstream_status: null, durable_imported_at: null },
  ]), completedWeeks: [18] })
  const summary = await reconcileCompetition({
    competitionKey: 'mens-league', deadlineMs: Date.now() + 60_000, nowIso: '2026-07-28T22:00:00Z', ops: ops as any,
  })
  assert.ok(ops.calls.includes('discover:18'))
  assert.ok(ops.calls.includes('import:18'), 'import fired when discovery found completed')
  assert.ok(ops.calls.includes('points'))
  assert.equal(summary.imported, 1)
})

test('played-awaiting-finalization (in_progress) → discover only, no import', async () => {
  const ops = makeOps({ events: baseEvents([
    { week_number: 18, event_format: 'individual', discovery_state: 'discovered', upstream_status: 'in_progress', durable_imported_at: null },
  ]), completedWeeks: [] })   // discovery returns in_progress
  const summary = await reconcileCompetition({
    competitionKey: 'mens-league', deadlineMs: Date.now() + 60_000, nowIso: '2026-07-28T20:00:00Z', ops: ops as any,
  })
  assert.ok(ops.calls.includes('discover:18'))
  assert.ok(!ops.calls.includes('import:18'), 'not completed → no import')
  assert.equal(summary.imported, 0)
  assert.equal(summary.discovered, 1)
})

test('stops before the shared deadline and marks stoppedForBudget', async () => {
  // Many finalized weeks; tiny deadline so we stop early.
  const events = Array.from({ length: 50 }, (_, i) => ({
    week_number: i + 1, event_date: '2026-07-28', event_format: 'individual', discovery_state: 'discovered',
    upstream_status: 'completed', durable_imported_at: null,
  }))
  const ops = makeOps({ events, completedWeeks: events.map((e) => e.week_number) })
  const summary = await reconcileCompetition({
    competitionKey: 'mens-league', deadlineMs: Date.now() + 0, nowIso: '2026-07-28T22:00:00Z', ops: ops as any,
  })
  assert.equal(summary.stoppedForBudget, true)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/competition-reconcile.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`lib/competition/reconcile/reconcile.ts`:

```ts
// Idempotent, bounded reconciliation. ONE shared absolute deadline is created
// in reconcileAllCompetitions and passed to every competition; each iteration
// checks the deadline FIRST so a timeout never leaves a run half-applied.
// Unfinished work is eligible for the next hourly run (every step is an
// idempotent upsert). Candidate selection (Task 19E) decides discover vs
// import; import is authorized by upstream_status='completed' only. Failures
// are isolated per competition. Time is reserved before the deadline to
// serialize the summary + clean the cache. See design spec §5/§7.

import { allCompetitionConfigs } from '../registry.ts'
import { selectReconciliationCandidates, type CandidateEvent } from './candidates.ts'
import type { ResolvedOccurrence } from '../types.ts'

export interface ReconcileSummary {
  competition: string
  discovered: number
  imported: number
  skipped: number
  seasonPointsRebuilds: number
  errors: string[]
  stoppedForBudget: boolean
}

// Injected operations so this is unit-testable. discoverAndPersist returns
// the DiscoverResult (carrying `resolved: ResolvedOccurrence`); importOccurrence
// takes that `resolved` — the discovery→import handoff uses real resolved IDs,
// never placeholders (Corrections 4 & 6).
export interface ReconcileOps {
  listEvents(competitionKey: string): Promise<CandidateEvent[]>
  discoverAndPersist(competitionKey: string, week: number, nowIso: string): Promise<{ resolved: ResolvedOccurrence }>
  importOccurrence(competitionKey: string, week: number, nowIso: string, resolved: ResolvedOccurrence): Promise<void>
  rebuildSeasonPoints(competitionKey: string): Promise<void>
}

const RESERVE_MS = 5_000   // leave time to serialize/log + clean cache

export interface ReconcileAllInput {
  deadlineMs: number       // shared absolute deadline
  nowIso: string
  ops?: ReconcileOps
}

export async function reconcileAllCompetitions(input: ReconcileAllInput): Promise<ReconcileSummary[]> {
  const summaries: ReconcileSummary[] = []
  for (const config of allCompetitionConfigs()) {
    try {
      summaries.push(await reconcileCompetition({
        competitionKey: config.key, deadlineMs: input.deadlineMs, nowIso: input.nowIso, ops: input.ops,
      }))
    } catch (err) {
      summaries.push({ competition: config.key, discovered: 0, imported: 0, skipped: 0, seasonPointsRebuilds: 0, errors: [String(err)], stoppedForBudget: false })
    }
  }
  return summaries
}

export interface ReconcileCompetitionInput {
  competitionKey: string
  deadlineMs: number
  nowIso: string
  ops?: ReconcileOps
}

export async function reconcileCompetition(input: ReconcileCompetitionInput): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = { competition: input.competitionKey, discovered: 0, imported: 0, skipped: 0, seasonPointsRebuilds: 0, errors: [], stoppedForBudget: false }
  const ops = input.ops ?? (await defaultOps())

  const events = await ops.listEvents(input.competitionKey)
  const candidates = selectReconciliationCandidates(events, input.nowIso)

  for (const c of candidates) {
    if (Date.now() + RESERVE_MS >= input.deadlineMs) { summary.stoppedForBudget = true; break }
    try {
      if (c.action === 'skip') { summary.skipped++; continue }
      // ALWAYS discover — discovery returns the ResolvedOccurrence (ids +
      // upstream status). Candidate pre-selection only decides skip-vs-process;
      // the import decision uses the DISCOVERED upstream status, so an
      // unresolved candidate that GG now marks completed is imported in the
      // same run (Correction 6). No placeholders: `resolved` flows discovery→import.
      const r = await ops.discoverAndPersist(input.competitionKey, c.week_number, input.nowIso)
      summary.discovered++
      if (r.resolved.upstreamStatus === 'completed') {
        await ops.importOccurrence(input.competitionKey, c.week_number, input.nowIso, r.resolved)
        summary.imported++
        await ops.rebuildSeasonPoints(input.competitionKey)
        summary.seasonPointsRebuilds++
      }
    } catch (err) {
      summary.errors.push(`wk${c.week_number}: ${String(err)}`)
    }
  }
  return summary
}

// Production ops: wire gg-helpers-backed import + season-points + discover
// modules to the service client. Built lazily so the module imports cleanly
// in tests that inject ops. The discovery→import handoff passes the real
// ResolvedOccurrence (no placeholders — Corrections 4 & 6).
async function defaultOps(): Promise<ReconcileOps> {
  const { createServiceClient } = await import('../../supabase/service.ts')
  const { makeGolfGeniusRequest } = await import('../../gg/client.ts')
  const { discoverAndPersistEventClassification } = await import('./discover.ts')
  const { importOccurrence } = await import('./import.ts')
  const { rebuildSeasonPoints } = await import('./season-points.ts')
  const supabase = createServiceClient()
  const ggClient = (async (endpoint: string) => makeGolfGeniusRequest({ endpoint })) as any
  return {
    async listEvents(competitionKey) {
      const leagueKey = competitionKey === 'mens-league' ? 'mens' : 'womens'
      const { data } = await supabase.from('igc_league_events')
        .select('week_number, event_date, event_format, discovery_state, source_finalized_at, durable_imported_at')
        .eq('league_key', leagueKey).order('week_number', { ascending: false }).limit(200)
      return (data ?? []).map((e: any) => ({
        week_number: e.week_number, event_date: e.event_date,
        event_format: e.event_format, discovery_state: e.discovery_state,
        upstream_status: e.source_finalized_at ? 'completed' : null,
        durable_imported_at: e.durable_imported_at,
      }))
    },
    async discoverAndPersist(competitionKey, week, nowIso) {
      const config = (await import('../registry.ts')).getCompetitionConfig(competitionKey)!
      // Returns the DiscoverResult (carrying `resolved`); orchestration reads
      // resolved.upstreamStatus and passes `resolved` into importOccurrence.
      return await discoverAndPersistEventClassification({ competitionKey, weekNumber: week, adapterConfig: config.adapterConfig, ggClient, db: classifyDb(supabase, competitionKey), nowIso })
    },
    async importOccurrence(competitionKey, week, nowIso, resolved) {
      const config = (await import('../registry.ts')).getCompetitionConfig(competitionKey)!
      // `resolved` carries the ids discovery already resolved — NO placeholders.
      await importOccurrence({ competitionKey, resolved, adapterConfig: config.adapterConfig, ggClient, db: importDb(supabase, competitionKey), nowIso })
    },
    async rebuildSeasonPoints(competitionKey) {
      await rebuildSeasonPoints({ competitionKey, deps: seasonDeps(supabase, competitionKey) })
    },
  }
}

function classifyDb(supabase: any, competitionKey: string) {
  const leagueKey = competitionKey === 'mens-league' ? 'mens' : 'womens'
  return {
    async updateClassification(w: any) {
      await supabase.from('igc_league_events').update({
        event_format: w.event_format, discovery_state: w.discovery_state,
        discovered_at: w.discovered_at, source_finalized_at: w.source_finalized_at,
        source_version: w.source_version,
      }).eq('league_key', leagueKey).eq('week_number', w.week_number)
      return { ok: true }
    },
  }
}
function importDb(supabase: any, competitionKey: string) {
  const leagueKey = competitionKey === 'mens-league' ? 'mens' : 'womens'
  return {
    async upsertEvent(row: any) {
      await supabase.from('igc_league_events').update({
        gg_event_id: row.gg_event_id, gg_round_id: row.gg_round_id,
        gg_gross_tournament_id: row.gg_gross_tournament_id, gg_net_tournament_id: row.gg_net_tournament_id,
        event_format: row.event_format, discovery_state: row.discovery_state,
        source_finalized_at: row.source_finalized_at, source_version: row.source_version,
        status: row.status,
      }).eq('league_key', leagueKey).eq('week_number', row.week_number)
      return { ok: true }
    },
    async upsertPerformances(rows: any[]) { await supabase.from('igc_league_performances').upsert(rows); return { ok: true } },
    async upsertResults(rows: any[]) { await supabase.from('igc_league_results').upsert(rows); return { ok: true } },
    async setDurableImported(week: number, atIso: string, sourceVersion: string | null) {
      await supabase.from('igc_league_events').update({ durable_imported_at: atIso, durable_source_version: sourceVersion })
        .eq('league_key', leagueKey).eq('week_number', week)
      return { ok: true }
    },
  }
}

// Season-points production deps (Correction 5): read AUTHORITATIVE event.season_points
// per completed round — NOT igc_league_results.points (those are weekly per-
// competition points and are NOT the cumulative authoritative totals; they are
// only used if proven identical, which they are not). Scope every query by
// league_key. events_played = weeks with a non-null gross_scores performance;
// wins = count of flight_position=1 results; names from igc_league_members.
// The snapshot is DELETE+REPLACED wholesale (no stale rows); deleted outright
// when there are no points. The accumulation math (cumBeforeLast, rankByTotalPoints)
// lives in season-points.ts.
function seasonDeps(supabase: any, competitionKey: string) {
  const leagueKey = competitionKey === 'mens-league' ? 'mens' : 'womens'
  return {
    async listCompletedRoundsWithPoints() {
      // Authoritative source: GG's embedded event.season_points, captured at
      // import time into igc_league_season_point_entries (Migration 026). Each
      // completed round contributes one array of {member_card_id, total_points,
      // player_name} entries. Ordered by week_number ascending. (If the entries
      // table is not yet populated, fall back to reading the captured season_points
      // JSON from igc_league_events — but never derive from igc_league_results.points.)
      const { data } = await supabase.from('igc_league_season_point_entries')
        .select('week_number, member_card_id, total_points, player_name')
        .eq('league_key', leagueKey).order('week_number', { ascending: true })
      const byRound = new Map<number, { member_card_id: string; total_points: number; player_name?: string | null }[]>()
      for (const r of data ?? []) {
        if (!byRound.has(r.week_number)) byRound.set(r.week_number, [])
        byRound.get(r.week_number)!.push({ member_card_id: r.member_card_id, total_points: Number(r.total_points ?? 0), player_name: r.player_name ?? null })
      }
      return [...byRound.values()]
    },
    async readEventsPlayed() {
      // weeks with a non-null gross_scores performance per member
      const { data } = await supabase.from('igc_league_performances')
        .select('member_card_id, gross_scores').eq('league_key', leagueKey)
      const m = new Map<string, number>()
      for (const r of data ?? []) {
        if (Array.isArray(r.gross_scores) && r.gross_scores.some((g: number | null) => g != null)) {
          m.set(r.member_card_id, (m.get(r.member_card_id) ?? 0) + 1)
        }
      }
      return m
    },
    async readWins() {
      const { data } = await supabase.from('igc_league_results')
        .select('member_card_id, flight_position').eq('league_key', leagueKey).eq('flight_position', 1)
      const m = new Map<string, number>()
      for (const r of data ?? []) m.set(r.member_card_id, (m.get(r.member_card_id) ?? 0) + 1)
      return m
    },
    async readNames() {
      const { data } = await supabase.from('igc_league_members').select('member_card_id, name').eq('league_key', leagueKey)
      return new Map((data ?? []).map((r: any) => [r.member_card_id, r.name ?? null]))
    },
    async replaceSnapshot(rows: any[]) {
      // Wholesale delete + replace (no stale rows).
      await supabase.from('igc_league_season_points').delete().eq('league_key', leagueKey)
      if (rows.length) {
        const payload = rows.map((r) => ({
          league_key: leagueKey, member_card_id: r.member_card_id, player_name: r.player_name,
          position: r.position, previous_position: r.previous_position, total_points: r.total_points,
          events_played: r.events_played, wins: r.wins, points_behind: r.points_behind,
          synced_at: new Date().toISOString(),
        }))
        await supabase.from('igc_league_season_points').insert(payload)
      }
    },
    async deleteSnapshot() {
      await supabase.from('igc_league_season_points').delete().eq('league_key', leagueKey)
      return null
    },
  }
}
```

> **Note for the implementer:** `seasonDeps.listCompletedRoundsWithPoints` reads from a `igc_league_season_point_entries` table that stores the authoritative `event.season_points` captured per completed round at import time. If Migration 026 does not already add this table, add it (additive: `league_key TEXT, week_number INT, member_card_id TEXT, total_points NUMERIC(10,2), player_name TEXT`, unique on `(league_key, week_number, member_card_id)`, RLS service-role-only — same posture as the season_points table). Populate it in `importOccurrence` (Task 19B) by writing each completed round's `event.season_points` entries alongside the results. Never substitute `igc_league_results.points` for the authoritative `event.season_points` totals — they are not the same value (weekly per-competition points vs cumulative authoritative season points).

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/competition-reconcile.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/competition/reconcile/reconcile.ts tests/competition-reconcile.test.ts
git commit -m "feat(competition): bounded reconciliation (discovery→import resolved handoff, shared deadline)"
```

---

### Task 19G: Convert CLI to a thin wrapper + parity check

**Files:**
- Modify: `scripts/sync-igc-league.mjs`

- [ ] **Step 1: Rewrite the CLI**

`scripts/sync-igc-league.mjs` — replace the monolithic body with a thin wrapper that accepts the league arg the existing `package.json` `sync:league` script already passes:

```js
#!/usr/bin/env node
// Thin CLI wrapper around the reusable reconciliation logic.
// Usage: node scripts/sync-igc-league.mjs [mens|womens]
import { reconcileCompetition } from '../lib/competition/reconcile/reconcile.ts'
const leagueKey = process.argv[2]
if (!leagueKey || !['mens', 'womens'].includes(leagueKey)) {
  console.error('Usage: node scripts/sync-igc-league.mjs [mens|womens]'); process.exit(1)
}
const competitionKey = leagueKey === 'mens' ? 'mens-league' : 'womens-league'
const summary = await reconcileCompetition({ competitionKey, deadlineMs: Date.now() + 5 * 60_000, nowIso: new Date().toISOString() })
console.log(`${competitionKey}:`, summary)
```

- [ ] **Step 2: Parity check**

Run against local Supabase + GG: `node scripts/sync-igc-league.mjs mens` (requires env). Compare one finalized week's `igc_league_performances` / `igc_league_results` / `igc_league_season_points` rows to a pre-change baseline snapshot — they must be identical (the scoring math was ported verbatim from gg-helpers + the existing snapshot build).

Expected: identical rows (parity).

- [ ] **Step 3: Commit**

```bash
git add scripts/sync-igc-league.mjs
git commit -m "feat(competition): sync CLI → thin wrapper over reconcile"
```

---

### Task 20: Cron route + vercel.json + CRON_SECRET

Resolves plan issue #9 (remove the broken duplicate `cleanExpiredCache` import) and revision 9 (bounded, verified execution budget). The cron creates ONE shared deadline and passes it to `reconcileAllCompetitions`.

**Files:**
- Create: `app/api/cron/reconcile/route.ts`
- Modify: `vercel.json`
- Modify: `package.json` (add `reconcile` script)

- [ ] **Step 1: Implement the cron route**

`app/api/cron/reconcile/route.ts`:

```ts
import { NextResponse } from 'next/server'

import { reconcileAllCompetitions } from '@/lib/competition/reconcile/reconcile'
import { cleanExpiredCache } from '@/lib/competition/cache'

export const dynamic = 'force-dynamic'
// maxDuration is NOT assumed from a default; the deployment plan must verify
// the actual Vercel function timeout for this route and the soft deadline in
// reconcile.ts stays well below it. See design spec §7 (revision 9).

// One shared absolute deadline for the whole run. The hourly cron leaves
// reserve time below this for serialization + cache cleanup.
const CRON_DEADLINE_MS = 90_000

export async function GET(request: Request) {
  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const deadlineMs = Date.now() + CRON_DEADLINE_MS
  const summaries = await reconcileAllCompetitions({ deadlineMs, nowIso: new Date().toISOString() })
  await cleanExpiredCache().catch(() => {})
  console.log('[cron/reconcile]', JSON.stringify(summaries))
  return NextResponse.json({ ok: true, summaries })
}
```

- [ ] **Step 2: Add the cron to vercel.json**

Add a `crons` array to the existing `vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs",
  "installCommand": "corepack pnpm install --frozen-lockfile",
  "buildCommand": "corepack pnpm run build",
  "crons": [
    { "path": "/api/cron/reconcile", "schedule": "13 * * * *" }
  ]
}
```

- [ ] **Step 3: Add `reconcile` npm script + document CRON_SECRET**

In `package.json` scripts add:

```json
    "reconcile": "node -e \"import('./lib/competition/reconcile/reconcile.ts').then(async m => { const s = await m.reconcileAllCompetitions({ deadlineMs: Date.now() + 90000, nowIso: new Date().toISOString() }); console.log(s); })\"",
```

Add `CRON_SECRET=...` to `.env.local.example` and note in `CLAUDE.md` Environment Variables that `CRON_SECRET` gates `/api/cron/reconcile`.

- [ ] **Step 4: Verify execution budget**

Check the Vercel deployment plan's function timeout for the cron route (default 300s on current plans per the platform notes, but **verify** in the project's Vercel settings). Confirm `CRON_DEADLINE_MS = 90_000` is comfortably below the verified `maxDuration`. If the verified timeout is lower, lower the deadline.

- [ ] **Step 5: Lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/api/cron/reconcile/route.ts vercel.json package.json .env.local.example CLAUDE.md
git commit -m "feat(competition): hourly reconciliation cron + CRON_SECRET gate"
```

---

### Task 21: Integration tests (local Supabase) — idempotency, delayed finalization, cross-instance

Require a running local Supabase (`pnpm supabase`) and run manually (not in CI). Document the cross-instance best-effort guarantee (revision 5).

**Files:**
- Create: `tests/integration/reconcile-idempotent.mjs`
- Create: `tests/integration/cache-cross-instance.mjs`
- Create: `tests/integration/README.md`

- [ ] **Step 1: Idempotency + delayed-finalization test**

`tests/integration/reconcile-idempotent.mjs` — a script that:
1. Seeds (or uses existing) `igc_league_events` rows for a test week with `event_format='unknown'`.
2. Mocks/overrides GG to return a `completed` round with `season_points` populated.
3. Runs `reconcileCompetition({ competitionKey: 'mens-league', deadlineMs: ..., nowIso: ..., ops: injected })` twice.
4. Asserts the second run's `igc_league_season_points` rows are byte-identical to the first (idempotency — spec test #11).
5. Seeds a second week played but **not** `completed` in GG; runs reconcile; asserts the snapshot did **not** advance (completed-round guard — spec test #10); then flips the mock to `completed` + `season_points`, runs reconcile again, asserts the snapshot advanced.

Use `node:test` + `node:assert` so it runs with `node --test tests/integration/reconcile-idempotent.mjs` once Supabase is up. Guard with an early skip if `process.env.NEXT_PUBLIC_SUPABASE_URL` is unset.

- [ ] **Step 2: Cross-instance cache doc test**

`tests/integration/cache-cross-instance.mjs` — documents the best-effort guarantee: two concurrent cold-miss calls for the same key (clear the cache row then fire two `getLiveResults` concurrently against a fake GG that counts calls). Assert each returns a correct `LiveResponse`. Assert at least one upstream call happened; **do not** assert exactly one (duplicate cold-miss fetches are permitted — spec test #16). Print a clear comment that strict cross-instance single-flight requires the optional advisory lock.

- [ ] **Step 3: README**

`tests/integration/README.md`:

```md
# Integration tests (require local Supabase)
These are NOT unit tests. They need a running local Supabase and GG fixtures.

    pnpm supabase          # start local Supabase (applies migrations)
    node --test tests/integration/reconcile-idempotent.mjs
    node --test tests/integration/cache-cross-instance.mjs

The cache cross-instance test documents the BEST-EFFORT coalescing guarantee:
duplicate upstream fetches during simultaneous cold misses are permitted.
Strict cross-instance single-flight would require a Postgres advisory lock
(not implemented in this phase).
```

- [ ] **Step 4: Run them locally**

Run: `pnpm supabase` then `node --test tests/integration/reconcile-idempotent.mjs` and `node --test tests/integration/cache-cross-instance.mjs`
Expected: both pass (or skip cleanly if env unset).

- [ ] **Step 5: Commit**

```bash
git add tests/integration
git commit -m "test(competition): integration tests for reconcile idempotency + cache cross-instance"
```

---

## Phase 5 — UI

### Task 22: Shared UI primitives — status badge + states

Resolves plan issue #10 (the `UnavailableState` compile error: JSX referenced `refreshing` while the prop is `retrying`).

**Files:**
- Create: `components/competition/status-badge.tsx`
- Create: `components/competition/states.tsx`

- [ ] **Step 1: Implement**

`components/competition/status-badge.tsx`:

```tsx
'use client'

import type { ResultStatus } from '@/lib/competition/types'

export function StatusBadge({ status }: { status: ResultStatus }) {
  if (status === 'live') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
        LIVE
      </span>
    )
  }
  if (status === 'final') {
    return <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Final</span>
  }
  return null
}
```

`components/competition/states.tsx` — `LoadingSkeleton`, `EmptyState`, `UnavailableState`, `TeamEventState`, `RefreshingIndicator`. The team-event state renders only when the server positively classified `team` (the component just receives `eventFormat='team'` + `discoveryState='discovered'`); it never derives team from absence. `UnavailableState` uses `retrying` consistently.

```tsx
'use client'

export function LoadingSkeleton() {
  return (
    <div className="space-y-2" role="status" aria-label="Loading results">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="h-10 animate-pulse rounded-md bg-muted/40" />
      ))}
    </div>
  )
}

export function EmptyState({ message }: { message: string }) {
  return <p className="text-sm text-muted-foreground">{message}</p>
}

export function UnavailableState({
  message, onRetry, retrying,
}: {
  message: string
  onRetry?: () => void
  retrying?: boolean
}) {
  return (
    <div className="rounded-md border border-dashed border-border bg-muted/20 p-4 text-sm">
      <p className="text-muted-foreground">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="mt-2 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
        >
          {retrying ? 'Refreshing…' : 'Refresh now'}
        </button>
      )}
    </div>
  )
}

export function TeamEventState({ label }: { label: string }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-muted/20 p-4 text-sm">
      <p className="font-medium">Team event</p>
      <p className="mt-1 text-muted-foreground">{label} is a team/scramble format. Individual scorecards aren&apos;t available for this round.</p>
    </div>
  )
}

export function RefreshingIndicator({ refreshing }: { refreshing: boolean }) {
  if (!refreshing) return null
  return <span className="text-xs text-muted-foreground/70">Refreshing…</span>
}
```

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/competition/status-badge.tsx components/competition/states.tsx
git commit -m "feat(competition): shared status badge + state components"
```

---

### Task 23: Controls — occurrence nav, scoring toggle, grouping filter

**Files:**
- Create: `components/competition/occurrence-nav.tsx`
- Create: `components/competition/scoring-toggle.tsx`
- Create: `components/competition/grouping-filter.tsx`

- [ ] **Step 1: Implement occurrence nav (prev/next + dropdown)**

`components/competition/occurrence-nav.tsx` — client component; navigates by updating `?queryParam=id` without scroll. Prev/Next disabled at ends. Native `<select>` dropdown (mobile-friendly, no horizontal scroll).

```tsx
'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'

interface Occ { id: string; label: string }

export function OccurrenceNav({
  occurrences, selectedId, queryParam,
}: { occurrences: Occ[]; selectedId: string | null; queryParam: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const idx = occurrences.findIndex((o) => o.id === selectedId)
  const prev = idx > 0 ? occurrences[idx - 1] : null
  const next = idx >= 0 && idx < occurrences.length - 1 ? occurrences[idx + 1] : null

  const navigate = (id: string) => {
    const nextParams = new URLSearchParams(params.toString())
    nextParams.set(queryParam, id)
    router.replace(`${pathname}?${nextParams.toString()}`, { scroll: false })
  }

  return (
    <div className="flex items-center gap-2">
      <button type="button" disabled={!prev} onClick={() => prev && navigate(prev.id)}
        className="rounded-md border border-border px-2 py-1 text-sm disabled:opacity-40" aria-label="Previous">‹</button>
      <select
        value={selectedId ?? ''}
        onChange={(e) => navigate(e.target.value)}
        className="rounded-md border border-border bg-background px-2 py-1 text-sm"
      >
        {occurrences.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      <button type="button" disabled={!next} onClick={() => next && navigate(next.id)}
        className="rounded-md border border-border px-2 py-1 text-sm disabled:opacity-40" aria-label="Next">›</button>
    </div>
  )
}
```

- [ ] **Step 2: Implement scoring toggle + grouping filter**

`components/competition/scoring-toggle.tsx`:

```tsx
'use client'

import { cn } from '@/lib/utils'

export function ScoringToggle({
  modes, selected, onSelect,
}: { modes: { key: string; label: string }[]; selected: string; onSelect: (m: string) => void }) {
  if (modes.length <= 1) return null
  return (
    <div className="inline-flex rounded-md border border-border p-0.5">
      {modes.map((m) => (
        <button key={m.key} type="button" onClick={() => onSelect(m.key)}
          className={cn('rounded px-2.5 py-1 text-sm capitalize', selected === m.key ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground')}>
          {m.label}
        </button>
      ))}
    </div>
  )
}
```

`components/competition/grouping-filter.tsx`:

```tsx
'use client'

import { cn } from '@/lib/utils'
import type { GroupingAvailability } from '@/lib/competition/types'

export function GroupingFilter({
  groupings, selected, onSelect,
}: { groupings: Extract<GroupingAvailability, { kind: 'multi' }>; selected: string; onSelect: (g: string) => void }) {
  if (groupings.kind !== 'multi') return null
  const options = [{ key: 'all', label: 'All' }, ...groupings.groupings]
  return (
    <div className="inline-flex flex-wrap gap-1.5">
      {options.map((g) => (
        <button key={g.key} type="button" onClick={() => onSelect(g.key)}
          className={cn('rounded-md border px-2.5 py-1 text-sm', selected === g.key ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground hover:text-foreground')}>
          {g.label}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/competition/occurrence-nav.tsx components/competition/scoring-toggle.tsx components/competition/grouping-filter.tsx
git commit -m "feat(competition): occurrence nav + scoring toggle + grouping filter"
```

---

### Task 24: Leaderboard + scorecard (one focused table)

**Files:**
- Create: `components/competition/scorecard.tsx` (port from `weekly-results-view.tsx`)
- Create: `components/competition/leaderboard.tsx`

- [ ] **Step 1: Port the Scorecard**

Copy the existing `Scorecard`, `PlayerRow`, `CompetitionTable`, `formatToPar`, `formatThru`, `formatPoints`, `toParClass`, `toParNarration` from `components/igc/weekly-results-view.tsx` into `components/competition/scorecard.tsx`, retyped to the generic `Scorecard`/`ResultEntry` from `@/lib/competition/types`. No behavior change — verbatim port. Re-export `ScorecardRow` for the leaderboard.

- [ ] **Step 2: Implement the leaderboard**

`components/competition/leaderboard.tsx` — one table for the selected scoring mode + grouping, expandable scorecards. Receives only generic types (`Leaderboard`).

```tsx
'use client'

import { useState } from 'react'
import type { Leaderboard } from '@/lib/competition/types'
import { ScorecardRow } from './scorecard'

export function Leaderboard({ leaderboard }: { leaderboard: Leaderboard }) {
  const [expanded, setExpanded] = useState<string | null>(null)
  if (leaderboard.entries.length === 0) {
    return <p className="text-sm text-muted-foreground">No results available for this round.</p>
  }
  return (
    <div className="overflow-hidden rounded-md border border-border">
      {/* header + rows — port the grid layout from weekly-results-view CompetitionTable, */}
      {/* retyped to generic ResultEntry/Scorecard. Expandable ScorecardRow. */}
      <div className="divide-y divide-border">
        {leaderboard.entries.map((e) => {
          const card = leaderboard.scorecards.find((c) => c.key === e.key) ?? null
          const key = `${leaderboard.scoringMode}|${e.key}`
          return <ScorecardRow key={key} entry={e} card={card} live={leaderboard.resultStatus === 'live'} isOpen={expanded === key} onToggle={() => setExpanded((c) => (c === key ? null : key))} />
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/competition/scorecard.tsx components/competition/leaderboard.tsx
git commit -m "feat(competition): single focused leaderboard + expandable scorecard"
```

---

### Task 25: Polling decision (pure) + live polling hook — TDD

Resolves plan issue #11: the hook uses a **pure `nextPollDecision`** (unit-tested with fake timers), recursive `setTimeout` so interval changes never stack stale timers, includes `scoring` in the poll URL/refresh deps, defines scoring-mode-change behavior, does an immediate refresh on tab-visible then resumes, and preserves data during refresh (no skeleton flashing). Covers spec tests #7, #8, #9.

**Files:**
- Create: `components/competition/next-poll-decision.ts`
- Create: `tests/competition-next-poll.test.ts`
- Create: `components/competition/use-live-poll.ts`

- [ ] **Step 1: Write the failing tests for the pure decision**

`tests/competition-next-poll.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextPollDecision, type PollState } from '../lib/../components/competition/next-poll-decision.ts'

function st(over: Partial<PollState>): PollState {
  return {
    resultStatus: 'live',
    durableCurrent: false,
    finalSinceMs: null,
    nowMs: 0,
    supportsLive: true,
    visible: true,
    initialIsHistoricalFinal: false,
    ...over,
  }
}

const LIVE_POLL_MS = 60_000
const FINAL_POLL_MS = 5 * 60_000
const FINAL_POLL_BOUND_MS = 90 * 60_000

test('live + visible → poll at LIVE_POLL_MS', () => {
  const d = nextPollDecision(st({ resultStatus: 'live', visible: true, nowMs: 1000 }), { livePollMs: LIVE_POLL_MS, finalPollMs: FINAL_POLL_MS, finalPollBoundMs: FINAL_POLL_BOUND_MS })
  assert.equal(d.action, 'poll')
  assert.equal(d.delayMs, LIVE_POLL_MS)
})

test('final + not durable + within bound → poll at FINAL_POLL_MS', () => {
  const d = nextPollDecision(st({ resultStatus: 'final', durableCurrent: false, finalSinceMs: 1000, nowMs: 1000 + 60_000 }), { livePollMs: LIVE_POLL_MS, finalPollMs: FINAL_POLL_MS, finalPollBoundMs: FINAL_POLL_BOUND_MS })
  assert.equal(d.action, 'poll')
  assert.equal(d.delayMs, FINAL_POLL_MS)
})

test('final + durableCurrent → stop', () => {
  const d = nextPollDecision(st({ resultStatus: 'final', durableCurrent: true, finalSinceMs: 1000, nowMs: 9999 }), { livePollMs: LIVE_POLL_MS, finalPollMs: FINAL_POLL_MS, finalPollBoundMs: FINAL_POLL_BOUND_MS })
  assert.equal(d.action, 'stop')
})

test('final + bound exceeded → stop', () => {
  const d = nextPollDecision(st({ resultStatus: 'final', durableCurrent: false, finalSinceMs: 0, nowMs: FINAL_POLL_BOUND_MS + 1000 }), { livePollMs: LIVE_POLL_MS, finalPollMs: FINAL_POLL_MS, finalPollBoundMs: FINAL_POLL_BOUND_MS })
  assert.equal(d.action, 'stop')
})

test('historical final → stop (never poll)', () => {
  const d = nextPollDecision(st({ initialIsHistoricalFinal: true, resultStatus: 'final' }), { livePollMs: LIVE_POLL_MS, finalPollMs: FINAL_POLL_MS, finalPollBoundMs: FINAL_POLL_BOUND_MS })
  assert.equal(d.action, 'stop')
})

test('hidden tab → stop (no polling while hidden)', () => {
  const d = nextPollDecision(st({ visible: false, resultStatus: 'live' }), { livePollMs: LIVE_POLL_MS, finalPollMs: FINAL_POLL_MS, finalPollBoundMs: FINAL_POLL_BOUND_MS })
  assert.equal(d.action, 'stop')
})

test('unknown → stop', () => {
  const d = nextPollDecision(st({ resultStatus: 'unknown' }), { livePollMs: LIVE_POLL_MS, finalPollMs: FINAL_POLL_MS, finalPollBoundMs: FINAL_POLL_BOUND_MS })
  assert.equal(d.action, 'stop')
})
```

`tests/competition-request-order.test.ts` — pure request-generation ordering (Correction 8): a slower previous-mode response must NOT overwrite data from a newer mode. Responses are tagged with the generation (scoring/occurrence) they were issued for; only responses whose generation still equals the current generation are applied, regardless of arrival order.

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyResponse, type GenResponse } from '../components/competition/request-generation.ts'

test('a slower previous-generation response does not overwrite current data', () => {
  // gen 1 = old scoring (net), gen 2 = new scoring (gross). The old gen-1
  // response resolves AFTER the new gen-2 response (slow network). The current
  // generation is 2, so the gen-1 response is dropped — gross data is retained.
  let data: any = null
  data = applyResponse(data, { gen: 2, data: { scoring: 'gross' } }, 2)
  data = applyResponse(data, { gen: 1, data: { scoring: 'net' } }, 2)   // stale, arrives later
  assert.deepEqual(data, { scoring: 'gross' }, 'stale gen-1 response ignored')
})

test('only the last matching-generation response applies', () => {
  let data: any = null
  data = applyResponse(data, { gen: 1, data: 'a' }, 2)   // stale
  data = applyResponse(data, { gen: 2, data: 'b' }, 2)   // current
  data = applyResponse(data, { gen: 2, data: 'c' }, 2)   // current, newer
  assert.equal(data, 'c', 'last matching-gen response wins')
})

test('non-matching generation leaves data untouched (retain leaderboard while new mode loads)', () => {
  let data: any = { scoring: 'gross' }
  data = applyResponse(data, { gen: 1, data: { scoring: 'net' } }, 2)
  assert.deepEqual(data, { scoring: 'gross' }, 'previous-mode data retained until new-mode response arrives')
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/competition-next-poll.test.ts tests/competition-request-order.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the pure decision + request-generation**

`components/competition/next-poll-decision.ts`:

```ts
// Pure polling state machine. The hook calls this each time its inputs change
// and uses the result to schedule (or cancel) the next recursive setTimeout.
// Recursive setTimeout (not setInterval) means an interval change never stacks
// a stale timer — the next decision re-evaluates from the current state.
// See design spec §8 + plan issue #11.

export type ResultStatusLite = 'live' | 'final' | 'not_started' | 'unknown'

export interface PollState {
  resultStatus: ResultStatusLite
  durableCurrent: boolean
  finalSinceMs: number | null    // ms timestamp when live→final first observed
  nowMs: number
  supportsLive: boolean
  visible: boolean
  initialIsHistoricalFinal: boolean
}

export interface PollConfig {
  livePollMs: number
  finalPollMs: number
  finalPollBoundMs: number
}

export type PollAction = { action: 'poll'; delayMs: number } | { action: 'stop' }

export function nextPollDecision(s: PollState, cfg: PollConfig): PollAction {
  if (!s.supportsLive || s.initialIsHistoricalFinal || !s.visible) return { action: 'stop' }
  if (s.resultStatus === 'live') return { action: 'poll', delayMs: cfg.livePollMs }
  if (s.resultStatus === 'final') {
    if (s.durableCurrent) return { action: 'stop' }
    const since = s.finalSinceMs ?? s.nowMs
    if (s.nowMs - since > cfg.finalPollBoundMs) return { action: 'stop' }
    return { action: 'poll', delayMs: cfg.finalPollMs }
  }
  return { action: 'stop' }
}
```

`components/competition/request-generation.ts`:

```ts
// Pure request-generation ordering (Correction 8). When the user switches
// scoring mode (or occurrence), an in-flight fetch for the OLD mode may resolve
// AFTER the new mode's fetch. Tagging each response with the generation it was
// issued for — and only applying it when that generation still equals the
// current generation — prevents a slower previous-mode response from
// overwriting the new mode's data. The leaderboard is retained while the new
// mode loads; it is replaced only by a matching-generation response.
//
// This is a pure function so the ordering invariant is unit-testable without
// React or timers.

export interface GenResponse<T = unknown> {
  gen: number          // generation the request was issued for
  data: T
}

export function applyResponse<T>(current: T | null, res: GenResponse<T>, currentGen: number): T | null {
  if (res.gen !== currentGen) return current      // stale generation → retain current data
  return res.data
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/competition-next-poll.test.ts tests/competition-request-order.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Implement the hook**

`components/competition/use-live-poll.ts` — uses `nextPollDecision` + recursive `setTimeout`; includes `scoring` in the poll URL + refresh deps; on tab-visible, fires an immediate refresh then resumes; preserves `data` during refresh (only the initial load with no usable result shows a skeleton, handled by the caller). Per Correction 8:

- **`await refresh()` before `schedule()`** — the recursive `setTimeout` callback awaits the refresh and passes the fresh `LiveResponse` to `schedule()`, so the next poll decision reads the post-refresh status instead of the pre-refresh status.
- **request-generation token** — every scoring/occurrence change bumps `genRef.current`; each `refresh` captures its generation and only applies its result (via `applyResponse`) when the generation still matches, so a slower previous-mode response cannot overwrite the current mode's data. The leaderboard is retained while the new mode loads.

```ts
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { LiveResponse, ScoringMode } from '@/lib/competition/types'
import { nextPollDecision } from './next-poll-decision'
import { applyResponse } from './request-generation'

const LIVE_POLL_MS = 60_000
const FINAL_POLL_MS = 5 * 60_000
const FINAL_POLL_BOUND_MS = 90 * 60_000

export function useLivePoll({
  initial, pollUrl, scoring, supportsLive, initialIsHistoricalFinal,
}: {
  initial: LiveResponse | null
  pollUrl: string | null
  scoring: ScoringMode
  supportsLive: boolean
  initialIsHistoricalFinal: boolean
}) {
  const [data, setData] = useState<LiveResponse | null>(initial)
  const [refreshing, setRefreshing] = useState(false)
  const [showingLastKnown, setShowingLastKnown] = useState(false)
  const finalSinceRef = useRef<number | null>(null)
  const dataRef = useRef(data)
  dataRef.current = data
  // Request-generation token: bumped on every scoring/occurrence change so
  // in-flight fetches for a previous mode are ignored (Correction 8).
  const genRef = useRef(0)

  // scoring is part of the poll URL so a scoring-mode change fetches the right
  // competition; it is also in the refresh callback's deps.
  const urlWithScoring = pollUrl
    ? `${pollUrl}${pollUrl.includes('?') ? '&' : '?'}scoring=${encodeURIComponent(scoring)}`
    : null

  // Bump the generation + reset the final-since clock whenever the occurrence
  // or scoring changes — invalidating any in-flight previous-mode response.
  useEffect(() => {
    genRef.current += 1
    finalSinceRef.current = null
  }, [pollUrl, scoring])

  // refresh returns the fresh LiveResponse (or null) so the scheduler can
  // decide the next poll from post-refresh state. It applies its result only
  // when its captured generation still matches genRef.current.
  const refresh = useCallback(async (): Promise<LiveResponse | null> => {
    if (!urlWithScoring) return null
    const gen = genRef.current          // capture generation at issue time
    setRefreshing(true)
    try {
      const res = await fetch(urlWithScoring, { cache: 'no-store' })
      if (!res.ok) throw new Error(`refresh ${res.status}`)
      const json = (await res.json()) as { results?: LiveResponse }
      if (json.results && gen === genRef.current) {
        // applyResponse guards the generation again, but the gen check above
        // already ensures we only setData for the current generation.
        setData((cur) => applyResponse(cur, { gen, data: json.results! }, genRef.current))
        setShowingLastKnown(false)
        return json.results
      }
      return null
    } catch {
      // stale-while-error: keep last good data mounted (dataRef) and flag it.
      if (gen === genRef.current) setShowingLastKnown(true)
      return null
    } finally {
      if (gen === genRef.current) setRefreshing(false)
    }
  }, [urlWithScoring])

  useEffect(() => {
    if (!supportsLive || !urlWithScoring || initialIsHistoricalFinal) return

    let timer: ReturnType<typeof setTimeout> | null = null
    let cancelled = false

    const onVis = () => {
      if (cancelled) return
      if (!document.hidden) {
        // Tab became visible: immediate refresh, then re-schedule from the
        // fresh response (awaited) so the decision uses post-refresh state.
        void refresh().then(() => { if (!cancelled) schedule() }).catch(() => {})
      }
      schedule()
    }

    // schedule accepts the freshest LiveResponse (from the just-awaited
    // refresh) so the next decision reads post-refresh status, not the
    // pre-refresh dataRef snapshot (Correction 8).
    const schedule = (fresh?: LiveResponse | null) => {
      if (timer) { clearTimeout(timer); timer = null }
      const d = fresh ?? dataRef.current
      const status = d?.resultStatus ?? 'unknown'
      if (status === 'final' && finalSinceRef.current === null) finalSinceRef.current = Date.now()
      const decision = nextPollDecision(
        {
          resultStatus: status,
          durableCurrent: d?.leaderboard?.durableCurrent ?? false,
          finalSinceMs: finalSinceRef.current,
          nowMs: Date.now(),
          supportsLive,
          visible: !document.hidden,
          initialIsHistoricalFinal,
        },
        { livePollMs: LIVE_POLL_MS, finalPollMs: FINAL_POLL_MS, finalPollBoundMs: FINAL_POLL_BOUND_MS },
      )
      if (decision.action === 'poll') {
        timer = setTimeout(async () => {
          // await refresh() BEFORE schedule() so the next decision uses the
          // post-refresh response, not the pre-refresh state.
          const r = await refresh().catch(() => null)
          if (cancelled) return
          schedule(r)
        }, decision.delayMs)
      }
    }

    schedule()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVis)
    }
    // Re-schedule when scoring or occurrence changes (pollUrl). `data` is read
    // via dataRef so it doesn't need to be a dep. The generation bump effect
    // invalidates any in-flight previous-mode response.
  }, [supportsLive, urlWithScoring, refresh, initialIsHistoricalFinal, scoring, pollUrl])

  return { data, refreshing, showingLastKnown, refresh }
}
```

> **Note:** `Date.now()` is fine in a client hook (it's banned only in Workflow scripts). The bound is per-mounted-session; a historical-final occurrence never polls.

- [ ] **Step 6: Lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add components/competition/next-poll-decision.ts components/competition/request-generation.ts components/competition/use-live-poll.ts tests/competition-next-poll.test.ts tests/competition-request-order.test.ts
git commit -m "feat(competition): pure polling decision + request-generation token + bounded live→final hook"
```

---

### Task 26A: Server view-model builder (pure) — TDD

Resolves plan issue #16 (split Task 23) and #17 (pure view-model + polling-decision logic tested; component tests scoped out). The view-model builder is a pure function: it takes the competition's occurrences, capabilities inputs, URL state, and scoring prefs, and returns the plain serializable props the client shell renders from. No React, no DB.

**Files:**
- Create: `components/competition/standings-view-model.ts`
- Create: `tests/competition-view-model.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/competition-view-model.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildStandingsViewModel, type ViewModelInput } from '../components/competition/standings-view-model.ts'

function base(over: Partial<ViewModelInput>): ViewModelInput {
  return {
    competitionKey: 'mens-league',
    occurrences: [{ id: '18', number: 18, label: 'Week 18', date: '2026-07-28', activeWindow: { start: '', end: null }, format: 'individual', discoveryState: 'discovered', resultStatus: 'live' }],
    selectedOccurrenceId: '18',
    urlState: { view: 'weekly', scoring: null, grouping: null },
    availableScoringModes: ['gross', 'net'],
    storedScoring: null,
    availableGroupings: { kind: 'none' },
    resultStatus: 'live',
    liveGroupingPolicy: 'hide-until-final',
    configViews: ['season', 'weekly'],
    supportsLiveResults: true,
    supportsEventNavigation: true,
    ...over,
  }
}

test('resolves scoring from URL > stored > default, validated against available', () => {
  const vm = buildStandingsViewModel(base({ urlState: { view: 'weekly', scoring: 'gross', grouping: null }, availableScoringModes: ['gross', 'net'], storedScoring: 'net' }))
  assert.equal(vm.scoring, 'gross')
})

test('falls back to stored pref when URL absent', () => {
  const vm = buildStandingsViewModel(base({ urlState: { view: 'weekly', scoring: null, grouping: null }, storedScoring: 'net' }))
  assert.equal(vm.scoring, 'net')
})

test('men\'s live + hide-until-final → groupings none', () => {
  const vm = buildStandingsViewModel(base({ resultStatus: 'live', availableGroupings: { kind: 'multi', groupings: [{ key: 'A', label: 'Flight A' }], defaultAll: true } }))
  assert.equal(vm.capabilities.groupings.kind, 'none')
})

test('men\'s final → groupings multi', () => {
  const vm = buildStandingsViewModel(base({ resultStatus: 'final', availableGroupings: { kind: 'multi', groupings: [{ key: 'A', label: 'Flight A' }], defaultAll: true } }))
  assert.equal(vm.capabilities.groupings.kind, 'multi')
})

test('women\'s single view → tabs hidden (views length 1)', () => {
  const vm = buildStandingsViewModel(base({ configViews: ['weekly'], resultStatus: 'live', availableGroupings: { kind: 'single', grouping: { key: 'overall', label: 'Overall' } } }))
  assert.equal(vm.capabilities.views.length, 1)
  assert.equal(vm.capabilities.groupings.kind, 'single')
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/competition-view-model.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`components/competition/standings-view-model.ts`:

```ts
// Pure server view-model builder. Produces the plain serializable props the
// client shell renders from. Resolves scoring (URL > stored > default,
// validated), derives capabilities (config-driven grouping policy), and
// normalizes URL state. No React, no DB. See plan issue #16/#17.
//
// Note: this module is imported by a server component, but it is pure logic
// and unit-tested with node --test. Keep it free of React imports.

import { deriveOccurrenceCapabilities } from '@/lib/competition/capabilities'
import { resolveScoring, scoringKey, type ScoringStorage } from '@/lib/competition/scoring-prefs'
import type {
  GroupingAvailability, LiveGroupingPolicy, Occurrence, ResultStatus, ScoringMode, View,
} from '@/lib/competition/types'

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

  const view: View = input.urlState.view ?? input.configViews[0] ?? 'weekly'
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
```

> **Note for the implementer:** the import paths use `@/lib/...` (app alias) in the module since it runs under the Next build, but the unit test imports the module via a relative path. Node 24 strips TS types but does not resolve `@/` aliases — so for the test to run, either (a) make the test import the pure helpers directly and re-derive, or (b) add a small `tsconfig`-style path mapper. The cleanest option: the test exercises `buildStandingsViewModel` by importing it relatively AND the module imports its deps relatively too (no `@/` inside this pure module). **Use relative imports (`../../lib/competition/...`) inside `standings-view-model.ts`** so `node --test` can load it. Update the lint config if needed; the rest of the app keeps `@/`.

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/competition-view-model.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add components/competition/standings-view-model.ts tests/competition-view-model.test.ts
git commit -m "feat(competition): pure server view-model builder"
```

---

### Task 26B: URL/query-state normalization (pure) — TDD

**Files:**
- Create: `components/competition/url-state.ts`
- Create: `tests/competition-url-state.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/competition-url-state.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeUrlState } from '../components/competition/url-state.ts'

test('parses view/occurrence/scoring/grouping from search params', () => {
  const s = new URLSearchParams('view=weekly&week=18&scoring=gross&grouping=A')
  const r = normalizeUrlState(s, { occurrenceParam: 'week', allowedViews: ['season', 'weekly'], allowedScoring: ['gross', 'net'] })
  assert.deepEqual(r, { view: 'weekly', occurrenceId: '18', scoring: 'gross', grouping: 'A' })
})

test('drops unknown view/scoring values (returns null for them)', () => {
  const s = new URLSearchParams('view=bogus&scoring=stableford')
  const r = normalizeUrlState(s, { occurrenceParam: 'week', allowedViews: ['season', 'weekly'], allowedScoring: ['gross', 'net'] })
  assert.equal(r.view, null)
  assert.equal(r.scoring, null)
})

test('occurrence absent → null', () => {
  const r = normalizeUrlState(new URLSearchParams(''), { occurrenceParam: 'week', allowedViews: ['weekly'], allowedScoring: ['gross', 'net'] })
  assert.equal(r.occurrenceId, null)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/competition-url-state.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`components/competition/url-state.ts`:

```ts
// Pure URL/query-state normalization. No Next imports — operates on
// URLSearchParams so it's unit-testable. Relative imports only (no @/ alias)
// so node --test can load it.

import type { ScoringMode, View } from '../lib/competition/types'

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
}

export function normalizeUrlState(params: URLSearchParams, opts: NormalizeUrlStateOptions): NormalizedUrlState {
  const rawView = params.get('view')
  const view: View | null = rawView && opts.allowedViews.includes(rawView) ? (rawView as View) : null
  const occurrenceId = params.get(opts.occurrenceParam)
  const rawScoring = params.get('scoring')
  const scoring: ScoringMode | null = rawScoring && opts.allowedScoring.includes(rawScoring as ScoringMode) ? (rawScoring as ScoringMode) : null
  const grouping = params.get('grouping')
  return { view, occurrenceId, scoring, grouping }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/competition-url-state.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add components/competition/url-state.ts tests/competition-url-state.test.ts
git commit -m "feat(competition): pure URL state normalization"
```

---

### Task 26C: Client control state + navigation (client shell wiring)

The client shell manages `view`/`scoring`/`grouping` state, calls `useLivePoll`, and renders the controls from Tasks 22–24 using the view-model from 26A. URL is the source of truth; scoring is also persisted to namespaced localStorage on change.

**Files:**
- Create: `components/competition/standings-workspace.tsx` (client)

- [ ] **Step 1: Implement the client shell**

`components/competition/standings-workspace.tsx` — receives only plain data + `OccurrenceCapabilities` + initial `LiveResponse` + `pollUrl`. Renders tabs if `capabilities.views.length > 1`, occurrence nav if `supportsEventNavigation`, scoring toggle if `scoring.modes.length > 1`, grouping filter if `groupings.kind === 'multi'`. Uses `useLivePoll`. Skeleton only on initial load when no usable result; subtle `RefreshingIndicator` on background refresh. URL via `useRouter`/`useSearchParams`; scoring pref via `writeScoringPref` against `window.localStorage`.

```tsx
'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import type { LiveResponse, OccurrenceCapabilities } from '@/lib/competition/types'
import { writeScoringPref } from '@/lib/competition/scoring-prefs'
import { OccurrenceNav } from './occurrence-nav'
import { ScoringToggle } from './scoring-toggle'
import { GroupingFilter } from './grouping-filter'
import { Leaderboard } from './leaderboard'
import { StatusBadge } from './status-badge'
import { LoadingSkeleton, UnavailableState, TeamEventState, RefreshingIndicator } from './states'
import { useLivePoll } from './use-live-poll'

export interface StandingsWorkspaceProps {
  competitionKey: string
  occurrences: { id: string; label: string }[]
  selectedOccurrenceId: string | null
  queryParam: string
  view: string
  scoring: string
  grouping: string | null
  capabilities: OccurrenceCapabilities
  initial: LiveResponse | null
  pollUrl: string | null
  initialIsHistoricalFinal: boolean
}

export function StandingsWorkspace(props: StandingsWorkspaceProps) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [grouping, setGrouping] = useState<string | null>(props.grouping)

  const { data, refreshing, showingLastKnown, refresh } = useLivePoll({
    initial: props.initial,
    pollUrl: props.pollUrl,
    scoring: props.scoring as 'gross' | 'net',
    supportsLive: props.capabilities.supportsLiveResults,
    initialIsHistoricalFinal: props.initialIsHistoricalFinal,
  })

  const navigate = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(updates)) v == null ? next.delete(k) : next.set(k, v)
    router.replace(`${pathname}?${next.toString()}`, { scroll: false })
  }

  const onSelectScoring = (m: string) => {
    writeScoringPref(props.competitionKey, m as never, window.localStorage)
    navigate({ scoring: m })
  }

  const lb = data?.leaderboard ?? null
  const isInitialEmpty = !props.initial?.leaderboard && !props.initial
  const eventFormat = data?.eventFormat ?? props.initial?.eventFormat ?? 'unknown'
  const discoveryState = data?.discoveryState ?? props.initial?.discoveryState ?? 'pending'

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {props.capabilities.views.length > 1 && (
          <div className="inline-flex rounded-md border border-border p-0.5">
            {props.capabilities.views.map((v) => (
              <button key={v} type="button" onClick={() => navigate({ view: v })}
                className={`rounded px-3 py-1 text-sm capitalize ${props.view === v ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'}`}>{v}</button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <StatusBadge status={data?.resultStatus ?? props.initial?.resultStatus ?? 'unknown'} />
          <RefreshingIndicator refreshing={refreshing} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {props.capabilities.supportsEventNavigation && (
          <OccurrenceNav occurrences={props.occurrences} selectedId={props.selectedOccurrenceId} queryParam={props.queryParam} />
        )}
        <ScoringToggle
          modes={props.capabilities.scoring.modes.map((m) => ({ key: m, label: m }))}
          selected={props.scoring}
          onSelect={onSelectScoring}
        />
      </div>

      {props.capabilities.groupings.kind === 'multi' && (
        <GroupingFilter
          groupings={props.capabilities.groupings}
          selected={grouping ?? 'all'}
          onSelect={setGrouping}
        />
      )}

      {isInitialEmpty && refreshing ? (
        <LoadingSkeleton />
      ) : eventFormat === 'team' && discoveryState === 'discovered' ? (
        <TeamEventState label={props.occurrences.find((o) => o.id === props.selectedOccurrenceId)?.label ?? ''} />
      ) : lb ? (
        <Leaderboard leaderboard={lb} />
      ) : showingLastKnown ? (
        <UnavailableState message="Live results are temporarily unavailable. Showing the last known standings." onRetry={() => void refresh()} retrying={refreshing} />
      ) : (
        <UnavailableState message="Results aren&apos;t available for this round yet." onRetry={() => void refresh()} retrying={refreshing} />
      )}
    </section>
  )
}
```

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/competition/standings-workspace.tsx
git commit -m "feat(competition): client standings workspace shell"
```

---

### Task 26D: Weekly/live workspace + 26E: Season Points view + 26F: League route integration

These three sub-tasks complete the shell: 26D wires the weekly/live view, 26E renders the Season Points table inside the new shared shell, and 26F integrates both league routes.

**Files:**
- Create: `components/competition/standings-workspace-server.tsx` (server: resolves config + initial data + view model)
- Create: `components/competition/season-points-view.tsx`
- Modify: `components/igc/league-standings-view.tsx` (thin wrapper)
- Modify: `app/igc/mens-league/page.tsx`, `app/igc/womens-league/page.tsx`

- [ ] **Step 1: Implement the server wrapper (26A+26B applied server-side) — 26D**

`components/competition/standings-workspace-server.tsx` — async server component: takes `competitionKey`, reads URL search params, resolves the config from the registry, fetches occurrences + the selected occurrence's initial results (live via `getLiveResults`, or from DB for historical final), builds the view model via `buildStandingsViewModel` + `normalizeUrlState`, computes the `pollUrl`, and renders `<StandingsWorkspace>` with plain props only. No `CompetitionConfig` object is passed to the client.

```tsx
import { headers } from 'next/headers'

import { getCompetitionConfig } from '@/lib/competition/registry'
import { getLiveResults } from '@/lib/competition/live'
import { buildStandingsViewModel } from './standings-view-model'
import { normalizeUrlState } from './url-state'
import { StandingsWorkspace } from './standings-workspace'
import type { Occurrence } from '@/lib/competition/types'

export async function StandingsWorkspaceServer({
  competitionKey, searchParams,
}: {
  competitionKey: string
  searchParams: Record<string, string | string[] | undefined>
}) {
  const config = getCompetitionConfig(competitionKey)
  if (!config) return <p className="text-sm text-muted-foreground">Unknown competition.</p>

  // Fetch occurrences (server wrapper queries igc_league_events + results to
  // build generic Occurrence[] and availableGroupings). Implementation port:
  // reuse lib/igc/league.ts getLeagueEvents/getLeagueWeeksWithResults, mapped
  // through adapters/golfgenius/mapping.ts mapLeagueEventToOccurrence. (26D)
  const occurrences: Occurrence[] = await resolveOccurrences(competitionKey)   // see note below

  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(searchParams)) if (typeof v === 'string') params.set(k, v)
  const urlState = normalizeUrlState(params, {
    occurrenceParam: config.navigation.queryParam,
    allowedViews: config.capabilities.views,
    allowedScoring: config.capabilities.scoring.modes as ('gross' | 'net')[],
  })

  const selectedId = urlState.occurrenceId ?? occurrences[0]?.id ?? null
  const selected = occurrences.find((o) => o.id === selectedId) ?? null
  const initialIsHistoricalFinal = selected?.resultStatus === 'final'

  const nowIso = new Date().toISOString()
  const initial = selected && config.capabilities.supportsLiveResults && !initialIsHistoricalFinal
    ? await getLiveResults({ competitionKey, occurrenceId: selected.id, scoring: urlState.scoring ?? config.capabilities.scoring.modes[0] ?? 'net', nowIso })
    : selected ? await buildHistoricalLiveResponse(competitionKey, selected, urlState.scoring ?? 'net') : null

  const vm = buildStandingsViewModel({
    competitionKey,
    occurrences,
    selectedOccurrenceId: selectedId,
    urlState: { view: urlState.view, scoring: urlState.scoring, grouping: urlState.grouping },
    availableScoringModes: config.capabilities.scoring.modes as ('gross' | 'net')[],
    storedScoring: null,   // server has no localStorage; client resolves stored pref on mount
    availableGroupings: await resolveAvailableGroupings(competitionKey, selectedId),
    resultStatus: selected?.resultStatus ?? 'unknown',
    liveGroupingPolicy: config.liveGroupingPolicy,
    configViews: config.capabilities.views,
    supportsLiveResults: config.capabilities.supportsLiveResults,
    supportsEventNavigation: config.capabilities.supportsEventNavigation,
  })

  const pollUrl = config.capabilities.supportsLiveResults && !initialIsHistoricalFinal
    ? `/api/competition/live?competition=${encodeURIComponent(competitionKey)}&occurrence=${encodeURIComponent(selectedId ?? '')}`
    : null

  // Season Points view (26E): for competitions whose views include 'season'
  // and the selected view is 'season', render <SeasonPointsView> instead of the
  // weekly/live workspace. The shell switches on vm.view.
  if (vm.view === 'season' && config.capabilities.views.includes('season')) {
    const rows = await resolveSeasonPoints(competitionKey)   // server: read igc_league_season_points
    return <SeasonPointsView competitionKey={competitionKey} occurrences={vm.occurrences} selectedOccurrenceId={selectedId} queryParam={config.navigation.queryParam} rows={rows} />
  }

  return (
    <StandingsWorkspace
      competitionKey={competitionKey}
      occurrences={vm.occurrences}
      selectedOccurrenceId={vm.selectedOccurrenceId}
      queryParam={config.navigation.queryParam}
      view={vm.view}
      scoring={vm.scoring}
      grouping={vm.grouping}
      capabilities={vm.capabilities}
      initial={initial}
      pollUrl={pollUrl}
      initialIsHistoricalFinal={initialIsHistoricalFinal}
    />
  )
}
```

> **Note for the implementer:** `resolveOccurrences`, `buildHistoricalLiveResponse`, `resolveAvailableGroupings`, and `resolveSeasonPoints` are thin server-side readers that port the existing `lib/igc/league.ts` queries through `adapters/golfgenius/mapping.ts`. They return generic types only. Implement them in this file (or a small `lib/competition/adapters/golfgenius/server-readers.ts`) using the service/server client. They are not unit-tested here (they're I/O); the pure mapping they call is already tested in Task 15.

- [ ] **Step 2: Implement the Season Points view — 26E**

`components/competition/season-points-view.tsx` — renders the cumulative season-points table inside the shared shell's navigation/controls. It reuses `OccurrenceNav` for week navigation and the `StatusBadge`/`RefreshingIndicator` primitives. Receives only generic `SeasonPointsRow[]`.

```tsx
import type { SeasonPointsRow } from '@/lib/competition/reconcile/season-points'
import { OccurrenceNav } from './occurrence-nav'

export function SeasonPointsView({
  competitionKey, occurrences, selectedOccurrenceId, queryParam, rows,
}: {
  competitionKey: string
  occurrences: { id: string; label: string }[]
  selectedOccurrenceId: string | null
  queryParam: string
  rows: SeasonPointsRow[]
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <OccurrenceNav occurrences={occurrences} selectedId={selectedOccurrenceId} queryParam={queryParam} />
      </div>
      <div className="overflow-hidden rounded-md border border-border">
        <div className="grid grid-cols-[3rem_1fr_5rem_5rem_5rem] gap-2 border-b border-border bg-muted/30 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <div>Pos</div><div>Player</div><div>Points</div><div>Prev</div><div>Played</div>
        </div>
        <div className="divide-y divide-border">
          {rows.map((r) => (
            <div key={r.member_card_id} className="grid grid-cols-[3rem_1fr_5rem_5rem_5rem] gap-2 px-3 py-2 text-sm">
              <div className="font-medium">{r.position}</div>
              <div>{r.player_name ?? r.member_card_id}</div>
              <div>{r.total_points.toFixed(2)}</div>
              <div className="text-muted-foreground">{r.previous_position ?? '—'}</div>
              <div className="text-muted-foreground">{/* events_played if available */}</div>
            </div>
          ))}
          {rows.length === 0 && <div className="px-3 py-4 text-sm text-muted-foreground">No season standings yet.</div>}
        </div>
      </div>
    </section>
  )
}
```

> **Note for the implementer:** extend `SeasonPointsRow` with `events_played`/`wins`/`points_behind` if the server reader supplies them (the existing `igc_league_season_points` columns have them); add the columns to the grid. Keep the component generic — no `igc_league_*` field names.

- [ ] **Step 3: Rewrite the league standings view as a thin wrapper — 26F**

`components/igc/league-standings-view.tsx` — replace the body with:

```tsx
import { StandingsWorkspaceServer } from '@/components/competition/standings-workspace-server'

export async function LeagueStandingsView({
  leagueKey, searchParams,
}: {
  leagueKey: 'mens' | 'womens'
  searchParams: Record<string, string | string[] | undefined>
}) {
  const competitionKey = leagueKey === 'mens' ? 'mens-league' : 'womens-league'
  return <StandingsWorkspaceServer competitionKey={competitionKey} searchParams={searchParams} />
}
```

- [ ] **Step 4: Page routes forward widened search params — 26F**

`app/igc/mens-league/page.tsx` and `app/igc/womens-league/page.tsx` — widen the `searchParams` type to `Promise<{ week?: string; view?: string; scoring?: string; grouping?: string }>` (Next 16 async searchParams), await it, and forward to `<LeagueStandingsView ... searchParams={sp} />`.

- [ ] **Step 5: Lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add components/competition/standings-workspace-server.tsx components/competition/season-points-view.tsx components/igc/league-standings-view.tsx app/igc/mens-league/page.tsx app/igc/womens-league/page.tsx
git commit -m "feat(competition): server wrapper + season points view + league route integration"
```

---

## Phase 6 — Verification & Rollout

### Task 27: Playwright smoke tests

**Files:**
- Modify: `tests/smoke.spec.ts`

- [ ] **Step 1: Add standings smoke assertions**

Extend `tests/smoke.spec.ts` with two tests (guarded by the existing dev-server setup):

- **Men's standings** (`/igc/mens-league`): tab bar present (Season + Weekly/Live), occurrence dropdown navigates, Gross/Net toggle updates the table, LIVE or FINAL badge renders, no horizontal overflow on mobile viewport.
- **Women's standings** (`/igc/womens-league`): no tab bar, no grouping control, Gross/Net toggle present, occurrence nav present, no horizontal overflow on mobile viewport.

Use the existing Playwright helpers in the file. Assert element presence/absence by test-id or text.

- [ ] **Step 2: Run smoke tests**

Run: `pnpm test:smoke`
Expected: PASS (new + existing).

- [ ] **Step 3: Commit**

```bash
git add tests/smoke.spec.ts
git commit -m "test(competition): men's/women's standings smoke tests"
```

---

### Task 28: Full unit + lint suite green

- [ ] **Step 1: Run everything**

```bash
pnpm lint
pnpm test:unit
```
Expected: lint clean; all unit tests pass (existing + new `competition-*`, `competition-cache-*`, `competition-live`, `competition-result-status`, `competition-durable-current`, `competition-discovery`, `competition-mapping`, `competition-gg-helpers`, `competition-import`, `competition-season-points`, `competition-reconcile-discover`, `competition-candidates`, `competition-reconcile`, `competition-next-poll`, `competition-view-model`, `competition-url-state`).

- [ ] **Step 2: Fix any failures, then commit**

```bash
git add -A
git commit -m "test(competition): full unit + lint suite green"
```

---

### Task 29: Rollout & verification (manual, documented)

- [ ] **Step 1: Deploy** the branch; confirm migrations 026/027 apply and the cron is registered in Vercel.

- [ ] **Step 2: Verify during the next Men's play window (Tuesday Pacific)**: open `/igc/mens-league`; current-week live results appear **without a manual sync** (config-driven discovery, no persisted-row dependency); Gross/Net toggles; unflighted Overall (groupings none while live); LIVE badge; subtle refresh on background polls (no skeleton flashing); upstream failure shows last-known with `showingLastKnown`.

- [ ] **Step 3: Verify after the next finalization**: within 24h, season points advance to the newly finalized week with no manual command (cron reconciles, upstream-status-gated import); flights appear and the grouping filter works; badge becomes FINAL and slow-polls briefly then stops at `durableCurrent`.

- [ ] **Step 4: Verify Women's** on its play day: live results appear, no tab bar, no grouping control, Gross/Net toggle present.

- [ ] **Step 5: Document results** in a short verification note appended to the spec file (or a PR description), including any deviations and follow-ups.

---

## Self-Review Notes

**Spec coverage:** every spec section maps to a task — §1 root causes (Tasks 4, 19B/C), §2 principles (Global Constraints), §3 event-state model (Tasks 2, 4), §4 live read path + active window + cache + compat handler (Tasks 5, 9, 13, 16, 17, 18), §5 durable reconcile + durable-current contract (Tasks 2, 11, 19A–19G, 20, 21), §6 generic domain (Tasks 3, 4–8, 10, 11), §7 cron (Task 20), §8 UX (Tasks 22–26F), §9 configs (Task 14), §10 file layout (matched), §11 migration/backfill (Tasks 2, 9, 15), §12 tests (Tasks 4–8, 10, 11, 12, 13, 15, 16, 17, 19A–19F, 21, 25, 26A, 26B, 27), §13 observability (Tasks 17, 20 logging), §14 rollout (Task 29), §15 out-of-scope (deferred generic tables — Task 15 note).

**Placeholder scan:** Tasks 19A (gg-helpers), 24 (scorecard), and 26D/F (server readers) reference existing code to port verbatim with explicit source locations — these are mechanical ports of already-working code, not unspecified work. Every NEW logic task has complete code + tests. The two "Note for the implementer" blocks (Tasks 11, 17, 19B, 19F, 26A, 26D) call out specific wiring details that depend on the existing codebase's exact column names/queries; they are concrete instructions, not placeholders.

**Type consistency:** canonical signatures are locked and used consistently across tasks:
- `classifyEventFormat({ tournaments: DiscoveredTournament[]; teamOverride: boolean }): ClassifyResult` — Tasks 4, 13, 19D.
- `deriveResultStatus(input: ResultStatusInput): ResultStatus` — Tasks 10, 17.
- `isDurableCurrent(src: DurableCurrentSource): boolean` — Tasks 11, 17.
- `deriveOccurrenceCapabilities(input: CapabilityInput): OccurrenceCapabilities` — Tasks 6, 26A.
- `resultsCacheKey({ tenantKey, competitionKey, occurrenceId, scoring })` — Tasks 8, 16, 17 (via structured API).
- `readCachedResult/readStaleResult/writeCachedResult(args: { tenantKey, competitionKey, occurrenceId, scoring }, ...)` — Tasks 16, 17.
- `discoverOccurrence(input: DiscoverInput): Promise<DiscoverResult>` — Tasks 13, 17, 19D.
- `getLiveResults({ competitionKey, occurrenceId, scoring, nowIso, deps? }): Promise<LiveResponse>` — Tasks 17, 18.
- `importOccurrence(input: ImportInput): Promise<ImportSummary>` — Tasks 19B, 19F.
- `rebuildSeasonPoints(input: RebuildInput): Promise<SeasonPointsRow[]>` — Tasks 19C, 19F.
- `selectReconciliationCandidates(events, nowIso): Candidate[]` — Tasks 19E, 19F.
- `reconcileCompetition({ competitionKey, deadlineMs, nowIso, ops? }): Promise<ReconcileSummary>` and `reconcileAllCompetitions({ deadlineMs, nowIso, ops? })` (ONE shared deadline) — Tasks 19F, 20.
- `nextPollDecision(s: PollState, cfg: PollConfig): PollAction` — Task 25 (pure) → `useLivePoll`.
- `buildStandingsViewModel(input: ViewModelInput): StandingsViewModel` — Task 26A → 26D.
- `normalizeUrlState(params, opts): NormalizedUrlState` — Task 26B → 26D.
- `LiveResponse` carries `durableCurrent` (boolean, derived) + `showingLastKnown` (boolean) — Tasks 3, 16, 17, 25.

**Type-consistency fixes applied in this revision (issue #7):** `CapabilityInput.scoringModes` is now `ScoringMode[]` and `deriveOccurrenceCapabilities` constructs `scoring: { modes: input.scoringModes }` — consistent with `ScoringModeAvailability.modes` and with how the tests assert `c.scoring.modes`. `nameKind` is a separate pure function (not folded into classification) so names are hints only.

**Component/hook testing scope (issue #17):** pure logic is unit-tested — view-model (26A), URL state (26B), polling decision (25), result-status (10), durable-current (11), classification (4), capabilities (6), cache keys (8), cache single-flight + stale (16), discovery (13), live (17), gg-helpers (19A), import (19B), season-points (19C), reconcile-discover (19D), candidates (19E), reconcile orchestration (19F). React components (22, 23, 24, 26C, 26D, 26E) are **not** given unit tests — they are thin wiring over the tested pure logic and are covered by the Playwright smoke tests (Task 27). This is stated explicitly rather than calling the phase TDD.

**Scope:** one plan, six phases, ~29 numbered tasks (19 and 26 split into sub-tasks). Each task is independently testable. The phases are sequential dependencies, not independent subsystems, so a single plan is appropriate.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-31-standings-redesign.md`.**

This plan should be executed **Subagent-Driven** (per plan issue #18) with phase checkpoints — NOT as 29 unattended subagents. Recommended structure:

- **One persistent integration/reviewer agent** owns architecture, type contracts, and cross-task consistency. It reviews every task's diff against the canonical signatures in Self-Review Notes and rejects drift (e.g., a task that reintroduces `scoring: ScoringModeAvailability` instead of `scoringModes: ScoringMode[]`, or composes raw cache keys instead of using the structured API).
- **Fresh implementation subagent per small task** — each task is self-contained with its own test cycle.
- **Six phase checkpoints** (review between phases):
  1. **Phase 1 — Domain/type consistency + migrations:** all pure modules + migrations 026/027 green; confirm canonical signatures match this plan before any adapter code is written.
  2. **Phase 2 — Direct GG discovery without persisted rows:** discovery resolves from config; positive-evidence classification; no persisted-row dependency. Verify the three discovery tests (no row / row without gg_event_id / stale hints → fallback) pass.
  3. **Phase 3 — Live path end-to-end + cache failure modes:** `getLiveResults` produces live results with no persisted row; stale-while-error returns last-known on GG failure; result-status from upstream lifecycle; `durableCurrent` derived from the contract.
  4. **Phase 4 — Sync parity + Season Points delayed-finalization:** CLI parity with the existing sync (byte-identical rows); idempotent re-run; completed-round guard holds; delayed-finalization advances after the round flips to completed.
  5. **Phase 5 — Desktop/mobile UI + URL state:** men's tabs/toggle/filter/leaderboard; women's no-tab/no-filter; URL is source of truth; scoring pref namespaced; polling hook preserves data on refresh (no skeleton flashing).
  6. **Final — Full suite, migration review, preview deploy only:** `pnpm lint` + `pnpm test:unit` + smoke green; migrations reviewed for additive-only + RLS posture; **preview deploy only** (no production promotion until the manual play-window + post-finalization verification in Task 29 is observed).

**Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task with the persistent integration/reviewer agent gating each phase, as described above.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**

> Do not begin implementation until you confirm the approach. The plan above is the revised task list resolving all 18 critique issues; the per-issue resolutions are summarized in the response accompanying this file.