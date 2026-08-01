# Migration baseline squash — verification + reconciliation

> Status: local verification complete. Production is NOT touched. Remote
> reconciliation is proposed below for **separate approval**.
>
> The baseline now folds in the deployed assistant tables
> (`assistant_proposals`, `assistant_proposal_ops`) — see "Assistant tables"
> below. The schema comparison is clean: only the expected diffs remain.
>
> Canonical `supabase start`/`db reset` is blocked on this machine by a local
> CLI double-apply defect — see `docs/supabase-cli-double-apply-defect.md`. The
> SQL chain itself is verified by single application via `psql` against a blank
> local Supabase DB.

## Canonical repository state

```
supabase/migrations/
  20260731000000_baseline.sql                  # squashed prod schema (004–025)
  20260731000001_igc_league_event_format.sql   # forward Standings (was 026)
  20260731000002_competition_live_cache.sql    # forward Standings (was 027)
supabase/migrations-archive/                   # 001–025 historical (non-executable)
supabase/seed.sql                              # checkpoints, community, club
```

## Local verification method

1. Fresh blank local Supabase DB: `supabase stop` + volume removal + empty-dir
   `supabase start` (0 public tables, platform schema only).
2. Single `psql -f` application of `20260731000000_baseline.sql`,
   `20260731000001_…`, `20260731000002_…`, then `seed.sql` — each with
   `ON_ERROR_STOP=1`. All four exited 0.

## Schema comparison vs production (pulled 2026-07-31)

Compared tables, columns, functions, triggers, policies, FKs, indexes, and
RLS status against `/tmp/prod-schema/`.

| Object | Result |
|---|---|
| Tables | local 48 vs prod 48 → diff is only the expected table-level diffs below |
| Columns | local 499 vs prod 488 → diff is only the expected table-level diffs below |
| Functions | **exact match** (7 functions; arg lists render with/without `DEFAULT` suffix, same functions) |
| Triggers | **exact match** (10 `*_updated_at` triggers, 1:1 on the same 10 tables) |
| FKs | **exact match** (60) |
| Policies | local 59 vs prod 61 → prod-only the 2 `gh_trigger_log` policies, local-only 0 |
| Indexes | local 142 vs prod 139 → prod-only `gh_trigger_log_pkey`, local-only the 027 + 026 indexes below |
| RLS | prod-only `gh_trigger_log`, local-only `competition_live_cache` (both expected); every other table matches |

### Diff summary

| Diff | Direction | Expected? |
|---|---|---|
| `gh_trigger_log` (+ 6 columns, `gh_trigger_log_pkey`, 2 policies) | in prod, absent locally | ✅ Expected — external/non-Planit, excluded by design |
| `competition_live_cache` (+ 11 columns, 3 indexes) | local only (from 027) | ✅ Expected — forward Standings migration |
| `igc_league_events` 7 columns + CHECK constraints + `idx_league_events_format_state` | local only (from 026) | ✅ Expected — forward Standings migration |
| `assistant_proposals` + `assistant_proposal_ops` | **match** (folded into baseline) | ✅ Resolved — see below |

There is **no remaining assistant-table/column/policy/index/RLS diff**.

### Assistant tables (resolved: folded into the baseline)

`assistant_proposals` and `assistant_proposal_ops` are Planit-owned objects
that already exist in production (deployed from `feature/assistant-phase-a` via
`026_assistant_proposals.sql`, commit `0c94e4f`). They are therefore part of the
canonical production baseline, not a separate forward migration. The baseline
now answers "what schema does a fresh Planit database need to represent
everything already deployed?", not "what schema existed on the branch where the
squash was authored."

The DDL appended to `20260731000000_baseline.sql` was verified byte-for-byte
against production (2026-07-31) and matches: 2 tables, 3 FKs
(`author_user_id`→`auth.users` CASCADE, `superseded_by`→`assistant_proposals`
SET NULL, `proposal_id`→`assistant_proposals` CASCADE), 7 CHECK constraints
(`op_type`, `source_kind`, `status`, `turn_intent`, `confidence`,
`human_decision`, `apply_status`), 2 non-PK indexes, RLS enabled on both, 5
policies (4 "Authors … own proposals" + "Owners manage own proposal ops"), no
publication membership, no triggers, no functions.

#### Branch-integration note (for when `feature/assistant-phase-a` reconciles)

`026_assistant_proposals.sql` is **historical schema now represented by the
baseline**. When `feature/assistant-phase-a` is reconciled with the baseline
branch:

- **Keep** the assistant application code.
- **Drop/archive** its obsolete executable `026_assistant_proposals.sql` (do
  **not** re-merge it into `supabase/migrations/`; it would attempt to recreate
  objects the baseline already defines).
- **Do not** make the old assistant migration idempotent to "solve" the
  re-merge — it has become historical schema.
- Resolve its migration numbering against the canonical timestamped chain
  (`20260731…`).
- Verify its expected schema already exists in the baseline (it does — this
  comparison confirms it).

## 026 behavior (igc_league_event_format)

- 7 columns present on `igc_league_events`: `event_format`, `discovery_state`,
  `gg_tournament_id`, `discovered_at`, `source_version`, `durable_source_version`,
  `durable_imported_at`.
- CHECK constraints: `event_format IN (individual, team, unknown)`;
  `discovery_state IN (pending, discovered, inconclusive, failed)`.
- Backfill `UPDATE … event_format='individual', discovery_state='discovered'
  WHERE gg_tournament_id IS NOT NULL` → affected 0 rows (correct on a fresh DB
  with no `igc_league_events` rows).
- Index created. Exit 0.

## 027 behavior (competition_live_cache)

- Table created; two indexes; `ALTER TABLE … ENABLE ROW LEVEL SECURITY` (RLS on,
  confirmed `t`).
- **Zero policies** — no public `SELECT` policy; service-role-only access
  (matches the standing constraint "027 MUST NOT grant public DB read access").
- `tenant_key` column present.
- `scope` CHECK constraint: `scope IN (results, discovery)`.

## Seed verification

- `public_pace_checkpoints`: 2 tokens (`IQF0he_G-FXX6sTT`, `rLkzBpG0dBNQg4MX`).
- `communities`: 1 row (`interbay-golf-club`).
- `clubs`: 1 row (`igc`).
- No per-user seed (correct).

## App verification

- `pnpm lint` — pass (exit 0, 0 warnings).
- `pnpm test:unit` — pass (100/100).
- `pnpm build` — pass (all routes compiled).

## Proposed production reconciliation — DO NOT RUN until approved

Production already contains every object the baseline describes (the assistant
tables are now in the baseline, so nothing in the baseline is missing from prod).
The baseline therefore must be marked applied **without running** — running it
would collide (every object already exists, including the assistant tables).
The two forward migrations are genuinely absent from prod and run for real.

### Current production migration ledger (read 2026-08-01, read-only)

`migration list --linked` shows these versions recorded remotely, in order:

```
001 002 003 004 005 006 007 008 009 010 011 012 013 014 015 016 017 019 020 021 022 023 024
```

(018 never existed; **025, the assistant `026`, and `027` are NOT in the
ledger** even though their schema effects — activity tables, assistant tables —
already exist in prod. That is pre-existing drift, not introduced by this
work.) The three `20260731*` versions are local-only (not yet applied).

### Proposed commands (minimum-necessary; historical cleanup optional)

```bash
# 1. Mark the baseline as applied in prod WITHOUT executing it (metadata only).
pnpm supabase migration repair --status applied --linked 20260731000000

# 2. Apply the two forward Standings migrations for real + record them.
#    db push runs only local migrations not in the remote ledger; the baseline
#    is now recorded and is skipped, so only 20260731000001/000002 execute.
pnpm supabase db push --linked

# 3. (OPTIONAL / cosmetic) retire the stale archived entries from the prod ledger.
#    These 001-024 entries reference files no longer in the migrations dir; they
#    are harmless. Production operates correctly with them left in place.
#    Skip unless ledger tidiness is explicitly wanted.
pnpm supabase migration repair --status reverted --linked \
  001 002 003 004 005 006 007 008 009 010 011 012 013 014 015 016 017 019 020 021 022 023 024
```

### Verification (run immediately after, read-only)

```bash
pnpm supabase migration list --linked
pnpm supabase db query --linked -o csv \
  "SELECT version,name FROM supabase_migrations.schema_migrations ORDER BY version;"
# Confirm 20260731000000/1/2 all present; confirm 000001 columns + 000002 table exist:
pnpm supabase db query --linked -o csv \
  "SELECT column_name FROM information_schema.columns WHERE table_name='igc_league_events' AND column_name IN ('event_format','discovery_state','discovered_at','source_finalized_at','source_version','durable_source_version','durable_imported_at') ORDER BY column_name;"
pnpm supabase db query --linked -o csv \
  "SELECT count(*) AS policies FROM pg_policies WHERE tablename='competition_live_cache';"  -- expect 0
pnpm supabase db query --linked -o csv \
  "SELECT rowsecurity FROM pg_tables WHERE tablename='competition_live_cache';"  -- expect t
```

### Rollback / recovery

- **Step 1 (metadata only, no SQL runs):** revert with
  `migration repair --status reverted --linked 20260731000000`. No schema
  change to undo. ⚠ Do NOT run `db push` after reverting step 1 without
  re-marking the baseline applied first — otherwise db push would attempt to
  run the baseline and collide with existing prod objects.
- **Step 2 (schema change):** the two forward migrations are purely additive
  and target objects that do not exist in prod yet, so they apply cleanly. To
  roll back, reverse the schema then drop the ledger entries:
  ```sql
  DROP TABLE IF EXISTS competition_live_cache;
  ALTER TABLE igc_league_events
      DROP COLUMN IF EXISTS event_format,
      DROP COLUMN IF EXISTS discovery_state,
      DROP COLUMN IF EXISTS discovered_at,
      DROP COLUMN IF EXISTS source_finalized_at,
      DROP COLUMN IF EXISTS source_version,
      DROP COLUMN IF EXISTS durable_source_version,
      DROP COLUMN IF EXISTS durable_imported_at;
  DROP INDEX IF EXISTS idx_league_events_format_state;
  ```
  then `migration repair --status reverted --linked 20260731000001 20260731000002`.
  This is safe: `competition_live_cache` is empty (new), and the 7 columns are
  new (the backfill in 000001 only wrote known-good values into them).
- **Step 3 (metadata only):** harmless; re-applied by leaving the entries or
  re-running repair with `--status applied` if desired.

### Notes

- The `db push` in step 2 is the **only** command that executes migration SQL
  and changes schema. Step 1 and the optional step 3 touch migration metadata
  only (no SQL runs, no schema change).
- `supabase/seed.sql` is NOT applied by `db push` (seed runs only on
  `db reset`, which is local-only). Prod seed data already exists; no seed
  step is needed for reconciliation.
- Archived historical migrations cannot execute from `supabase/migrations-archive/`
  — the Supabase CLI scans only `supabase/migrations/`. `migration list`
  already confirms this: 001–024 appear as "Remote only" (Local blank), i.e.
  the CLI no longer sees them as local migrations and will never run them.
- The old assistant `026_assistant_proposals.sql` (on `feature/assistant-phase-a`)
  must NOT be re-merged into `supabase/migrations/`. Its schema is now
  represented by the baseline; re-merging it would attempt to `CREATE TABLE` on
  objects that already exist (collision). It is historical schema — do not
  make it idempotent to "solve" the re-merge; drop/archive it when that branch
  reconciles.