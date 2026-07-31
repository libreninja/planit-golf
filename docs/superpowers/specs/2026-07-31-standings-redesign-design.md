# Standings Redesign — Live Tournament Experience + Reusable Competition Capability

**Date:** 2026-07-31
**Status:** Design — pending review
**Routes affected:** `/igc/mens-league`, `/igc/womens-league` (preserved)

## 1. Problem Summary (confirmed root causes)

### Bug 1 — Current live week absent during league play

The live-fetch mechanism (`fetchLeagueLiveResults`) works. The page never reaches it for the
active week because of two stacked gates in `components/igc/league-standings-view.tsx`:

```ts
const isTeamEvent = selectedEvent?.gg_tournament_id === null
const liveEligible = isActiveToday && !isTeamEvent && selectedWeek !== undefined
```

`gg_tournament_id IS NULL` is **overloaded**. The sync (`scripts/sync-igc-league.mjs:243-253`)
writes `gg_tournament_id: null` for two unrelated cases:

1. A genuine team/scramble week (no individual tournaments, ever).
2. An **upcoming round where GG hasn't created the individual tournaments yet** —
   `pickIndividualTournaments` returns `{gross:null, net:null}`, so the round falls into the
   same "no individual tournament" branch.

The sync processes every round in the season on each run (completed + live + upcoming). When it
last ran, it stamped the upcoming week's row `gg_tournament_id: null` because GG hadn't set up
that round's Gross/Net tournaments yet. The sync isn't re-run during play, so the misclassification
is never corrected. On play day, `selectDefaultEvent` picks the active-today row, but
`isTeamEvent === true` → `liveEligible === false` → the page renders `TeamEventState` instead of a
live leaderboard. **A null tournament ID is data absence, not an event type.**

Secondary: the entire live path is gated on a *persisted* `igc_league_events` row. The page never
discovers the active competition directly from GG; it only reads what the last manual sync wrote.

### Bug 2 — Season Points lag one finalized week

The snapshot rebuild (`sync-igc-league.mjs:437-500`) is correct and has **no off-by-one**.
`seasonCum` accumulates `event.season_points[].total_points` for every completed round; current
rank uses the full cumulative sum; previous rank uses `cumBeforeLast`. There is no stale-snapshot,
no cache (pages are `force-dynamic`), no previous-week identifier, and no `status`/`finalized`
filter in `getLeagueSeasonPointsFromDB`.

The accumulation is gated on one line:

```js
if (isCompleted && Array.isArray(results.event.season_points)) {   // line 382
```

The league sync is **manual only** (`pnpm sync:league`, by hand; no scheduled trigger exists).
When the sync runs before GG flips the just-played round to `status: 'completed'` (or before GG
populates that round's `event.season_points`), that round's points are skipped → snapshot reflects
through the prior week → one-week lag. Nothing guarantees re-sync after finalization.

### Common thread

Both bugs share one root: **the page trusts persisted sync state for everything, and the sync is
manual and infrequent.** Live discovery is gated on a synced row; season-points freshness is
gated on a synced-and-completed round.

## 2. Design Principles

1. **Live read path and durable reconciliation are separate concerns.** The live page must not
   depend on the durable pipeline being current; the historical/finalized system must not depend
   on ephemeral live API responses.
2. **A null external identifier is data absence, not a semantic classification.** Event format is
   modeled explicitly; it is never inferred from a nullable `gg_tournament_id`.
3. **Generic domain, specific adapters.** Shared code models competition/occurrence/scoring/
   grouping/result-status. "Week" and "Flight" are labels supplied by configuration, not domain
   primitives. No route-name or league-day checks in shared code.
4. **Capability-driven UI.** A control renders only when there is a meaningful choice. One view →
   no tab bar. One grouping → no grouping control. One scoring mode → no toggle.
5. **Server-side discovery, server-side coalescing.** All GG calls stay server-side. Client polling
   hits a planit.golf endpoint; the server coalesces/briefly caches upstream GG requests so N
   browsers polling every minute do not produce N upstream requests per minute.
6. **Idempotent reconciliation.** The CLI and the scheduled route call the same application logic.
   Re-running it is safe and cheap; unchanged competitions are skipped quickly.

## 3. Revised Event-State Model

Replace the overloaded-null classification with explicit, independently-stored fields on
`igc_league_events`. (This change reuses the existing `igc_league_*` tables; generic
`competition_*` tables are deferred — see §11. The adapter maps the existing tables onto the
generic domain types in §6.)

### New columns (additive migration)

```sql
ALTER TABLE igc_league_events
    ADD COLUMN event_format TEXT NOT NULL DEFAULT 'unknown'
        CHECK (event_format IN ('individual', 'team', 'unknown')),
    ADD COLUMN discovery_state TEXT NOT NULL DEFAULT 'pending'
        CHECK (discovery_state IN ('pending', 'discovered', 'inconclusive', 'failed')),
    ADD COLUMN discovered_at TIMESTAMPTZ;
```

### Fields and meanings

| Field | Values | Meaning |
|---|---|---|
| `status` (existing) | `upcoming`, `live`, `finalized` | Round lifecycle (when) |
| `event_format` (new) | `individual`, `team`, `unknown` | Whether the round has individual results (what) |
| `discovery_state` (new) | `pending`, `discovered`, `inconclusive`, `failed` | How confident we are in `event_format` |
| `gg_tournament_id` (existing) | nullable | The Net tournament id **hint**; null = "not linked", not "team" |

The five states the user requires map cleanly:

| Required state | Mapping |
|---|---|
| known individual event | `event_format='individual'`, `discovery_state='discovered'` |
| known team event | `event_format='team'`, `discovery_state='discovered'` |
| individual competitions not created / not yet discovered | `event_format='unknown'`, `discovery_state='pending'` |
| upcoming event | `status='upcoming'` (regardless of format) |
| unresolved/unknown event | `event_format='unknown'`, `discovery_state='inconclusive'` or `'failed'` |

### Classification rules

- **`event_format='individual'`** only after GG positively exposes ≥1 individual tournament for
  the round.
- **`event_format='team'` requires positive evidence** — never inferred from absence. It is set
  only when one of the following holds:
  1. GG exposes **explicit tournament/competition format metadata** identifying the round as
     team/side/scramble play, or
  2. An **explicit competition-config override** marks this occurrence as a known team format
     (e.g. a known scramble week listed in config).
  "No individual tournaments found" and round-name needles are **discovery hints only**; they must
  not independently prove `team`. Classifying `team` merely because GG exposes tournaments but none
  currently appear individual would recreate the same absence-as-semantics bug at a different
  layer.
- **`event_format='unknown'`** is the default and the honest state whenever discovery hasn't
  positively resolved the format. When GG exposes an **incomplete or ambiguous** tournament set,
  retain `event_format='unknown'` with `discovery_state='pending'` or `'inconclusive'`.
- **`discovery_state='inconclusive'`** when discovery ran but couldn't determine format (e.g.,
  tournaments endpoint returned an unexpected/ambiguous shape).
- **`discovery_state='failed'`** when discovery errored (upstream GG failure). Distinct from
  `inconclusive` so the UI can say "temporarily unavailable" vs. "couldn't determine."

The UI prefers "results are not available yet" over a false team classification.

### Backfill (existing rows)

A one-time backfill in the migration, conservative (never asserts `team` from a null id):

```sql
UPDATE igc_league_events
   SET event_format = 'individual'
 WHERE gg_tournament_id IS NOT NULL
   AND event_format = 'unknown';

-- Rows with null gg_tournament_id stay 'unknown' and are re-classified by the
-- reconciliation job's next discovery pass. Genuine team weeks will be positively
-- confirmed; misclassified upcoming rounds will be corrected to 'individual'
-- once GG exposes their tournaments.
```

The reconciliation job (§7) re-discovers `unknown` rows and corrects them.

## 4. Live Read Path

### Active-window model (not "today")

Shared competition code **never** defines "active" as calendar-date equality. `event_date ===
today` is a league-route convenience that must not leak into the generic layer. Activity is
determined from:

1. The **configured occurrence window** (a competition may span multiple days, hold multiple
   sessions in one day, run past midnight, or have delayed scoring after play concludes).
2. **Explicit upstream status** from GG (round/tournament status).
3. **Selected-occurrence context** (the occurrence the user is viewing).

`Occurrence` carries an `activeWindow: { start: string; end: string | null }` (timezone-aware, in
the competition's configured timezone). An occurrence is "active" when *now* falls within its
window **or** upstream status indicates in-progress scoring. Tuesday/Wednesday schedules remain
league-config heuristics for reconciliation effort, not the definition of liveness. Seattle Cup
multi-day occurrences stay live across their configured window.

### Discovery flow (server-side)

`lib/competition/discovery/golfgenius.ts` exports `discoverOccurrence(config, occurrence, opts)`:

1. **Resolve parent event** from competition config (`seasonId`, `categoryId`) via GG `/events`.
2. **Find the occurrence** by the configured active window / selected-occurrence context (not by
   `event_date === today`). Uses the config's timezone, not the server clock.
3. **Discover competitions** via GG `/events/{id}/rounds/{roundId}/tournaments`. Classify each
   tournament as individual/side/team using **explicit GG format metadata** where available;
   tournament names are hints only. Derive `event_format` strictly per §3 (positive evidence for
   `team`; ambiguity → `unknown`).
4. **Fetch results** for the individual tournaments and normalize into the shared result model
   (§6). Partial data is tolerated (one competition not yet scored → that competition is absent,
   not an error).
5. **Persisted IDs as hints**: if the row already carries `gg_event_id` / `gg_round_id` /
   `gg_gross_tournament_id` / `gg_net_tournament_id`, use them to skip step 1–3 and go straight to
   results. If those results come back empty/errored, fall back to full discovery. Persisted IDs
   never gate *whether* to attempt discovery.

### Active-event rendering decision

For the selected occurrence, the server returns enough state for the client to render honestly
without re-deriving:

- `resultStatus`: `live` | `final` | `not_started` | `unknown`
- `eventFormat`: `individual` | `team` | `unknown`
- `discoveryState`: `pending` | `discovered` | `inconclusive` | `failed`

UI behavior for an **active** occurrence:

| `eventFormat` / `discoveryState` | Render |
|---|---|
| `individual` / `discovered` | Live leaderboard (Gross/Net toggle, unflighted Overall while live) |
| `team` / `discovered` | Team-event state (only after positive GG confirmation) |
| `unknown` / `pending` | Loading skeleton ("Looking for live results…") — **never** "Team event" |
| `unknown` / `inconclusive` | "Live results aren't available yet." (honest, retry) |
| `unknown` / `failed` | "Live results are temporarily unavailable." + manual retry |

The team-event state is shown **only** when `eventFormat='team'` AND `discoveryState='discovered'`.
A null persisted tournament ID never produces it.

### Server-side coalescing / caching

Client polling must not create proportional upstream GG load.

- **Short-TTL result cache** keyed by `(competitionKey, occurrenceId, scoringMode?)`, TTL ~60s,
  stored in a `competition_live_cache` table. The live API route serves from cache; on miss it
  fetches GG and populates.
- **Discovery cache** keyed by `(competitionKey, occurrenceId)`, TTL ~120s, caches the
  tournament-discovery payload so the format classification isn't re-derived on every poll.
- **Stale-while-error**: on GG failure, serve the last good cached result with a "showing last
  known" flag rather than 502, when available.
- **In-flight de-duplication (in-process single-flight)**: concurrent requests within one process
  for the same key share one upstream fetch via a promise map. This is **guaranteed within a single
  instance** and is what the unit test proves.
- **Cross-instance coalescing is best-effort.** The DB cache prevents most repeated calls after
  the first write, but two cold instances that miss simultaneously can both call GG before either
  has written. The guarantee is therefore **~1 upstream GG request per TTL window under normal
  operation, with possible duplicate requests during concurrent cold misses** — not "exactly one."
  If strict single-flight across instances is ever required, add a Postgres advisory lock / lease
  around cache fills (a documented future option, not built now).
- **Throttling**: a per-competition upstream concurrency cap (one outstanding GG fetch per key per
  instance).

The client polls the planit.golf endpoint every ~60s while live (paused when the tab is hidden).
Each poll hits cache; under normal operation ~1 upstream GG request per 60s per competition,
regardless of client count.

#### `competition_live_cache` schema

```sql
CREATE TABLE competition_live_cache (
    cache_key        TEXT NOT NULL PRIMARY KEY,   -- see key composition below
    competition_key  TEXT NOT NULL,
    occurrence_id    TEXT NOT NULL,
    scope            TEXT NOT NULL CHECK (scope IN ('results','discovery')),
    payload          JSONB NOT NULL,              -- normalized result model / discovery
    result_status    TEXT,                        -- 'live' | 'final' | ... (results rows only)
    fetched_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at       TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_competition_live_cache_expires ON competition_live_cache(expires_at);
ALTER TABLE competition_live_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can read live cache" ON competition_live_cache FOR SELECT USING (true);
-- Writes are service-role only (server routes), so no public write policy.
```

- **Cache key composition**: every key includes `competitionKey`, `occurrenceId`, `scope`
  (`results`/`discovery`), and `scoringMode` (for results). Keys are competition-scoped so no
  competition reads another's cache.
- **Expiration / cleanup**: reads filter `expires_at > now()`. A cheap cleanup runs from the
  hourly reconciliation route (`DELETE WHERE expires_at < now() - interval '1 day'`) so expired
  rows don't accumulate.
- **Tenant-sensitive data**: cached payloads are the normalized public result model — the same
  data the public live route already returns. They contain **no auth/PII beyond what the public
  endpoint already exposes** (player names, scores, points, purse — all already public on the
  standings page). The service role writes; public reads via RLS, identical to the existing
  `igc_league_*` read posture.

### Live API route (compatibility handler, not a redirect)

The generic endpoint is `/api/competition/live?competition=<key>&occurrence=<id>`, auth-gated as
today, returning the normalized result model + `resultStatus` + `eventFormat` + `discoveryState`.
No client ever receives a raw "team event" verdict from a null id.

The existing `/api/igc/league/live` route is kept for one release as a **thin compatibility
handler**, not an HTTP redirect. A shared handler is simpler and safer than a redirect because it
avoids verifying redirect-following behavior, query-param translation, auth parity, and
caching-semantics preservation. The compatibility handler:

1. parses the legacy params (`league=mens|womens`, `week=N`),
2. maps them to the generic request (`competition=mens-league|womens-league`, `occurrence=<id
   derived from week>`),
3. invokes the **same** `getLiveResults(config, occurrence)` function the generic route calls,
4. returns the same normalized response shape the old route returned (so existing fetch clients
   keep working unchanged).

The compatibility route is removed in a later cleanup.

## 5. Durable Reconciliation Path

### Decompose the monolithic sync

`scripts/sync-igc-league.mjs` becomes a thin CLI wrapper around reusable application logic in
`lib/competition/reconcile/`. The CLI and the scheduled route (§7) call the same functions.

- `lib/competition/reconcile/discover.ts` — discover an occurrence's competitions and classify
  `event_format` / `discovery_state`. Updates `igc_league_events` (and the generic analogue).
- `lib/competition/reconcile/import.ts` — import a finalized occurrence's performances + results
  (both competitions, one scorecard fact).
- `lib/competition/reconcile/season-points.ts` — rebuild the cumulative season-points snapshot for
  a competition. **Keeps the completed-round guard**: a round's points are only summed when GG
  exposes authoritative finalized `event.season_points`.
- `lib/competition/reconcile/reconcile.ts` — `reconcileCompetition(config, opts)`: decides which
  occurrences need work and calls the functions above. Idempotent.

### Reconciliation behavior

`reconcileCompetition(config)`:

1. Loads the competition's occurrences (from DB and/or GG).
2. For each occurrence classifies it:
   - **Active** (`status='live'` or event_date is today per config timezone): cheap discovery
     pass to keep `event_format` fresh. Does **not** require full import.
   - **Recently completed** (finalized within a configurable window, e.g. 72h): import results and
     rebuild season points. Re-checks on every run until points are captured.
   - **Awaiting finalization** (played but not yet `completed` in GG): re-check on each run; once
     GG finalizes, import + rebuild.
   - **Older / unchanged**: skip, or cheaply inspect `updated_at`/`scored_at` and skip if
     unchanged.
3. Updates `event_format` / `discovery_state` / `discovered_at` from discovery.
4. Rebuilds season-points snapshot when a newly-finalized round is imported.

**Completed-round guard stays.** The job does not remove the guard to make points appear sooner;
it ensures the job *runs again* after finalization so the guard passes naturally.

### Idempotency

- Upserts keyed by natural keys (already the case: `league_key,week_number,member_card_id,competition`).
- Season-points snapshot is delete+upsert per competition per run (already the case) — re-running
  produces the same rows.
- Discovery is read-only on GG, write-only on the `event_format`/`discovery_state` columns.
- Re-running the job on unchanged data performs only cheap existence/`updated_at` checks.

### Season points freshness guarantee

With hourly reconciliation, a finalized round's points are captured on the first run after GG
finalizes — well within 24h, no human intervention. The page is `force-dynamic`, so the next page
load reflects the new snapshot. No per-page timestamp is shown (per the product spec); the data
simply refreshes.

## 6. Generic Competition Domain

New module `lib/competition/` (the GG-specific code lives in `lib/competition/adapters/golfgenius.ts`
and the existing `lib/gg/`). Existing `lib/igc/weekly-results.ts` view-model types become thin
aliases / are produced by the adapter from the generic types so the UI layer is source-agnostic.

### Domain types (`lib/competition/types.ts`)

```ts
// A configured competition (Men's League, Women's League, Seattle Cup…)
export interface CompetitionConfig {
  key: string                       // 'mens-league' | 'womens-league' | 'seattle-cup'
  label: string                     // "Men's League"
  adapter: 'golfgenius'             // extensible
  adapterConfig: CompetitionAdapterConfig
  navigation: NavigationOptions      // labels an occurrence as "Week", etc.
  capabilities: CompetitionCapabilities
  schedule?: CompetitionSchedule    // timezone + play windows, for reconciliation heuristics
}

export type EventFormat = 'individual' | 'team' | 'unknown'
export type DiscoveryState = 'pending' | 'discovered' | 'inconclusive' | 'failed'
export type ResultStatus = 'live' | 'final' | 'not_started' | 'unknown'

// An occurrence: a round / week / session / stage. Generic; labeled by config.
export interface Occurrence {
  id: string                        // stable within the competition
  number: number | null             // "Week 18" — label/number is config-driven
  label: string                     // "Week 18 – Open Championship" (resolved server-side)
  date: string | null               // ISO date (timezone-aware, competition tz)
  activeWindow: { start: string; end: string | null }  // tz-aware; see §4 active-window model
  format: EventFormat
  discoveryState: DiscoveryState
  resultStatus: ResultStatus
}

export type ScoringMode = 'gross' | 'net' | string  // extensible beyond gross/net

// A grouping dimension: flight / division / bracket / Overall. Labeled by config.
export interface Grouping {
  key: string                       // 'A' | 'B' | 'C' | 'overall'
  label: string                      // "Flight A" | "Overall"
}
export type GroupingAvailability =
  | { kind: 'none' }                 // no meaningful grouping (women's Overall-only)
  | { kind: 'single'; grouping: Grouping }
  | { kind: 'multi'; groupings: Grouping[]; defaultAll: boolean }

export interface ScoringModeAvailability {
  modes: ScoringMode[]              // [] or [gross] → no toggle; [gross, net] → toggle
}

// What the UI may show for this competition/occurrence.
export interface CompetitionCapabilities {
  views: View[]                     // ['season','weekly'] for men's; ['weekly'] for women's
  scoring: ScoringModeAvailability  // drives the Gross/Net toggle
  supportsLiveResults: boolean
  supportsEventNavigation: boolean  // drives prev/next + dropdown
}

// Capabilities can vary by occurrence status (groupings appear only after final).
export interface OccurrenceCapabilities extends CompetitionCapabilities {
  groupings: GroupingAvailability   // 'none' while live; 'multi' once finalized (men's)
}

export interface ResultEntry {
  key: string
  name: string
  positionLabel: string | null
  positionOrder: number
  points: number | null
  purse: string | null
}
export interface Scorecard { /* unchanged from WeeklyScorecard, generalized */ }
export interface Leaderboard {
  occurrenceId: string
  scoringMode: ScoringMode
  grouping: Grouping | null          // null = all players / Overall
  entries: ResultEntry[]
  scorecards: Scorecard[]            // deduped per participant
}
export type View = 'season' | 'weekly' | string
```

### Navigation options (`navigation`)

```ts
export interface NavigationOptions {
  occurrenceNoun: 'week' | 'session' | 'round' | 'stage' | string
  queryParam: string                        // 'week' (league) — the URL param name
  // Declarative label rule the SERVER applies to produce Occurrence.label; no
  // functions cross the server/client boundary (see "Config serialization" below).
  labelRule: { kind: 'numberPrefix'; noun: string } | { kind: 'event_name' }
}
```

### Config serialization (server-only vs client-passable)

`CompetitionConfig` contains **functions and adapter secrets** that cannot cross a Next.js
server/client boundary and must not be shipped to the browser:

- **Server-only** (never passed to client components): `adapterConfig` (GG ids, secrets),
  `schedule`, `navigation.labelRule` (interpreted server-side to produce `Occurrence.label`),
  and any adapter behavior.
- **Client-passable** (plain serializable data): the **resolved** `Occurrence` (with `label`
  already computed), `OccurrenceCapabilities`, `Leaderboard`, `ResultEntry`, `Scorecard`,
  `Grouping`, `View`, `ScoringMode`, status enums.

The server resolves all display labels (occurrence labels, grouping labels) into plain strings
before handing data to `<StandingsWorkspace>`. Client components receive only plain data +
capabilities; they never import `CompetitionConfig` or call config functions. This keeps the
shared UI free of league-schema and adapter assumptions.

### Capabilities → UI rules (single source of truth)

| Capability | UI effect |
|---|---|
| `views.length > 1` | Tab bar shown |
| `views.length === 1` | No tab bar; that view is the page content |
| `scoring.modes.length > 1` | Gross/Net toggle shown |
| `scoring.modes.length <= 1` | No toggle |
| `groupings.kind === 'multi'` | Grouping filter shown (All / A / B / C…) |
| `groupings.kind !== 'multi'` | No grouping control |
| `supportsLiveResults` | Live polling + LIVE/FINAL badge |
| `supportsEventNavigation` | Prev/next + dropdown |

## 7. Scheduled Reconciliation

**One generic cron, fixed cadence, runtime-driven competition list.** Not "league-config-derived
cron schedules" (Vercel cron is deployment config, not runtime-generated).

- `vercel.json` adds a single cron hitting `/api/cron/reconcile` hourly (off-:00 minute, e.g.
  `13 * * * *`). The route is auth-gated by a `CRON_SECRET` header/env check.
- The route calls `reconcileAllCompetitions()`, which loads the set of configured competitions
  from a registry (`lib/competition/registry.ts`) and calls `reconcileCompetition(cfg)` for each.
- Each competition's `schedule` (timezone + play windows) is used only as a heuristic to spend more
  effort on active/recent events and skip idle ones — not to hardcode Tuesday/Wednesday in shared
  code. The schedule is part of config, so Men's (Tuesday Pacific) and Women's (Wednesday Pacific)
  express their play days there; Seattle Cup would express its own.
- Reconciliation is safe to run at any hour; the schedule only affects how aggressively each
  occurrence is re-checked.

### `/api/cron/reconcile`

- `export const dynamic = 'force-dynamic'`. **Do not rely on a stated default `maxDuration`.** The
  implementation plan verifies the deployment plan's actual execution budget (Vercel function
  timeout for the cron route) and sizes work to fit, with resumability/bounding so a timeout never
  leaves the run half-applied.
- Auth: `if (req.headers.get('authorization') !== \`Bearer ${process.env.CRON_SECRET}\`) 401`.
- **Bounded work per run** — never an unbounded full-season sync in one request. Each run processes
  only occurrences that are **active, unresolved (`event_format='unknown'` / `discovery_state !=
  'discovered'`), or recently completed** (within a configurable window, e.g. 72h). Older/unchanged
  occurrences get at most a cheap `updated_at`/`scored_at` inspection and are skipped.
- **Resumable + budget-aware**: the route tracks an execution budget (a soft deadline well below
  the verified `maxDuration`). It stops before the budget expires, leaving unfinished work eligible
  for the next hourly run. Progress is naturally resumable because every step is an idempotent
  upsert keyed by natural keys — a re-run picks up where it left off with no duplicates.
- **Failure isolation per competition**: one competition's error is caught, logged with the
  competition key, and does not abort the run.
- Logs a structured summary each run: competitions processed, occurrences
  discovered/imported/skipped, season-points rebuilds, soft-deadline stops, errors.

## 8. UX Redesign

### Shell: `StandingsWorkspace` (`components/competition/standings-workspace.tsx`)

Persistent header + controls, one table below. URL is the source of truth for `view`, `occurrence`,
`scoring`, `grouping`; `scoring` preference is also persisted to `localStorage`.

```
────────────────────────────────────────────────
Standings                              [LIVE] / [FINAL]
[ Season ] [ Weekly / Live ]      ← only if >1 view
────────────────────────────────────────────────
< Prev   Week 18 – Jul 28 ▼   Next >   ← only if supportsEventNavigation
( Gross ) ( Net )                      ← only if >1 scoring mode
( All ) ( A ) ( B ) ( C )              ← only if groupings.kind === 'multi'
────────────────────────────────────────────────
Leaderboard (one table, fills available space)
────────────────────────────────────────────────
```

### Controls

- **Tabs** (`Season` / `Weekly · Live`): rendered only when `views.length > 1`. Women's renders
  none. The selected tab is `?view=`.
- **Occurrence nav**: `< Prev | Week 18 – Jul 28 ▼ | Next >`. Dropdown lists occurrences
  most-recent first, with the occurrence label (`Week 18 – Open Championship`). Prev/Next move
  through available occurrences and are disabled at the ends. URL: `?occurrence=` (kept as
  `?week=` on league routes for bookmark compatibility — the component reads/writes the
  config-declared query param name).
- **Scoring toggle**: Gross/Net. URL: `?scoring=`. Persisted to a **competition-scoped**
  `localStorage` key (`standings:${competitionKey}:scoring`) so the preferred mode survives across
  visits. The stored value is validated against the occurrence's available modes before use.
  Hidden when ≤1 mode.
- **Grouping filter**: `All / Flight A / B / C`. URL: `?grouping=`. Hidden while live (groupings
  aren't known) and hidden entirely when `groupings.kind !== 'multi'`. While live the leaderboard
  is unflighted Overall regardless.
- **Status badge**: `LIVE` (pulsing) or `FINAL`, derived from `resultStatus`. No timestamp. Shown
  only when `supportsLiveResults`.

### Table

- One table at a time. Columns adapt to the scoring mode (Gross par / Net par, Gross / Net total,
  Thru, Points, Purse) — same column set as today, generalized. Expandable hole-by-hole scorecard
  per participant (reused from current `Scorecard`).
- Loading skeleton **only on initial load or when no usable result exists**; background refreshes
  keep the table visible with a subtle refreshing indicator (see "Refresh visual state" above).
  Empty state (no results yet) and error/unavailable state per §4. Team-event state only on
  positive team classification.
- Mobile: controls stack; occurrence nav remains a single row (prev / dropdown / next); no
  horizontal scroll on the table (rows stack on mobile as today).

### URL + persistence contract

| Param | Source | Example |
|---|---|---|
| `view` | URL | `season` / `weekly` |
| `week` (league) / `occurrence` (generic) | URL | `18` |
| `scoring` | URL + `localStorage` | `gross` / `net` |
| `grouping` | URL | `all` / `A` / `B` / `C` |

On load: read URL params; if `scoring` absent, fall back to `localStorage`, then to the
competition default. On change: update URL (replaceState, no scroll) and write `scoring` to
`localStorage`.

**Namespaced + validated preference.** The localStorage key is **competition-scoped**:
`standings:${competitionKey}:scoring` (e.g. `standings:mens-league:scoring`) — never a single
global `standings.scoring` key. Before applying a stored preference, **validate it against the
current occurrence's available scoring modes**; a preference from one competition must never
select an unsupported mode in another. An invalid/stale stored value is ignored in favor of the
occurrence default.

### Live polling lifecycle (client)

A **bounded post-finalization refresh policy** avoids requiring a page reload during the Live →
Final transition without polling archived data indefinitely. GG may report an event as final
before all finalized competitions, flights, score corrections, or durable-reconciliation outputs
are available, so there is a short transition window.

- **While Live** (`resultStatus === 'live'`): poll `/api/competition/live` approximately every
  **60s**; pause when the tab is hidden.
- **On Live → Final transition** (a poll returns `resultStatus === 'final'`): swap the badge to
  `FINAL`, enable grouping filters, and **continue polling slowly — approximately every 5
  minutes** — without a page reload.
- **Stop the slow poll** when the first of these occurs:
  - the response indicates finalized groupings/results are available **and** durable
    reconciliation is confirmed current (the endpoint exposes a `durableCurrent: true` flag), or
  - a bounded period expires — **1–2 hours** after finalization.
- **Historical finalized events** selected later (not the one just transitioned) do **not**
  auto-poll. Page load + the manual "Refresh now" action suffice for archived data.
- **Manual Refresh** remains available on finalized events.

The goal is not to poll archived data indefinitely; it is to avoid a page reload during the
Live → Final transition.

### Refresh visual state (no skeleton flashing)

- **Full loading skeleton** is reserved for **initial load** or when **no usable result** is
  available yet.
- **During a background refresh** (live 60s poll, or post-final slow poll), the existing
  leaderboard stays visible. Show a **subtle refreshing indicator** (e.g. a faint shimmer on the
  status row or a dimmed "Refreshing…" affordance), not a skeleton replacement.
- **Stale-while-error**: if a poll fails, keep the last good leaderboard visible with a "showing
  last known" note — do not blank the table.

## 9. Configurations

### Men's League (`lib/competition/configs/mens-league.ts`)

```ts
{
  key: 'mens-league',
  label: "Men's League",
  adapter: 'golfgenius',
  adapterConfig: { seasonId, categoryId, seasonPointsCategoryId, eventFilter: 'mens' },
  navigation: { occurrenceNoun: 'week', queryParam: 'week', labelRule: { kind: 'numberPrefix', noun: 'Week' } },
  capabilities: {
    views: ['season', 'weekly'],
    scoring: { modes: ['gross', 'net'] },
    supportsLiveResults: true,
    supportsEventNavigation: true,
  },
  schedule: { timezone: 'America/Los_Angeles', playDay: 2 }, // Tuesday; heuristic only
}
```

Groupings: `none` while live → `multi` ([All, Flight A, B, C]) once finalized.

### Women's League (`lib/competition/configs/womens-league.ts`)

```ts
{
  key: 'womens-league',
  label: "Women's League",
  adapter: 'golfgenius',
  adapterConfig: { seasonId, categoryId, eventFilter: 'womens' },
  navigation: { occurrenceNoun: 'week', queryParam: 'week', labelRule: { kind: 'numberPrefix', noun: 'Week' } },
  capabilities: {
    views: ['weekly'],                 // → no tab bar
    scoring: { modes: ['gross', 'net'] },
    supportsLiveResults: true,
    supportsEventNavigation: true,
  },
  schedule: { timezone: 'America/Los_Angeles', playDay: 3 }, // Wednesday; heuristic only
}
```

Groupings: `single` (Overall) always → no grouping control. No season dataset → no Season tab.

### Seattle Cup seam (not implemented now)

A future `lib/competition/configs/seattle-cup.ts` + `SeattleCupAdapter` consumes the same
foundation. It may declare `occurrenceNoun: 'session'`, groupings as divisions/teams/brackets,
scoring modes beyond gross/net, and a different schedule. Shared UI reads capabilities; no league
assumptions are baked in. The seam is proven by the abstraction, not by pre-implementing Seattle
Cup requirements.

## 10. File / Module Layout

```
lib/competition/
  types.ts                    # domain types (§6)
  registry.ts                 # competition registry (mens, womens)
  configs/
    mens-league.ts
    womens-league.ts
  adapters/
    golfgenius.ts             # discover, normalize, reconcile against generic types
  discovery/
    golfgenius.ts             # discoverActiveOccurrence + classification
  reconcile/
    discover.ts               # occurrence format/discovery classification (durable)
    import.ts                 # import finalized results
    season-points.ts          # rebuild snapshot (completed-round guard kept)
    reconcile.ts              # reconcileCompetition / reconcileAllCompetitions
  cache.ts                    # short-TTL result + discovery cache (DB-backed)
  capabilities.ts             # derive OccurrenceCapabilities from config + occurrence status

components/competition/
  standings-workspace.tsx     # shell: tabs/no-tabs, controls, table slot
  occurrence-nav.tsx           # prev/next + dropdown
  scoring-toggle.tsx
  grouping-filter.tsx
  leaderboard.tsx             # one table, scoring+grouping filtered
  scorecard.tsx               # expandable (reused from current)
  status-badge.tsx            # LIVE / FINAL
  states.tsx                   # loading skeleton, empty, error, team-event

app/api/
  competition/live/route.ts    # live read endpoint (coalesced)
  cron/reconcile/route.ts      # scheduled reconciliation

scripts/
  sync-igc-league.mjs          # thin CLI → lib/competition/reconcile
```

`lib/igc/weekly-results.ts` keeps the existing DB read functions, now producing generic types;
`components/igc/league-standings-view.tsx` becomes a thin server wrapper that resolves the
competition config from the route and renders `<StandingsWorkspace>`.

## 11. Migration / Backfill

1. Additive migration adds `event_format`, `discovery_state`, `discovered_at` to
   `igc_league_events` (§3). No existing column dropped/retyped.
2. Backfill: rows with non-null `gg_tournament_id` → `event_format='individual'`; all others stay
   `'unknown'` for the reconciler to re-classify. (Never asserts `team` from a null id.)
3. First reconciliation run corrects misclassified upcoming rounds (→ `individual` once GG exposes
   tournaments) and positively confirms genuine team weeks (→ `team`).
4. The generic `competition_occurrences` / `competition_results` tables are **not** introduced in
   this change — the existing `igc_league_*` tables are reused and the adapter maps them to the
   generic types. Renaming/introducing generic tables is deferred to keep this change focused; the
   adapter boundary means it can happen later without touching the UI.
5. **No league-schema leakage into shared UI.** The implementation plan must enforce that
   `components/competition/*` and `lib/competition/types.ts` depend only on the generic domain
   types — never on `igc_league_*` shapes, `league_key`, `week_number`, `flight_name`, or GG field
   names. All mapping happens in the adapter (`lib/competition/adapters/golfgenius.ts`) and the
   server wrapper. The shared UI is source-agnostic by construction, so introducing generic tables
   later touches only the adapter, not the UI.

## 12. Automated Tests

Unit (Node test runner, alongside `lib/igc/event-selection.ts` tests):

1. Active event **with** persisted tournament IDs → live leaderboard served from cache.
2. Active event **without** persisted tournament IDs but discoverable in GG → live leaderboard via
   full discovery; `event_format` becomes `individual`.
3. Confirmed team event — **only with positive evidence** (explicit GG format metadata or config
   override) → `event_format='team'`, UI shows team state.
4. Unresolved active event (discovery inconclusive) → `discovery_state='inconclusive'`, UI shows
   "not available yet" — never team state.
5. Upcoming event whose competitions haven't been created → `event_format='unknown'`,
   `discovery_state='pending'`, UI shows loading — never team state.
6. **Ambiguous GG tournament data does not classify an event as team** — GG exposes tournaments
   but none are positively individual and no explicit team-format metadata is present → stays
   `event_format='unknown'`, `discovery_state='inconclusive'`/`'pending'`; UI shows "results not
   available yet", never team state.
7. Live → Final transition: a poll returns `resultStatus='final'` → badge swaps to FINAL, grouping
   filters appear, and a **bounded slow poll (~5 min) continues** until finalized groupings are
   available + `durableCurrent:true` (or the 1–2h bound expires); no page reload.
8. **Live data stays visible during a background refresh without skeleton flashing** — a 60s live
   poll or a post-final slow poll keeps the existing leaderboard mounted; only a subtle refreshing
   indicator shows. Skeleton appears solely on initial load / no-usable-result.
9. **Historical Final events do not poll** — selecting an already-finalized occurrence (not the one
   just transitioned) results in zero auto-poll; manual Refresh remains.
10. Season Points reconciliation after **delayed** GG finalization: round played but not `completed`
    → snapshot unchanged; once GG `completed` + `season_points` populated → next reconcile imports
    and snapshot advances. Completed-round guard preserved.
11. Repeated reconciliation is idempotent: two consecutive runs produce identical
    `igc_league_season_points` rows and identical performance/result rows.
12. Women's League: `< 2 views` → no tab bar; `groupings.kind !== 'multi'` → no grouping control;
    Gross/Net toggle present.
13. Men's League: while live, `groupings` is `none` (unflighted Overall); once finalized,
    `groupings` becomes `multi` ([All, A, B, C]) and the filter appears.
14. **Scoring preference is isolated per competition** — `standings:mens-league:scoring` does not
    affect `womens-league`; a stored value not in the occurrence's available modes is ignored.
15. **In-process single-flight** (unit): N concurrent in-process `/api/competition/live` requests
    for one key within a TTL window → exactly one upstream GG fetch (promise-map de-dup).
16. **Cross-instance cold miss** (DB integration, documents the chosen guarantee): two simultaneous
    cache misses on separate workers — either a distributed lock serializes them to one upstream
    fetch, **or** the test documents this implementation as best-effort and asserts only that each
    worker serves a correct response (duplicate upstream fetches are permitted). The spec does not
    promise single-flight across instances unless a lock is implemented.
17. **Multi-day occurrence stays live across its configured active window** — an occurrence whose
    `activeWindow` spans >1 day is treated as live for the whole window, not just its start date.
18. **Legacy API route returns compatibility responses without redirect** — `/api/igc/league/live`
    parses legacy params, maps to the generic request, calls the shared `getLiveResults`, and
    returns the normalized response directly (no 3xx, no client redirect following required).

Playwright smoke (extend `tests/smoke.spec.ts`):

- Men's standings: tabs present, occurrence dropdown navigates, Gross/Net toggle updates the
  table, LIVE/FINAL badge renders.
- Women's standings: no tab bar, no grouping control, Gross/Net toggle present, occurrence nav
  present.

## 13. Operational Observability

- `/api/cron/reconcile` logs a structured summary each run: competitions processed, occurrences
  discovered/imported/skipped, season-points rebuilds, errors. Errors per competition are isolated
  and logged with the competition key.
- Live route logs cache hit/miss and upstream GG failures; on failure it serves stale-while-error
  and logs the degradation.
- Existing `console.error` paths in the live fetch are preserved/standardized; a future Sentry
  integration can hook the isolated-error pattern.

## 14. Rollout & Verification

1. Land the additive migration + backfill; run a one-off reconcile to classify existing rows.
2. Ship `lib/competition/reconcile/*` + CLI wrapper; verify `pnpm sync:league mens` / `womens`
   still produces identical results to the old script (parity check on one week).
3. Ship the live read path + `/api/competition/live` (coalesced); keep `/api/igc/league/live` as a
   thin compatibility handler that calls the same function (no redirect).
4. Ship `StandingsWorkspace` + controls on `/igc/mens-league` and `/igc/womens-league`.
5. Add the hourly cron + `CRON_SECRET`; verify it runs and is idempotent.
6. **Verify during the next Men's play window** (Tuesday Pacific): current-week live results
   appear without a manual sync, Gross/Net toggles, unflighted Overall.
7. **Verify after the next finalization**: season points advance to the newly finalized week
   within 24h with no manual command; flights appear and the grouping filter works.
8. **Verify Women's** on its play day: live results appear, no tab bar, no grouping control.

## 15. Out of Scope / Deferred

- Generic `competition_*` tables (the adapter maps existing `igc_league_*` tables for now).
- Seattle Cup implementation (only the seam is established).
- A per-competition `finalRefreshMs` slow-poll for finalized events (zero-poll is the default).
- Removing/renaming `gg_tournament_id` (kept as a hint; only its *semantic load* is removed).