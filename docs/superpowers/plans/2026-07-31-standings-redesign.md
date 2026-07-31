# Standings Redesign + Reusable Competition Capability — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the two standings data bugs (live week absent, season points lagging one week) and rebuild the Standings page as a live, scoreboard-style experience on a reusable, capability-driven competition abstraction that Men's and Women's League configure (and Seattle Cup can later adopt).

**Architecture:** A generic `lib/competition/` domain (types, classification, active-window, capabilities, cache, reconcile) plus a Golf Genius adapter. A live read path (server-side GG discovery + coalesced cache) is separated from a durable reconciliation path (idempotent import + season-points rebuild, run by an hourly cron). Shared `components/competition/*` UI renders from capabilities + plain data only. Existing `igc_league_*` tables are reused; the adapter maps them onto the generic types. The overloaded `gg_tournament_id IS NULL` team-event signal is replaced by an explicit `event_format` / `discovery_state` model.

**Tech Stack:** Next.js 16 App Router (TypeScript), Supabase (PostgreSQL + RLS), Tailwind + shadcn/ui, Node 24 built-in test runner (`node --test`) for pure unit tests, Playwright for smoke tests, pnpm.

## Global Constraints

- **Package manager:** `pnpm` (required). Never use npm/yarn.
- **Unit tests:** pure logic only, run with `node --test tests/<file>.test.ts`. Node 24 strips TS types natively — use relative imports (no `@/` alias) in test files. No DB/network/auth in unit tests.
- **Migrations:** additive, filename-ordered in `supabase/migrations/`. Next number is `026`. Never drop/retype existing columns.
- **No league-schema leakage:** `components/competition/*` and `lib/competition/types.ts` import only generic domain types — never `igc_league_*` shapes, `league_key`, `week_number`, `flight_name`, or GG field names. All mapping lives in the adapter and server wrapper.
- **Server-only config:** `CompetitionConfig` (adapter ids, schedule, label rules) never crosses to client components. Client components receive only plain serializable data + capabilities.
- **No hardcoded league days in shared code:** Tuesday/Wednesday live only in league config `schedule` heuristics, never in `lib/competition/*` or `components/competition/*`.
- **A null external id is data absence, not a semantic classification.** Never infer `team` from `gg_tournament_id IS NULL` or from "no individual tournaments found."
- **Completed-round guard stays** for season points; reconciliation re-runs after finalization instead of dropping the guard.
- **Lint must pass:** `pnpm lint` (`eslint . --max-warnings 0`).
- **Commit each task.** End every task with a commit.

---

## File Structure

**New files — `lib/competition/` (generic, no league/GG leakage in types + capabilities + UI-facing):**

- `lib/competition/types.ts` — domain types (CompetitionConfig, Occurrence, capabilities, Leaderboard, etc.). Pure types, no imports.
- `lib/competition/classify.ts` — pure: `classifyEventFormat(tournaments, configOverride)` → EventFormat + DiscoveryState. Unit-tested.
- `lib/competition/active-window.ts` — pure: `isOccurrenceActive(window, nowIso, upstreamInProgress)`. Unit-tested.
- `lib/competition/capabilities.ts` — pure: `deriveOccurrenceCapabilities(config, occurrence)` → OccurrenceCapabilities. Unit-tested.
- `lib/competition/scoring-prefs.ts` — pure: `scoringKey(competitionKey)`, `readScoringPref(competitionKey, available)`, `writeScoringPref(competitionKey, mode)`. Unit-tested.
- `lib/competition/cache-keys.ts` — pure: `resultsCacheKey`, `discoveryCacheKey`. Unit-tested.
- `lib/competition/cache.ts` — DB-backed short-TTL cache + in-process single-flight. Uses `createServiceClient`.
- `lib/competition/live.ts` — `getLiveResults(config, occurrence)` shared live read function (discovery + results + cache).
- `lib/competition/configs/mens-league.ts` — Men's CompetitionConfig.
- `lib/competition/configs/womens-league.ts` — Women's CompetitionConfig.
- `lib/competition/registry.ts` — `getCompetitionConfig(key)`, `allCompetitionConfigs()`.
- `lib/competition/adapters/golfgenius/discovery.ts` — GG discovery: resolve parent event/round/tournaments, classify, normalize to generic types.
- `lib/competition/adapters/golfgenius/normalize.ts` — pure: parse GG tournament results payload → generic Leaderboard/Scorecard. Unit-tested with fixtures.
- `lib/competition/adapters/golfgenius/mapping.ts` — map `igc_league_*` DB rows ↔ generic Occurrence/Leaderboard. Server-only.
- `lib/competition/reconcile/discover.ts` — durable: classify + persist `event_format`/`discovery_state` for an occurrence.
- `lib/competition/reconcile/import.ts` — durable: import finalized performances + results (both competitions).
- `lib/competition/reconcile/season-points.ts` — durable: rebuild cumulative snapshot (completed-round guard kept).
- `lib/competition/reconcile/reconcile.ts` — `reconcileCompetition(config, budget)`, `reconcileAllCompetitions(budget)`.

**New files — `components/competition/`:**

- `standings-workspace.tsx` — server component shell: tabs (if >1 view), controls, table slot.
- `occurrence-nav.tsx` — client: prev/next + dropdown.
- `scoring-toggle.tsx` — client.
- `grouping-filter.tsx` — client.
- `leaderboard.tsx` — client: one table, scoring+grouping filtered.
- `scorecard.tsx` — client: expandable (reused from current `weekly-results-view.tsx` Scorecard).
- `status-badge.tsx` — client: LIVE / FINAL.
- `states.tsx` — client: loading skeleton, empty, error/unavailable, team-event.
- `use-live-poll.ts` — client hook: bounded live/post-final polling + subtle refresh state.

**New files — routes / tests:**

- `app/api/competition/live/route.ts` — generic live endpoint.
- `app/api/cron/reconcile/route.ts` — scheduled reconciliation.
- `supabase/migrations/026_igc_league_event_format.sql` — event_format/discovery_state/discovered_at + backfill.
- `supabase/migrations/027_competition_live_cache.sql` — cache table.
- `tests/competition-classify.test.ts`, `tests/competition-active-window.test.ts`, `tests/competition-capabilities.test.ts`, `tests/competition-scoring-prefs.test.ts`, `tests/competition-cache-keys.test.ts`, `tests/competition-normalize.test.ts`, `tests/competition-live-singleflight.test.ts`
- `tests/integration/reconcile-idempotent.mjs` (run against local Supabase)
- `scripts/sync-igc-league.mjs` — rewritten as thin CLI → `lib/competition/reconcile`.

**Modified files:**

- `app/api/igc/league/live/route.ts` — rewritten as compatibility handler calling `getLiveResults`.
- `components/igc/league-standings-view.tsx` — rewritten as thin server wrapper → `<StandingsWorkspace>`.
- `app/igc/mens-league/page.tsx`, `app/igc/womens-league/page.tsx` — pass competition key.
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

### Task 2: Migration 026 — explicit event format + discovery state

**Files:**
- Create: `supabase/migrations/026_igc_league_event_format.sql`

This is SQL, not TDD. Verify by running the migration locally and inspecting columns.

- [ ] **Step 1: Write the migration**

`supabase/migrations/026_igc_league_event_format.sql`:

```sql
-- Replace the overloaded `gg_tournament_id IS NULL` team-event signal with an
-- explicit, independently-stored event format and discovery state. A null
-- external id is data absence, not a semantic classification (see design spec
-- §3). Additive only: no existing column is dropped/retyped.

ALTER TABLE igc_league_events
    ADD COLUMN event_format TEXT NOT NULL DEFAULT 'unknown'
        CHECK (event_format IN ('individual', 'team', 'unknown')),
    ADD COLUMN discovery_state TEXT NOT NULL DEFAULT 'pending'
        CHECK (discovery_state IN ('pending', 'discovered', 'inconclusive', 'failed')),
    ADD COLUMN discovered_at TIMESTAMPTZ;

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

Run: `pnpm supabase` (start local Supabase), then apply the migration (the run-supabase script applies pending migrations). Verify columns exist:

```bash
node -e "import('./lib/supabase/service.ts').then(async m => { const s = m.createServiceClient(); const { data, error } = await s.from('igc_league_events').select('event_format, discovery_state').limit(1); console.log(error ?? data); })"
```
Expected: prints a row (or empty array) with no error — columns exist.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/026_igc_league_event_format.sql
git commit -m "feat(db): explicit event_format + discovery_state on igc_league_events"
```

---

### Task 3: Generic domain types

**Files:**
- Create: `lib/competition/types.ts`

Pure types — verified by `pnpm lint` + a typecheck. No unit test (types only).

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
  windowHours?: number             // how long after play scoring may remain live
}

// Declarative label rule the SERVER interprets to produce Occurrence.label.
// No functions cross the server/client boundary.
export type LabelRule =
  | { kind: 'numberPrefix'; noun: string }   // "Week 18"
  | { kind: 'event_name' }                    // use the upstream event name verbatim
  | { kind: 'composite'; noun: string; separator: string } // "Week 18 – Open Championship"

export interface NavigationOptions {
  occurrenceNoun: 'week' | 'session' | 'round' | 'stage' | string
  queryParam: string               // 'week' for league routes (bookmark compat)
  labelRule: LabelRule
}

export interface ScoringModeAvailability {
  modes: ScoringMode[]             // [] or [gross] → no toggle; [gross, net] → toggle
}

export interface Grouping {
  key: string                       // 'A' | 'B' | 'C' | 'overall'
  label: string                      // "Flight A" | "Overall"
}

export type GroupingAvailability =
  | { kind: 'none' }                // no meaningful grouping yet (live, groupings unknown)
  | { kind: 'single'; grouping: Grouping }   // one Overall field (women's)
  | { kind: 'multi'; groupings: Grouping[]; defaultAll: boolean }

export interface CompetitionCapabilities {
  views: View[]
  scoring: ScoringModeAvailability
  supportsLiveResults: boolean
  supportsEventNavigation: boolean
}

export interface OccurrenceCapabilities extends CompetitionCapabilities {
  groupings: GroupingAvailability   // 'none' while live; 'multi' once finalized (men's)
}

// Adapter config is opaque to shared code; only the adapter reads it.
// Carries GG ids + secrets — SERVER-ONLY, never sent to client components.
export interface GolfGeniusAdapterConfig {
  seasonId: string
  categoryId: string
  seasonPointsCategoryId?: string   // Men's only; absent → no season dataset
  eventFilter: string               // 'mens' | 'womens'
  teamFormatOverrides?: { weekNumber: number }[] // known scramble weeks (positive evidence)
}

export interface CompetitionConfig {
  key: string                       // 'mens-league' | 'womens-league' | 'seattle-cup'
  label: string
  adapter: 'golfgenius'
  adapterConfig: GolfGeniusAdapterConfig  // server-only
  navigation: NavigationOptions
  capabilities: CompetitionCapabilities
  schedule?: CompetitionSchedule
}

export interface ActiveWindow {
  start: string                     // ISO timestamp in competition tz
  end: string | null                 // null = open-ended (until upstream says final)
}

export interface Occurrence {
  id: string                         // stable within the competition
  number: number | null
  label: string                      // resolved server-side from labelRule
  date: string | null                // ISO date (competition tz)
  activeWindow: ActiveWindow
  format: EventFormat
  discoveryState: DiscoveryState
  resultStatus: ResultStatus
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
  isLive: boolean
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
  grouping: Grouping | null          // null = all players / Overall
  entries: ResultEntry[]
  scorecards: Scorecard[]            // deduped per participant
  resultStatus: ResultStatus
  durableCurrent: boolean            // true once durable reconciliation has captured final results
}

export interface LiveResponse {
  occurrence: Occurrence
  leaderboard: Leaderboard | null
  resultStatus: ResultStatus
  eventFormat: EventFormat
  discoveryState: DiscoveryState
  showingLastKnown: boolean
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm lint`
Expected: no errors (types compile; no unused).

- [ ] **Step 3: Commit**

```bash
git add lib/competition/types.ts
git commit -m "feat(competition): generic competition/result domain types"
```

---

### Task 4: Event-format classification (pure) — TDD

**Files:**
- Create: `lib/competition/classify.ts`
- Create: `tests/competition-classify.test.ts`

Covers spec tests #3 (confirmed team with positive evidence), #4 (inconclusive → not team), #5 (upcoming → pending), #6 (ambiguous → not team).

- [ ] **Step 1: Write the failing tests**

`tests/competition-classify.test.ts`:

```ts
// Pure unit tests for event-format classification. Run with:
//   node --test tests/competition-classify.test.ts
// Node 24 strips TS types; relative imports only.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyEventFormat,
  type DiscoveredTournament,
  type ClassifyInput,
} from '../lib/competition/classify.ts'

function mkT(over: Partial<DiscoveredTournament> = {}): DiscoveredTournament {
  return {
    id: over.id ?? 't1',
    name: over.name ?? 'Gross Regular Season',
    isIndividual: over.isIndividual ?? true,
    formatKind: over.formatKind ?? 'individual', // 'individual' | 'team' | 'side' | 'unknown'
  }
}

const noOverride: ClassifyInput['teamOverride'] = false

test('individual when ≥1 individual tournament with positive metadata', () => {
  const r = classifyEventFormat({ tournaments: [mkT()], teamOverride: noOverride })
  assert.equal(r.eventFormat, 'individual')
  assert.equal(r.discoveryState, 'discovered')
})

test('team only with positive metadata (no individual, a team/side tournament present)', () => {
  const r = classifyEventFormat({
    tournaments: [mkT({ id: 't1', isIndividual: false, formatKind: 'team', name: 'Net Team Scramble' })],
    teamOverride: noOverride,
  })
  assert.equal(r.eventFormat, 'team')
  assert.equal(r.discoveryState, 'discovered')
})

test('team via explicit config override for a known scramble week', () => {
  const r = classifyEventFormat({ tournaments: [], teamOverride: true })
  assert.equal(r.eventFormat, 'team')
  assert.equal(r.discoveryState, 'discovered')
})

test('ambiguous tournament set (none positively individual, no team metadata) stays unknown', () => {
  const r = classifyEventFormat({
    tournaments: [mkT({ id: 't1', isIndividual: false, formatKind: 'unknown', name: 'Some Round' })],
    teamOverride: noOverride,
  })
  assert.equal(r.eventFormat, 'unknown')
  assert.ok(r.discoveryState === 'pending' || r.discoveryState === 'inconclusive',
    'ambiguous must not be team')
})

test('empty tournament set (upcoming, not yet created) → unknown/pending', () => {
  const r = classifyEventFormat({ tournaments: [], teamOverride: noOverride })
  assert.equal(r.eventFormat, 'unknown')
  assert.equal(r.discoveryState, 'pending')
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/competition-classify.test.ts`
Expected: FAIL — `classifyEventFormat` not defined / module not found.

- [ ] **Step 3: Implement**

`lib/competition/classify.ts`:

```ts
// Pure event-format classification. No imports. Maps discovered tournaments +
// an explicit config override to (EventFormat, DiscoveryState). The rule:
//   - team requires POSITIVE evidence (a tournament whose formatKind is 'team'
//     or 'side', OR an explicit config override). Absence is never team.
//   - individual requires ≥1 tournament positively classified 'individual'.
//   - anything else is 'unknown', with discovery_state 'pending' (no tournaments
//     at all) or 'inconclusive' (tournaments exist but none positively
//     individual and no positive team evidence).
// See design spec §3.

export type TournamentFormatKind = 'individual' | 'team' | 'side' | 'unknown'

export interface DiscoveredTournament {
  id: string
  name: string                       // hint only; never the sole basis for classification
  isIndividual: boolean               // from explicit GG format metadata where available
  formatKind: TournamentFormatKind
}

export interface ClassifyInput {
  tournaments: DiscoveredTournament[]
  teamOverride: boolean               // explicit config override (known scramble week)
}

export interface ClassifyResult {
  eventFormat: 'individual' | 'team' | 'unknown'
  discoveryState: 'pending' | 'discovered' | 'inconclusive' | 'failed'
}

export function classifyEventFormat(input: ClassifyInput): ClassifyResult {
  const { tournaments, teamOverride } = input

  if (teamOverride) return { eventFormat: 'team', discoveryState: 'discovered' }

  const hasIndividual = tournaments.some((t) => t.formatKind === 'individual' && t.isIndividual)
  if (hasIndividual) return { eventFormat: 'individual', discoveryState: 'discovered' }

  const hasTeamEvidence = tournaments.some((t) => t.formatKind === 'team' || t.formatKind === 'side')
  if (hasTeamEvidence) return { eventFormat: 'team', discoveryState: 'discovered' }

  if (tournaments.length === 0) return { eventFormat: 'unknown', discoveryState: 'pending' }
  return { eventFormat: 'unknown', discoveryState: 'inconclusive' }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/competition-classify.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/competition/classify.ts tests/competition-classify.test.ts
git commit -m "feat(competition): event-format classification (positive-evidence-only)"
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

### Task 6: Capabilities derivation (pure) — TDD

Covers spec tests #9 (women's hides tab bar + grouping control), #10/#13 (men's groupings none while live, multi once final), #12 (women's). This is the single source of truth the UI consumes.

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
}

test('men\'s live: groupings none (unflighted Overall)', () => {
  const c = deriveOccurrenceCapabilities({ ...mensBase, resultStatus: 'live' })
  assert.equal(c.groupings.kind, 'none')
  assert.deepEqual(c.views, ['season', 'weekly'])
  assert.deepEqual(c.scoring.modes, ['gross', 'net'])
})

test('men\'s final: groupings multi (All/A/B/C)', () => {
  const c = deriveOccurrenceCapabilities({
    ...mensBase,
    resultStatus: 'final',
    availableGroupings: { kind: 'multi', groupings: [
      { key: 'A', label: 'Flight A' }, { key: 'B', label: 'Flight B' }, { key: 'C', label: 'Flight C' },
    ], defaultAll: true },
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
// Pure capability derivation. The UI reads only the resulting OccurrenceCapabilities
// to decide which controls render. No league assumptions. See design spec §6/§8.

import type {
  GroupingAvailability,
  OccurrenceCapabilities,
  ResultStatus,
  ScoringModeAvailability,
  View,
} from './types.ts'

export interface CapabilityInput {
  configViews: View[]
  scoringModes: ScoringModeAvailability
  supportsLiveResults: boolean
  supportsEventNavigation: boolean
  availableGroupings: GroupingAvailability
  resultStatus: ResultStatus
}

// While live, groupings are never exposed (flights aren't known until final),
// regardless of what's in availableGroupings. The caller passes the durable
// availableGroupings (from finalized rows); this function masks it to 'none'
// while live so the UI rule "kind === 'multi' → show filter" stays correct.
export function deriveOccurrenceCapabilities(input: CapabilityInput): OccurrenceCapabilities {
  const groupings: GroupingAvailability =
    input.resultStatus === 'live' ? { kind: 'none' } : input.availableGroupings
  return {
    views: input.configViews,
    scoring: input.scoringModes,
    supportsLiveResults: input.supportsLiveResults,
    supportsEventNavigation: input.supportsEventNavigation,
    groupings,
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/competition-capabilities.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/competition/capabilities.ts tests/competition-capabilities.test.ts
git commit -m "feat(competition): capability derivation (groupings masked while live)"
```

---

### Task 7: Scoring preference storage (pure) — TDD

Covers spec test #14 (per-competition isolation + validation against available modes). Revision 7.

**Files:**
- Create: `lib/competition/scoring-prefs.ts`
- Create: `tests/competition-scoring-prefs.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/competition-scoring-prefs.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scoringKey, resolveScoring } from '../lib/competition/scoring-prefs.ts'

// In-memory storage substitute for the browser localStorage.
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
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/competition-scoring-prefs.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`lib/competition/scoring-prefs.ts`:

```ts
// Per-competition scoring-mode preference. The localStorage key is
// competition-scoped (`standings:${competitionKey}:scoring`) and any stored
// value is validated against the occurrence's available modes before use. A
// preference from one competition never selects a mode in another. The
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
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/competition/scoring-prefs.ts tests/competition-scoring-prefs.test.ts
git commit -m "feat(competition): per-competition validated scoring preference"
```

---

### Task 8: Cache key composition (pure) — TDD

Covers the cache-key composition requirement (revision 5): competition-scoped, includes occurrenceId + scope + scoringMode.

**Files:**
- Create: `lib/competition/cache-keys.ts`
- Create: `tests/competition-cache-keys.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/competition-cache-keys.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resultsCacheKey, discoveryCacheKey } from '../lib/competition/cache-keys.ts'

test('results key includes competition, occurrence, scoring', () => {
  assert.equal(resultsCacheKey('mens-league', 'wk18', 'gross'), 'results:mens-league:wk18:gross')
})

test('discovery key includes competition + occurrence, no scoring', () => {
  assert.equal(discoveryCacheKey('mens-league', 'wk18'), 'discovery:mens-league:wk18')
})

test('keys differ by competition (no cross-competition read)', () => {
  assert.notEqual(resultsCacheKey('mens-league', 'wk18', 'gross'), resultsCacheKey('womens-league', 'wk18', 'gross'))
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/competition-cache-keys.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`lib/competition/cache-keys.ts`:

```ts
// Cache key composition. Every key is competition-scoped so no competition
// reads another's cache. Results rows include the scoring mode; discovery
// rows do not. See design spec §4 cache schema.

import type { ScoringMode } from './types.ts'

export function resultsCacheKey(competitionKey: string, occurrenceId: string, scoring: ScoringMode): string {
  return `results:${competitionKey}:${occurrenceId}:${scoring}`
}

export function discoveryCacheKey(competitionKey: string, occurrenceId: string): string {
  return `discovery:${competitionKey}:${occurrenceId}`
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/competition-cache-keys.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/competition/cache-keys.ts tests/competition-cache-keys.test.ts
git commit -m "feat(competition): competition-scoped cache key composition"
```

---

### Task 9: Migration 027 — live cache table

**Files:**
- Create: `supabase/migrations/027_competition_live_cache.sql`

- [ ] **Step 1: Write the migration**

`supabase/migrations/027_competition_live_cache.sql`:

```sql
-- Short-TTL server cache for coalesced live-result + discovery reads. Written
-- by service-role server routes; readable publicly via RLS (the cached
-- payload is the same normalized public result model the live endpoint
-- already returns — no auth/PII beyond what the standings page exposes).
-- See design spec §4.

CREATE TABLE competition_live_cache (
    cache_key        TEXT PRIMARY KEY,
    competition_key   TEXT NOT NULL,
    occurrence_id     TEXT NOT NULL,
    scope             TEXT NOT NULL CHECK (scope IN ('results', 'discovery')),
    payload           JSONB NOT NULL,
    result_status     TEXT,
    fetched_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at        TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_competition_live_cache_expires ON competition_live_cache(expires_at);
CREATE INDEX idx_competition_live_cache_comp_occ ON competition_live_cache(competition_key, occurrence_id);

ALTER TABLE competition_live_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can read live cache" ON competition_live_cache FOR SELECT USING (true);
-- No public write policy: only the service role (server routes) writes.
```

- [ ] **Step 2: Apply locally and verify**

Run: `pnpm supabase`, then verify the table exists:

```bash
node -e "import('./lib/supabase/service.ts').then(async m => { const s = m.createServiceClient(); const { error } = await s.from('competition_live_cache').select('cache_key').limit(1); console.log(error ? 'ERR '+error.message : 'ok'); })"
```
Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/027_competition_live_cache.sql
git commit -m "feat(db): competition_live_cache table for coalesced live reads"
```

---

## Phase 2 — Adapter & Discovery

### Task 10: GG results normalization (pure, fixture-tested) — TDD

The pure parsing of a GG tournament results payload into the generic `Leaderboard`/`Scorecard`. This is the heart of the adapter's result shaping and is unit-testable with fixtures (no network).

**Files:**
- Create: `lib/competition/adapters/golfgenius/normalize.ts`
- Create: `tests/competition-normalize.test.ts`

This reuses the existing `buildHoles`/`positionOrder`/`playerKey` logic from `lib/igc/weekly-results.ts` but emits generic types. To avoid duplicating that logic, **import** the pure helpers from `lib/igc/weekly-results.ts` (they are already pure functions exported there: `buildHoles`, `positionOrder`, `positionLabelOf`, `playerKey`).

- [ ] **Step 1: Write the failing tests**

`tests/competition-normalize.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeTournament, type GGResultsFixture } from '../lib/competition/adapters/golfgenius/normalize.ts'

// Minimal GG tournament-results payload (shape from lib/igc/weekly-results.ts).
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
// positionLabelOf, playerKey) so the hole/scorecard math stays in one place.
// Emits generic ResultEntry + Scorecard keyed by flight.

import {
  buildHoles,
  positionOrder,
  positionLabelOf,
  playerKey,
} from '../../../igc/weekly-results.ts'
import type { ResultEntry, Scorecard, ScoringMode } from '../../types.ts'

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
export interface GGResultsFixture { event?: { scopes?: GGScope[] } }

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
  return { competition, entriesByFlight, scorecards }
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

### Task 11: GG discovery adapter (server-side, network)

This wraps the GG client + classification + normalization into `discoverOccurrence`. It is server-only (calls GG). The pure pieces it depends on are already tested (Task 4 classification, Task 10 normalization). The network orchestration is verified by a fixture-driven test that injects a fake GG client.

**Files:**
- Create: `lib/competition/adapters/golfgenius/discovery.ts`
- Create: `tests/competition-discovery.test.ts`

- [ ] **Step 1: Write the failing test (inject a fake GG client)**

`tests/competition-discovery.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { discoverOccurrence } from '../lib/competition/adapters/golfgenius/discovery.ts'

// Fake GG client implements the minimal call surface discoverOccurrence uses.
function fakeGg(tournaments: any[], resultsByTournament: Record<string, any>) {
  return async (endpoint: string) => {
    if (endpoint.endsWith('/tournaments')) return tournaments
    const tId = endpoint.split('/').slice(-1)[0].replace('.json', '')
    return resultsByTournament[tId] ?? { event: { scopes: [] } }
  }
}

test('discovers individual competitions and classifies individual', async () => {
  const tournaments = [
    { event: { id: 'g1', name: 'Gross Regular Season' } },
    { event: { id: 'n1', name: 'Net Regular Season' } },
  ]
  const gg = fakeGg(tournaments, {
    g1: { event: { scopes: [{ name: 'Flight 1', aggregates: [{ name: 'Hans Olson', position: '1', gross_scores: [5,6,5], net_scores: [4,5,4], to_par_net: [-1,0,-1], to_par_gross: [0,0,0], totals: { gross_scores: { out: 16 }, net_scores: { out: 13 } } }] }] } },
    n1: { event: { scopes: [{ name: 'Flight 1', aggregates: [{ name: 'Hans Olson', position: '1', net_scores: [4,5,4], gross_scores: [5,6,5], to_par_net: [-1,0,-1], to_par_gross: [0,0,0], totals: { net_scores: { out: 13 } } }] }] } },
  })
  const r = await discoverOccurrence({
    competitionKey: 'mens-league',
    ggEventId: 'E', ggRoundId: 'R',
    persistedTournamentIds: { gross: 'g1', net: 'n1' },
    teamOverride: false,
    ggClient: gg,
  })
  assert.equal(r.eventFormat, 'individual')
  assert.equal(r.discoveryState, 'discovered')
  assert.ok(r.leaderboard, 'leaderboard produced')
  assert.equal(r.leaderboard!.entries.length > 0, true)
})

test('no tournaments (upcoming) → unknown/pending, no team misclassification', async () => {
  const gg = fakeGg([], {})
  const r = await discoverOccurrence({
    competitionKey: 'mens-league', ggEventId: 'E', ggRoundId: 'R',
    persistedTournamentIds: { gross: null, net: null }, teamOverride: false, ggClient: gg,
  })
  assert.equal(r.eventFormat, 'unknown')
  assert.equal(r.discoveryState, 'pending')
  assert.equal(r.leaderboard, null)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/competition-discovery.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`lib/competition/adapters/golfgenius/discovery.ts`:

```ts
// Server-side GG discovery. Resolves an occurrence's competitions and results
// directly from Golf Genius, classifies the event format (positive evidence
// only), and normalizes to generic types. Persisted tournament ids are HINTS:
// used to skip the tournaments-list call when present; if results come back
// empty/errored, falls back to full discovery. Never classifies team from
// absence. The GG client is injected so this is unit-testable with fixtures.

import { classifyEventFormat, type DiscoveredTournament } from '../../classify.ts'
import { normalizeTournament } from './normalize.ts'
import type { GolfGeniusAdapterConfig } from '../../types.ts'
import type { Leaderboard, ScoringMode, EventFormat, DiscoveryState, ResultStatus } from '../../types.ts'

export type GGClient = (endpoint: string) => Promise<any>

export interface DiscoverInput {
  competitionKey: string
  ggEventId: string
  ggRoundId: string
  persistedTournamentIds: { gross: string | null; net: string | null }
  teamOverride: boolean
  ggClient: GGClient
  scoringMode?: ScoringMode // which competition's leaderboard to return
}

export interface DiscoverResult {
  eventFormat: EventFormat
  discoveryState: DiscoveryState
  resultStatus: ResultStatus
  leaderboard: Leaderboard | null
  tournaments: { gross: string | null; net: string | null }
}

// Tournament-name → formatKind heuristic. Names are HINTS only; the classifier
// still requires positive evidence for 'team' and never infers 'team' from a
// name alone unless it matches an explicit team/scramble pattern.
function nameToKind(name: string): DiscoveredTournament['formatKind'] {
  const n = name.toLowerCase()
  if (/team|scramble/.test(n)) return 'team'
  if (/closest to the pin|kp hole/.test(n)) return 'side'
  if (/gross|net|individual/.test(n)) return 'individual'
  return 'unknown'
}

export async function discoverOccurrence(input: DiscoverInput): Promise<DiscoverResult> {
  const { competitionKey, ggEventId, ggRoundId, persistedTournamentIds, teamOverride, ggClient } = input
  const scoringMode: ScoringMode = input.scoringMode ?? 'net'

  // Resolve the tournament list (skip if persisted hints present and non-null).
  let grossId = persistedTournamentIds.gross
  let netId = persistedTournamentIds.net
  let discoveredTournaments: DiscoveredTournament[] = []

  if (!grossId && !netId) {
    // Full discovery: list tournaments and pick gross/net.
    let list: any[] = []
    try {
      list = await ggClient(`/events/${ggEventId}/rounds/${ggRoundId}/tournaments`)
    } catch {
      return { eventFormat: 'unknown', discoveryState: 'failed', resultStatus: 'unknown', leaderboard: null, tournaments: { gross: null, net: null } }
    }
    const named = (Array.isArray(list) ? list : []).map((t) => t.event).filter((e) => e?.id && e?.name)
    discoveredTournaments = named.map((e) => ({
      id: e.id, name: e.name, isIndividual: nameToKind(e.name) === 'individual',
      formatKind: nameToKind(e.name),
    }))
    const individual = named.filter((e) => nameToKind(e.name) === 'individual')
    grossId = individual.find((e) => /gross/i.test(e.name))?.id ?? null
    netId = individual.find((e) => /net/i.test(e.name))?.id ?? (individual.length === 1 ? individual[0].id : null)
  } else {
    // Hints present; synthesize discoveredTournaments as individual for classification.
    discoveredTournaments = [grossId, netId].filter(Boolean).map((id) => ({
      id: id as string, name: '', isIndividual: true, formatKind: 'individual' as const,
    }))
  }

  const cls = classifyEventFormat({ tournaments: discoveredTournaments, teamOverride })
  if (cls.eventFormat !== 'individual') {
    return { eventFormat: cls.eventFormat, discoveryState: cls.discoveryState, resultStatus: 'not_started', leaderboard: null, tournaments: { gross: grossId, net: netId } }
  }

  // Fetch the scoring-mode competition's results and normalize.
  const tournamentId = scoringMode === 'gross' ? grossId : netId
  if (!tournamentId) {
    return { eventFormat: 'individual', discoveryState: 'discovered', resultStatus: 'not_started', leaderboard: null, tournaments: { gross: grossId, net: netId } }
  }
  let payload: any
  try {
    payload = await ggClient(`/events/${ggEventId}/rounds/${ggRoundId}/tournaments/${tournamentId}.json`)
  } catch {
    return { eventFormat: 'individual', discoveryState: 'failed', resultStatus: 'unknown', leaderboard: null, tournaments: { gross: grossId, net: netId } }
  }
  const norm = normalizeTournament(payload, scoringMode)
  const anyPlayers = [...norm.entriesByFlight.values()].some((es) => es.length > 0)
  if (!anyPlayers) {
    return { eventFormat: 'individual', discoveryState: 'discovered', resultStatus: 'not_started', leaderboard: null, tournaments: { gross: grossId, net: netId } }
  }
  const anyLive = [...norm.scorecards.values()].some((c) => c.isLive)
  const entries = [...norm.entriesByFlight.values()].flat()
  const leaderboard: Leaderboard = {
    occurrenceId: '', // filled by caller
    scoringMode,
    grouping: null,
    entries,
    scorecards: [...norm.scorecards.values()],
    resultStatus: anyLive ? 'live' : 'final',
    durableCurrent: false,
  }
  return { eventFormat: 'individual', discoveryState: 'discovered', resultStatus: leaderboard.resultStatus, leaderboard, tournaments: { gross: grossId, net: netId } }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/competition-discovery.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/competition/adapters/golfgenius/discovery.ts tests/competition-discovery.test.ts
git commit -m "feat(competition): server-side GG discovery + classification"
```

---

### Task 12: League configs + registry

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
  },
  navigation: { occurrenceNoun: 'week', queryParam: 'week', labelRule: { kind: 'composite', noun: 'Week', separator: ' – ' } },
  capabilities: {
    views: ['season', 'weekly'],
    scoring: { modes: ['gross', 'net'] },
    supportsLiveResults: true,
    supportsEventNavigation: true,
  },
  schedule: { timezone: 'America/Los_Angeles', playDay: 2, windowHours: 8 },
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
  },
  navigation: { occurrenceNoun: 'week', queryParam: 'week', labelRule: { kind: 'composite', noun: 'Week', separator: ' – ' } },
  capabilities: {
    views: ['weekly'],
    scoring: { modes: ['gross', 'net'] },
    supportsLiveResults: true,
    supportsEventNavigation: true,
  },
  schedule: { timezone: 'America/Los_Angeles', playDay: 3, windowHours: 8 },
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

### Task 13: DB row ↔ generic Occurrence mapping (server-only)

Maps the persisted `igc_league_events` rows (and `igc_league_*` result rows) to generic `Occurrence` + `Leaderboard` for the finalized/historical path. Server-only; the UI never sees `igc_league_*` shapes.

**Files:**
- Create: `lib/competition/adapters/golfgenius/mapping.ts`

- [ ] **Step 1: Implement**

`lib/competition/adapters/golfgenius/mapping.ts`:

```ts
// Map igc_league_* DB rows to generic Occurrence/Leaderboard. SERVER-ONLY.
// This is the only place igc_league_* column names appear in the new shared
// layer; everything downstream consumes generic types.

import type { Occurrence, ActiveWindow, EventFormat, DiscoveryState, ResultStatus } from '../../types.ts'

export interface LeagueEventRow {
  week_number: number
  event_name: string | null
  event_date: string | null
  status: string | null                  // 'upcoming' | 'live' | 'finalized' (legacy)
  event_format: EventFormat | null
  discovery_state: DiscoveryState | null
  gg_event_id: string | null
}

// Build the configured active window from a date + schedule. League rounds are
// single-evening; the window is [date 16:00, date + windowHours]. For a future
// Seattle Cup multi-day occurrence this is where multi-day windows would be
// expressed — driven by config, not hardcoded here.
export function leagueActiveWindow(dateIso: string | null, tz: string, windowHours = 8): ActiveWindow | null {
  if (!dateIso) return null
  const d = dateIso.slice(0, 10)
  return { start: `${d}T16:00:00`, end: null } // open-ended; liveness resolved by upstream status + window heuristic
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

// Resolve a league occurrence label from the config label rule, server-side.
export function leagueOccurrenceLabel(
  rule: { kind: 'composite'; noun: string; separator: string } | { kind: 'numberPrefix'; noun: string } | { kind: 'event_name' },
  number: number | null,
  eventName: string | null,
): string {
  if (rule.kind === 'event_name') return eventName ?? `Week ${number ?? ''}`.trim()
  const prefix = `${rule.noun} ${number ?? ''}`.trim()
  if (rule.kind === 'numberPrefix') return prefix
  // composite
  return eventName ? `${prefix}${rule.separator}${eventName}` : prefix
}
```

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/competition/adapters/golfgenius/mapping.ts
git commit -m "feat(competition): igc_league_* → generic Occurrence mapping"
```

---

## Phase 3 — Live Read Path

### Task 14: Cache module (DB-backed + in-process single-flight) — TDD

Covers spec test #15 (in-process single-flight). The cross-instance behavior is documented best-effort (test #16 is an integration doc test in Task 22).

**Files:**
- Create: `lib/competition/cache.ts`
- Create: `tests/competition-live-singleflight.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/competition-live-singleflight.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeSingleFlight } from '../lib/competition/cache.ts'

test('in-process single-flight: N concurrent calls share one upstream fetch', async () => {
  let calls = 0
  const sf = makeSingleFlight<string>()
  const work = async () => {
    calls++
    await new Promise((r) => setTimeout(r, 20))
    return 'result'
  }
  const results = await Promise.all([
    sf.run('k1', work),
    sf.run('k1', work),
    sf.run('k1', work),
  ])
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

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/competition-live-singleflight.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`lib/competition/cache.ts`:

```ts
// Coalesced live-result cache. Two layers:
//   1. In-process single-flight (promise map) — GUARANTEED within one instance.
//      Unit-tested above. Prevents N concurrent in-process requests from
//      each calling upstream.
//   2. DB-backed short-TTL cache (competition_live_cache) — prevents most
//      repeated upstream calls AFTER the first write, across requests. Two
//      cold instances missing simultaneously can both call upstream before
//      either writes — this is BEST-EFFORT cross-instance coalescing, not a
//      strict single-flight guarantee. If strict cross-instance single-flight
//      is ever required, add a Postgres advisory lock around the fill (future).
// See design spec §4.

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

import { createServiceClient } from '../supabase/service.ts'
import { resultsCacheKey, discoveryCacheKey } from './cache-keys.ts'
import type { LiveResponse } from './types.ts'

const RESULTS_TTL_SECONDS = 60
const DISCOVERY_TTL_SECONDS = 120

function expiresAt(ttlSeconds: number): string {
  return new Date(Date.now() + ttlSeconds * 1000).toISOString()
}

export async function readCachedResult(key: string): Promise<LiveResponse | null> {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('competition_live_cache')
    .select('payload, result_status')
    .eq('cache_key', key)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()
  return data?.payload ? (data.payload as LiveResponse) : null
}

export async function writeCachedResult(competitionKey: string, occurrenceId: string, scoring: string, payload: LiveResponse): Promise<void> {
  const supabase = createServiceClient()
  const key = resultsCacheKey(competitionKey, occurrenceId, scoring)
  await supabase.from('competition_live_cache').upsert({
    cache_key: key,
    competition_key: competitionKey,
    occurrence_id: occurrenceId,
    scope: 'results',
    payload: payload as unknown as Record<string, unknown>,
    result_status: payload.resultStatus,
    fetched_at: new Date().toISOString(),
    expires_at: expiresAt(RESULTS_TTL_SECONDS),
  })
}

export async function readCachedDiscovery(competitionKey: string, occurrenceId: string): Promise<any | null> {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('competition_live_cache')
    .select('payload')
    .eq('cache_key', discoveryCacheKey(competitionKey, occurrenceId))
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()
  return data?.payload ?? null
}

export async function writeCachedDiscovery(competitionKey: string, occurrenceId: string, payload: unknown): Promise<void> {
  const supabase = createServiceClient()
  await supabase.from('competition_live_cache').upsert({
    cache_key: discoveryCacheKey(competitionKey, occurrenceId),
    competition_key: competitionKey,
    occurrence_id: occurrenceId,
    scope: 'discovery',
    payload: payload as Record<string, unknown>,
    fetched_at: new Date().toISOString(),
    expires_at: expiresAt(DISCOVERY_TTL_SECONDS),
  })
}

// Cheap cleanup of long-expired rows; called from the hourly reconcile route.
export async function cleanExpiredCache(): Promise<void> {
  const supabase = createServiceClient()
  await supabase.from('competition_live_cache')
    .delete()
    .lt('expires_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/competition-live-singleflight.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/competition/cache.ts tests/competition-live-singleflight.test.ts
git commit -m "feat(competition): coalesced live cache (in-process single-flight + DB TTL)"
```

---

### Task 15: Shared `getLiveResults` + `/api/competition/live` route + compatibility handler

Covers spec test #18 (compat handler returns without redirect) and the live read path.

**Files:**
- Create: `lib/competition/live.ts`
- Create: `app/api/competition/live/route.ts`
- Modify: `app/api/igc/league/live/route.ts`

- [ ] **Step 1: Implement `getLiveResults`**

`lib/competition/live.ts`:

```ts
// Shared live read function used by BOTH /api/competition/live and the
// /api/igc/league/live compatibility handler. Reads the persisted event row
// for hints (gg_event_id, gg_round_id, tournament ids), discovers from GG when
// hints are absent/stale, serves from cache, and writes back. Auth is the
// route's responsibility; this function does not enforce auth.

import { createClient } from '../supabase/server.ts'
import { makeGolfGeniusRequest } from '../gg/client.ts'
import { discoverOccurrence, type GGClient } from './adapters/golfgenius/discovery.ts'
import { readCachedResult, writeCachedResult, makeSingleFlight } from './cache.ts'
import { mapLeagueEventToOccurrence, leagueActiveWindow, leagueOccurrenceLabel } from './adapters/golfgenius/mapping.ts'
import { getCompetitionConfig } from './registry.ts'
import type { LiveResponse, ScoringMode } from './types.ts'

const sf = makeSingleFlight<LiveResponse>()

export async function getLiveResults(competitionKey: string, occurrenceId: string, scoring: ScoringMode): Promise<LiveResponse> {
  const cacheKey = occurrenceId // resultsCacheKey handled in cache.ts
  const cached = await readCachedResultByKey(competitionKey, occurrenceId, scoring)
  if (cached) return cached

  const fresh = await sf.run(`${competitionKey}:${occurrenceId}:${scoring}`, () => fetchFresh(competitionKey, occurrenceId, scoring))
  await writeCachedResult(competitionKey, occurrenceId, scoring, fresh).catch(() => {})
  return fresh
}

async function readCachedResultByKey(competitionKey: string, occurrenceId: string, scoring: ScoringMode): Promise<LiveResponse | null> {
  const { readCachedResult: read } = await import('./cache.ts')
  return read(`${competitionKey}:${occurrenceId}:${scoring}`)
}

async function fetchFresh(competitionKey: string, occurrenceId: string, scoring: ScoringMode): Promise<LiveResponse> {
  const config = getCompetitionConfig(competitionKey)
  if (!config) throw new Error(`unknown competition ${competitionKey}`)

  const supabase = await createClient()
  const { data: ev } = await supabase
    .from('igc_league_events')
    .select('week_number, event_name, event_date, event_format, discovery_state, gg_event_id, gg_round_id, gg_gross_tournament_id, gg_net_tournament_id')
    .eq('league_key', leagueKeyFor(competitionKey))
    .eq('week_number', Number(occurrenceId))
    .maybeSingle()

  // gg_event_id is required to talk to GG at all. If the row is missing or has
  // no gg_event_id, we cannot discover live — return an honest unknown state
  // (NOT a team-event verdict).
  if (!ev || !ev.gg_event_id) {
    return {
      occurrence: stubOccurrence(occurrenceId),
      leaderboard: null,
      resultStatus: 'unknown',
      eventFormat: 'unknown',
      discoveryState: 'pending',
      showingLastKnown: false,
    }
  }

  const ggClient: GGClient = (endpoint) => makeGolfGeniusRequest({ endpoint })
  const r = await discoverOccurrence({
    competitionKey,
    ggEventId: ev.gg_event_id,
    ggRoundId: ev.gg_round_id,
    persistedTournamentIds: { gross: ev.gg_gross_tournament_id ?? null, net: ev.gg_net_tournament_id ?? null },
    teamOverride: false,
    ggClient,
    scoringMode: scoring,
  })

  const window = leagueActiveWindow(ev.event_date, config.schedule?.timezone ?? 'America/Los_Angeles', config.schedule?.windowHours) ?? { start: ev.event_date ?? '', end: null }
  const label = leagueOccurrenceLabel(config.navigation.labelRule, ev.week_number, ev.event_name)
  const occurrence = mapLeagueEventToOccurrence({
    week_number: ev.week_number, event_name: ev.event_name, event_date: ev.event_date,
    status: null, event_format: r.eventFormat, discovery_state: r.discoveryState, gg_event_id: ev.gg_event_id,
  }, label, window, r.resultStatus)

  const lb = r.leaderboard ? { ...r.leaderboard, occurrenceId } : null
  return {
    occurrence,
    leaderboard: lb,
    resultStatus: r.resultStatus,
    eventFormat: r.eventFormat,
    discoveryState: r.discoveryState,
    showingLastKnown: false,
  }
}

function leagueKeyFor(competitionKey: string): string {
  // Adapter mapping from generic competition key to the legacy league_key.
  return competitionKey === 'mens-league' ? 'mens' : 'womens'
}

function stubOccurrence(occurrenceId: string) {
  return {
    id: occurrenceId, number: Number(occurrenceId) || null, label: `Week ${occurrenceId}`,
    date: null, activeWindow: { start: '', end: null },
    format: 'unknown' as const, discoveryState: 'pending' as const, resultStatus: 'unknown' as const,
  }
}
```

- [ ] **Step 2: Implement the generic route**

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
    const results = await getLiveResults(competition, occurrence, scoring)
    return NextResponse.json({ results })
  } catch (err) {
    console.error(`[api/competition/live] ${competition}/${occurrence}:`, err)
    return NextResponse.json({ error: 'Failed to fetch live results' }, { status: 502 })
  }
}
```

- [ ] **Step 3: Rewrite the compatibility handler**

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
    const results = await getLiveResults(competitionKey, String(week), scoring)
    return NextResponse.json({ results })
  } catch (err) {
    console.error(`[api/igc/league/live] ${league} wk${week}:`, err)
    return NextResponse.json({ error: 'Failed to fetch live results' }, { status: 502 })
  }
}
```

- [ ] **Step 4: Lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/competition/live.ts app/api/competition/live/route.ts app/api/igc/league/live/route.ts
git commit -m "feat(competition): shared live read path + compat handler (no redirect)"
```

---

## Phase 4 — Durable Reconciliation

### Task 16: Decompose sync — durable import + season-points + reconcile

Refactor the monolithic `scripts/sync-igc-league.mjs` into reusable application logic in `lib/competition/reconcile/`. The CLI becomes a thin wrapper. Season-points rebuild keeps the completed-round guard. Reconciliation is idempotent.

This task ports the existing, working sync logic (do **not** change the scoring math) into typed modules. Keep behavior parity with the current script as the baseline; the new discovery/classification behavior (Task 11) layers on top via `reconcileCompetition`.

**Files:**
- Create: `lib/competition/reconcile/import.ts`
- Create: `lib/competition/reconcile/season-points.ts`
- Create: `lib/competition/reconcile/reconcile.ts`
- Modify: `scripts/sync-igc-league.mjs`

- [ ] **Step 1: Port import logic**

`lib/competition/reconcile/import.ts` — port `syncLeague()`'s per-round upsert loop (lines 191–397 of the current script) into an exported `importOccurrence(config, weekNumber)` that upserts the event row + performances + results for one occurrence. Keep the same GG endpoints, the same `pickIndividualTournaments`/`isSideOrTeamCompetition`/`parsePosition`/`parseNum`/`countCompletedHoles`/`totalOut` helpers, and the same upsert natural keys. Use `createServiceClient()` and `makeGolfGeniusRequest` from `@/lib/...`. (Port verbatim from the existing script; this is mechanical reuse, not new logic — copy the helper functions into a small `lib/competition/reconcile/gg-helpers.ts` if needed to keep `import.ts` focused.)

- [ ] **Step 2: Port season-points logic**

`lib/competition/reconcile/season-points.ts` — port the snapshot build (lines 429–500 of the current script) into `rebuildSeasonPoints(leagueKey)` keeping the completed-round guard and the `seasonCum`/`cumBeforeLast` accumulation. No behavioral change.

- [ ] **Step 3: Implement reconcile orchestration**

`lib/competition/reconcile/reconcile.ts`:

```ts
// Idempotent, bounded reconciliation. Processes only occurrences that are
// active, unresolved (event_format='unknown' or discovery_state!='discovered'),
// or recently completed (within RECENT_WINDOW_HOURS). Older/unchanged
// occurrences are skipped cheaply. Stops before the soft deadline so a
// timeout never leaves the run half-applied; unfinished work is eligible for
// the next hourly run (every step is an idempotent upsert keyed by natural
// keys). Failures are isolated per competition. See design spec §5/§7.

import { allCompetitionConfigs } from '../registry.ts'
import { createServiceClient } from '../../supabase/service.ts'

const SOFT_DEADLINE_MS = 90_000 // well under the verified cron maxDuration
const RECENT_WINDOW_HOURS = 72

export interface ReconcileSummary {
  competition: string
  discovered: number
  imported: number
  skipped: number
  seasonPointsRebuilds: number
  errors: string[]
  stoppedForBudget: boolean
}

export async function reconcileAllCompetitions(): Promise<ReconcileSummary[]> {
  const summaries: ReconcileSummary[] = []
  for (const config of allCompetitionConfigs()) {
    try {
      summaries.push(await reconcileCompetition(config.key, Date.now() + SOFT_DEADLINE_MS))
    } catch (err) {
      summaries.push({ competition: config.key, discovered: 0, imported: 0, skipped: 0, seasonPointsRebuilds: 0, errors: [String(err)], stoppedForBudget: false })
    }
  }
  return summaries
}

export async function reconcileCompetition(competitionKey: string, softDeadlineMs: number): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = { competition: competitionKey, discovered: 0, imported: 0, skipped: 0, seasonPointsRebuilds: 0, errors: [], stoppedForBudget: false }
  const leagueKey = competitionKey === 'mens-league' ? 'mens' : 'womens'
  const supabase = createServiceClient()

  const { data: events } = await supabase.from('igc_league_events')
    .select('week_number, event_date, event_format, discovery_state, status, updated_at')
    .eq('league_key', leagueKey)
    .order('event_date', { ascending: false })
    .limit(200)

  const recentCutoff = new Date(Date.now() - RECENT_WINDOW_HOURS * 3600_000).toISOString()
  for (const e of events ?? []) {
    if (Date.now() > softDeadlineMs) { summary.stoppedForBudget = true; break }

    const isUnresolved = (e.event_format ?? 'unknown') === 'unknown' || (e.discovery_state ?? 'pending') !== 'discovered'
    const eventIso = e.event_date ? new Date(e.event_date).toISOString() : null
    const isRecent = !!eventIso && eventIso >= recentCutoff
    const isActive = e.status === 'live'

    if (!isUnresolved && !isActive && !isRecent) { summary.skipped++; continue }

    try {
      // Re-discover + classify (cheap), then import + rebuild points only when
      // finalized/completed. Active occurrences get discovery only.
      // (Implementation calls import.ts/season-points.ts from Step 1/2.)
      summary.discovered++
      if (e.status === 'finalized' || isRecent) {
        // importOccurrence(...) + rebuildSeasonPoints(...) for the league.
        summary.imported++
        if (competitionKey === 'mens-league') { summary.seasonPointsRebuilds++ }
      }
    } catch (err) {
      summary.errors.push(`wk${e.week_number}: ${String(err)}`)
    }
  }
  return summary
}
```

> **Note for the implementer:** the orchestration above references `importOccurrence` and `rebuildSeasonPoints`; wire the actual calls to the modules from Steps 1 and 2 (pass the config + week). Keep the soft-deadline check at the top of every iteration.

- [ ] **Step 4: Rewrite the CLI as a thin wrapper**

`scripts/sync-igc-league.mjs` — replace the monolithic body with:

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
const summary = await reconcileCompetition(competitionKey, Date.now() + 5 * 60_000)
console.log(`${competitionKey}:`, summary)
```

- [ ] **Step 5: Parity check**

Run against local Supabase + GG: `node scripts/sync-igc-league.mjs mens` (requires env). Compare one week's `igc_league_performances` / `igc_league_results` / `igc_league_season_points` rows to a pre-change baseline snapshot — they must be identical.

Expected: identical rows (parity).

- [ ] **Step 6: Commit**

```bash
git add lib/competition/reconcile scripts/sync-igc-league.mjs
git commit -m "feat(competition): decompose sync into reusable idempotent reconcile"
```

---

### Task 17: Cron route + vercel.json + CRON_SECRET

Covers revision 9 (bounded, resumable, verified execution budget).

**Files:**
- Create: `app/api/cron/reconcile/route.ts`
- Modify: `vercel.json`
- Modify: `package.json` (add `reconcile` script)

- [ ] **Step 1: Implement the cron route**

`app/api/cron/reconcile/route.ts`:

```ts
import { NextResponse } from 'next/server'

import { reconcileAllCompetitions, cleanExpiredCache } from '@/lib/competition/reconcile/reconcile'
import { cleanExpiredCache as cleanCache } from '@/lib/competition/cache'

export const dynamic = 'force-dynamic'
// maxDuration is NOT assumed from a default; the deployment plan must verify
// the actual Vercel function timeout for this route and the soft deadline in
// reconcile.ts stays well below it. See design spec §7 (revision 9).

export async function GET(request: Request) {
  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const summaries = await reconcileAllCompetitions()
  await cleanCache().catch(() => {})
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
    "reconcile": "node -e \"import('./lib/competition/reconcile/reconcile.ts').then(async m => { const s = await m.reconcileAllCompetitions(); console.log(s); })\"",
```

Add to the project's env documentation (`.env.local.example`): `CRON_SECRET=...` (a random secret shared with the Vercel cron header). Document in CLAUDE.md Environment Variables section that `CRON_SECRET` gates `/api/cron/reconcile`.

- [ ] **Step 4: Verify execution budget**

Check the Vercel deployment plan's function timeout for the cron route (default 300s on current plans per the platform notes, but **verify** in the project's Vercel settings). Confirm the `SOFT_DEADLINE_MS = 90_000` in `reconcile.ts` is comfortably below the verified `maxDuration`. If the verified timeout is lower, lower the soft deadline.

- [ ] **Step 5: Lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/api/cron/reconcile/route.ts vercel.json package.json .env.local.example CLAUDE.md
git commit -m "feat(competition): hourly reconciliation cron + CRON_SECRET gate"
```

---

### Task 18: Integration tests (local Supabase) — idempotency, delayed finalization, cross-instance

These require a running local Supabase (`pnpm supabase`) and are run manually (not in CI). They document the cross-instance guarantee per revision 5 (best-effort, test #16).

**Files:**
- Create: `tests/integration/reconcile-idempotent.mjs`
- Create: `tests/integration/cache-cross-instance.mjs`
- Create: `tests/integration/README.md`

- [ ] **Step 1: Idempotency + delayed-finalization test**

`tests/integration/reconcile-idempotent.mjs` — a script that:
1. Seeds (or uses existing) `igc_league_events` rows for a test week with `event_format='unknown'`.
2. Mocks/overrides GG to return a `completed` round with `season_points` populated.
3. Runs `reconcileCompetition('mens-league', ...)` twice.
4. Asserts the second run's `igc_league_season_points` rows are byte-identical to the first (idempotency — spec test #11).
5. Seeds a second week played but **not** `completed` in GG; runs reconcile; asserts the snapshot did **not** advance (completed-round guard — spec test #10); then flips the mock to `completed` + `season_points`, runs reconcile again, asserts the snapshot advanced.

Use the Node built-in `node:test` + `node:assert` so it runs with `node --test tests/integration/reconcile-idempotent.mjs` once Supabase is up. Guard the test with an early skip if `process.env.NEXT_PUBLIC_SUPABASE_URL` is unset.

- [ ] **Step 2: Cross-instance cache doc test**

`tests/integration/cache-cross-instance.mjs` — documents the best-effort guarantee: two concurrent cold-miss calls for the same key (simulated by clearing the cache row then firing two `getLiveResults` concurrently against a fake GG that counts calls). Assert each returns a correct `LiveResponse`. Assert at least one upstream call happened; **do not** assert exactly one (duplicate cold-miss fetches are permitted under the chosen best-effort design — spec test #16). Print a clear comment that strict cross-instance single-flight requires the optional advisory lock.

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

### Task 19: Shared UI primitives — status badge + states

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

`components/competition/states.tsx` — `LoadingSkeleton`, `EmptyState`, `UnavailableState` (inconclusive/failed), `TeamEventState`, and a subtle `RefreshingIndicator`. The team-event state renders only when the server positively classified `team` (the component just receives `eventFormat='team'` + `discoveryState='discovered'`); it never derives team from absence.

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

export function UnavailableState({ message, onRetry, retrying }: { message: string; onRetry?: () => void; retrying?: boolean }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-muted/20 p-4 text-sm">
      <p className="text-muted-foreground">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} disabled={refreshing} className="mt-2 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50">
          {refreshing ? 'Refreshing…' : 'Refresh now'}
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

### Task 20: Controls — occurrence nav, scoring toggle, grouping filter

**Files:**
- Create: `components/competition/occurrence-nav.tsx`
- Create: `components/competition/scoring-toggle.tsx`
- Create: `components/competition/grouping-filter.tsx`

- [ ] **Step 1: Implement occurrence nav (prev/next + dropdown)**

`components/competition/occurrence-nav.tsx` — a client component that takes `occurrences: { id: string; label: string }[]`, `selectedId`, `queryParam`, and navigates by updating `?queryParam=id` (using `router.replaceState`-style URL update without scroll). Prev/Next disabled at ends. Renders a native `<select>` for the dropdown (mobile-friendly, no horizontal scroll).

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
    const next = new URLSearchParams(params.toString())
    next.set(queryParam, id)
    router.replace(`${pathname}?${next.toString()}`, { scroll: false })
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

### Task 21: Leaderboard + scorecard (one focused table)

**Files:**
- Create: `components/competition/scorecard.tsx` (port from `weekly-results-view.tsx`)
- Create: `components/competition/leaderboard.tsx`

- [ ] **Step 1: Port the Scorecard**

Copy the existing `Scorecard`, `PlayerRow`, `CompetitionTable`, `formatToPar`, `formatThru`, `formatPoints`, `toParClass`, `toParNarration` from `components/igc/weekly-results-view.tsx` into `components/competition/scorecard.tsx`, retyped to the generic `Scorecard`/`ResultEntry` from `@/lib/competition/types`. No behavior change — this is the expandable hole-by-hole card reused verbatim.

- [ ] **Step 2: Implement the leaderboard**

`components/competition/leaderboard.tsx` — one table for the selected scoring mode + grouping, expandable scorecards. Receives only generic types (`Leaderboard`) + capabilities.

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

### Task 22: Live polling hook — bounded post-final refresh + subtle state

Covers spec tests #7 (live→final slow poll until groupings), #8 (no skeleton flashing on background refresh), #9 (historical final doesn't poll). Revision 1.

**Files:**
- Create: `components/competition/use-live-poll.ts`

- [ ] **Step 1: Implement the hook**

`components/competition/use-live-poll.ts`:

```ts
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { LiveResponse, ScoringMode } from '@/lib/competition/types'

const LIVE_POLL_MS = 60_000
const FINAL_POLL_MS = 5 * 60_000
const FINAL_POLL_BOUND_MS = 90 * 60_000 // 1.5h; stop slow poll after this

// Bounded post-finalization refresh. While live: poll ~60s. On live→final
// transition: continue slow ~5min polls until durableCurrent OR the bound
// expires. Historical final occurrences (loaded already-final) never poll.
// Background refreshes keep the existing leaderboard visible (subtle
// refreshing state); skeletons only on initial load / no usable result.
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

  const refresh = useCallback(async () => {
    if (!pollUrl) return
    setRefreshing(true)
    try {
      const res = await fetch(pollUrl, { cache: 'no-store' })
      if (!res.ok) throw new Error(`refresh ${res.status}`)
      const json = (await res.json()) as { results?: LiveResponse }
      if (json.results) {
        setData(json.results)
        setShowingLastKnown(false)
      }
    } catch {
      setShowingLastKnown(true) // stale-while-error; keep last good data mounted
    } finally {
      setRefreshing(false)
    }
  }, [pollUrl])

  useEffect(() => {
    if (!supportsLive || !pollUrl) return
    if (initialIsHistoricalFinal) return // historical final → no auto-poll

    let id: ReturnType<typeof setInterval> | null = null
    const start = (ms: number) => { if (id === null) id = setInterval(() => void refresh(), ms) }
    const stop = () => { if (id !== null) { clearInterval(id); id = null } }
    const onVis = () => { if (document.hidden) stop(); else schedule() }

    const schedule = () => {
      const status = data?.resultStatus
      if (status === 'live') { start(LIVE_POLL_MS) }
      else if (status === 'final') {
        if (finalSinceRef.current === null) finalSinceRef.current = Date.now()
        const elapsed = Date.now() - finalSinceRef.current
        const durableCurrent = data?.leaderboard?.durableCurrent ?? false
        if (durableCurrent || elapsed > FINAL_POLL_BOUND_MS) { stop(); return }
        start(FINAL_POLL_MS)
      } else { stop() }
    }

    schedule()
    document.addEventListener('visibilitychange', onVis)
    return () => { stop(); document.removeEventListener('visibilitychange', onVis) }
  }, [supportsLive, pollUrl, refresh, data?.resultStatus, data?.leaderboard?.durableCurrent, initialIsHistoricalFinal])

  return { data, refreshing, showingLastKnown, refresh }
}
```

> **Note:** `Date.now()` is fine in a client hook (it's banned only in Workflow scripts). The bound is per-mounted-session; if the user closes/reopens, a historical-final occurrence won't poll anyway.

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/competition/use-live-poll.ts
git commit -m "feat(competition): bounded live→final polling hook (no skeleton flashing)"
```

---

### Task 23: `StandingsWorkspace` shell + server wrapper wiring

The shell renders tabs (if >1 view), controls (per capabilities), the leaderboard, and the live poll hook. URL is source of truth; `scoring` persisted to namespaced localStorage. The server wrapper resolves the competition config, fetches initial data, resolves labels, and passes plain data + capabilities to the client shell.

**Files:**
- Create: `components/competition/standings-workspace.tsx` (client)
- Create: `components/competition/standings-workspace-server.tsx` (server: resolves config + initial data)
- Modify: `components/igc/league-standings-view.tsx` (becomes a thin wrapper)
- Modify: `app/igc/mens-league/page.tsx`, `app/igc/womens-league/page.tsx`

- [ ] **Step 1: Implement the client shell**

`components/competition/standings-workspace.tsx` — receives only plain data + capabilities + initial `LiveResponse` + `pollUrl`. Renders tabs if `capabilities.views.length > 1`, occurrence nav if `supportsEventNavigation`, scoring toggle if `scoring.modes.length > 1`, grouping filter if `groupings.kind === 'multi'`. Uses `useLivePoll`. Skeleton only on initial load when no usable result; subtle `RefreshingIndicator` on background refresh. URL via `useRouter`/`useSearchParams`; scoring pref via `resolveScoring`/`writeScoringPref` against `window.localStorage`.

(Skeleton structure — the implementer fills the JSX wiring using the components from Tasks 19–22 and the pure helpers from Tasks 6–7. All primitives already exist; this task wires them. No new logic.)

- [ ] **Step 2: Implement the server wrapper**

`components/competition/standings-workspace-server.tsx` — async server component: takes `competitionKey`, reads URL search params (`view`, `week`/occurrence, `scoring`, `grouping`), resolves the config from the registry, fetches occurrences + the selected occurrence's initial results (live or from DB), computes capabilities via `deriveOccurrenceCapabilities`, resolves labels via `leagueOccurrenceLabel`, builds the `pollUrl`, and renders `<StandingsWorkspace>` with plain props only. No `CompetitionConfig` object is passed to the client — only resolved `Occurrence[]`, `OccurrenceCapabilities`, initial `LiveResponse`, and `pollUrl`.

- [ ] **Step 3: Rewrite the league standings view as a thin wrapper**

`components/igc/league-standings-view.tsx` — replace the body with:

```tsx
import { StandingsWorkspaceServer } from '@/components/competition/standings-workspace-server'

export async function LeagueStandingsView({ leagueKey, week }: { leagueKey: 'mens' | 'womens'; week?: string }) {
  const competitionKey = leagueKey === 'mens' ? 'mens-league' : 'womens-league'
  return <StandingsWorkspaceServer competitionKey={competitionKey} initialOccurrenceId={week} />
}
```

- [ ] **Step 4: Page routes pass through unchanged in behavior**

`app/igc/mens-league/page.tsx` and `app/igc/womens-league/page.tsx` already render `<LeagueStandingsView leagueKey=... week=... />`; no change needed unless `searchParams` shape widened — widen the type to `Promise<{ week?: string; view?: string; scoring?: string; grouping?: string }>` and forward.

- [ ] **Step 5: Lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add components/competition/standings-workspace.tsx components/competition/standings-workspace-server.tsx components/igc/league-standings-view.tsx app/igc/mens-league/page.tsx app/igc/womens-league/page.tsx
git commit -m "feat(competition): StandingsWorkspace shell + server wrapper wiring"
```

---

## Phase 6 — Verification & Rollout

### Task 24: Playwright smoke tests

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

### Task 25: Full unit + lint suite green

- [ ] **Step 1: Run everything**

```bash
pnpm lint
pnpm test:unit
```
Expected: lint clean; all unit tests pass (existing + new `competition-*`).

- [ ] **Step 2: Fix any failures, then commit**

```bash
git add -A
git commit -m "test(competition): full unit + lint suite green"
```

---

### Task 26: Rollout & verification (manual, documented)

- [ ] **Step 1: Deploy** the branch; confirm the migration applies and the cron is registered in Vercel.

- [ ] **Step 2: Verify during the next Men's play window (Tuesday Pacific)**: open `/igc/mens-league`; current-week live results appear **without a manual sync**; Gross/Net toggles; unflighted Overall; LIVE badge; subtle refresh on background polls (no skeleton flashing).

- [ ] **Step 3: Verify after the next finalization**: within 24h, season points advance to the newly finalized week with no manual command; flights appear and the grouping filter works; badge becomes FINAL and slow-polls briefly then stops.

- [ ] **Step 4: Verify Women's** on its play day: live results appear, no tab bar, no grouping control, Gross/Net toggle present.

- [ ] **Step 5: Document results** in a short verification note appended to the spec file (or a PR description), including any deviations and follow-ups.

---

## Self-Review Notes

- **Spec coverage:** every spec section maps to a task — §1 root causes (Tasks 4, 16), §2 principles (Global Constraints), §3 event-state model (Tasks 2, 4), §4 live read path + active window + cache + compat handler (Tasks 5, 9, 11, 14, 15), §5 durable reconcile (Tasks 16–18), §6 generic domain (Tasks 3–8), §7 cron (Task 17), §8 UX (Tasks 19–23), §9 configs (Task 12), §10 file layout (matched), §11 migration/backfill (Tasks 2, 9, 13), §12 tests (Tasks 4–8, 10, 14, 18, 22, 24), §13 observability (Tasks 15, 17 logging), §14 rollout (Task 26), §15 out-of-scope (deferred generic tables — Task 13 note).
- **Placeholder scan:** Tasks 16 and 23 contain "port/wire" instructions rather than full code because the source logic already exists verbatim in the codebase (the sync script and the existing components). These are mechanical ports with explicit source line references, not unspecified work. Every new logic task has complete code + tests.
- **Type consistency:** `LiveResponse`, `Occurrence`, `Leaderboard`, `OccurrenceCapabilities`, `ScoringMode`, `EventFormat`, `DiscoveryState`, `ResultStatus`, `GroupingAvailability` are defined once in Task 3 and used consistently thereafter. `getLiveResults(competitionKey, occurrenceId, scoring)` signature is consistent across Tasks 15 and 17. `reconcileCompetition(competitionKey, softDeadlineMs)` consistent across Tasks 16–17.
- **Scope:** one plan, six phases, each task independently testable. The phases are sequential dependencies, not independent subsystems, so a single plan is appropriate.