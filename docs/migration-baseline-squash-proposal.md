# Migration Baseline Squash — Proposal

> **Status: PROPOSED — not yet executed.** Awaiting approval before any file changes, local build/verify, or remote reconciliation. Production is not touched until the schema comparison is clean and the user explicitly approves the reconciliation commands.

## Goal

Establish a clean canonical schema baseline so a fresh database creates the **current intentional Planit schema directly**, without replaying abandoned intermediate designs (legacy trip system, old trigger function) and without referencing external/non-Planit objects (`gh_trigger_log`). Existing production data and schema are **not** destructively rebuilt. Future migrations continue normally from the new baseline.

## Why squash instead of repairing 019/020 in place

Migration 019 references `gh_trigger_log`, a table never created by any in-repo migration (external/integration-owned). Migration 020 drops legacy trip-system tables and two `set_registration_*_updated_at` functions whose dependent triggers (created in 008/010) make the DROP fail on a fresh boot. These are symptoms of exploratory history being replayed on every fresh bootstrap. Planit is young enough that the correct fix is a clean baseline, not guarding each discarded iteration forever.

## Ground truth (production, pulled 2026-07-31)

- **47 Planit tables** (all RLS-enabled) + 1 external `gh_trigger_log` (excluded).
- **7 functions**: `claim_capability_invite`, `claim_invite_for_user`, `handle_new_user`, `has_scouting_entitlement`, `update_updated_at`, `validate_capability_invite`, `validate_invite_token`. The `set_registration_runs_updated_at`, `set_registration_run_results_updated_at`, `is_trip_creator` functions are **gone** (020 dropped them).
- **10 triggers**, all `*_updated_at BEFORE UPDATE … EXECUTE FUNCTION update_updated_at()` on: capability_invites, club_memberships, clubs, event_editions, event_participants, event_series, feature_entitlements, igc_league_blog_posts, igc_league_events, igc_league_performances. **None** on `registration_runs`/`registration_run_results` (those keep the `updated_at` column, no trigger).
- **Realtime publication** (`supabase_realtime`): only `public.activity_events`.
- **Prod migration ledger**: 001–024 recorded (018 absent — deleted stale duplicate). **025, 026, 027 NOT recorded.** But 025's tables (`activity_events`, `activity_read_state`) exist in prod (applied out-of-band). 026's columns and 027's table are **absent** from prod.
- No `CREATE EXTENSION` in any migration — all extensions are platform-provided.

## Inventory + classification (001–027)

Per-statement inventory complete. Categories (user's five, + FORWARD for the unapplied Standings migrations which have no bucket in A–E):

| Category | ~Count | Disposition |
|---|---|---|
| **A** current Planit schema | ~155 | → baseline |
| **B** required seed/config | 5 | → `supabase/seed.sql` |
| **C** historical one-time transform | ~16 | dropped (folded into baseline DDL where it finalizes a column, e.g. 012 `started_at`) |
| **D** obsolete intermediate schema | ~30 | dropped |
| **E** external/non-Planit | 2 | dropped (019 / `gh_trigger_log`) |
| **F** forward unapplied (026/027) | 7 | kept as separate migrations, NOT in baseline |

**Pure baseline material (all A/B):** 004, 006, 007, 015, 016, 017, 022, 023, 024, 025.
**Pure drop (C/D/E only — remove from executable chain):** 001, 002, 003, 013, 019, 020. (005 is fully redundant with 004 — also dropped.)
**Mixed (extract A/B, drop C/D):** 008, 009, 010, 011, 012, 014, 021.
**Forward (keep separate):** 026, 027.

Notable transforms folded into baseline DDL:
- 012 `public_pace_scans.started_at` → defined directly as `TIMESTAMPTZ NOT NULL DEFAULT NOW()` (drops the backfill UPDATE + the intermediate `SET DEFAULT/NOT NULL`).
- 009 `members.roster_email` → column only; the backfill UPDATE is dropped (sync layer populates).

## Proposed baseline layout

```
supabase/migrations/
  0000_baseline.sql        # current prod schema minus gh_trigger_log (generated, then trimmed)
  026_igc_league_event_format.sql   # unchanged — undeployed Standings
  027_competition_live_cache.sql    # unchanged — undeployed Standings
  _archive/                # non-executable (CLI scans only migrations/*.sql, not subdirs)
    001_initial_schema.sql … 025_activity_system.sql   # retained in git history
supabase/seed.sql          # static bootstrap data (new)
```

**Baseline generation mechanism:** `supabase db pull --linked -s public baseline` captures the current prod public schema (47 tables, columns, indexes, policies, 7 functions, 10 public triggers) into one file. Then:
1. Rename the generated `YYYYMMDDHHMMSS_baseline.sql` → `0000_baseline.sql` so it sorts before `026_`/`027_` (a `2026…` timestamp would otherwise sort after them).
2. Trim the `gh_trigger_log` CREATE TABLE + its 2 policies from the file (external artifact).
3. Append the two statements `db pull -s public` does not capture (schema-scoped): the `on_auth_user_created` trigger on `auth.users` (from 004) and `ALTER PUBLICATION supabase_realtime ADD TABLE public.activity_events` (from 025).

Archive `001`–`025` into `supabase/migrations/_archive/` (git-retained, non-executable). `0000` becomes the new baseline; `026`/`027` run after it.

**Seed (`supabase/seed.sql`):** `public_pace_checkpoints` (2 tokens, 011), `communities` Interbay (014), `clubs` IGC (016). Idempotent. The stale dated sample `igc_events` row ('upcoming-igc-event', 2026-05-30) is **omitted** as demo cruft (see decision 2).

## Excluded objects

- `gh_trigger_log` table + its 2 policies (E — external/integration-owned; not created by any in-repo migration).
- Legacy trip system: `trips`, `memberships`, `rsvps`, `payments` + their indexes/policies/triggers (D — dropped by 020).
- `update_updated_at_column()` function (D — replaced by `update_updated_at()` in 015/021).
- `set_registration_runs_updated_at`, `set_registration_run_results_updated_at`, `is_trip_creator` functions + their triggers (D — dropped by 020; baseline simply never creates them).
- 8 `*_updated_at` triggers from 011/014 that referenced `update_updated_at_column()` (`update_public_pace_checkpoints_updated_at`, `update_communities_updated_at`, `update_igc_events_updated_at`, `update_igc_players_updated_at`, `update_igc_rounds_updated_at`, `update_igc_tee_times_updated_at`, `update_igc_pairings_updated_at`, `update_igc_comments_updated_at`) — **not in prod** (see decision 1).
- All C backfills/renames (009, 012, 013, 021) — not replayed; final state folded into baseline DDL or seed.

## Retained data operations (B → seed.sql)

| Source | Data | Idempotent |
|---|---|---|
| 011 | 2 `public_pace_checkpoints` tokens (the QR codes reference these exact tokens) | ON CONFLICT DO NOTHING |
| 014 | `communities` row: Interbay Golf Club | ON CONFLICT DO UPDATE |
| 016 | `clubs` row: IGC | (single insert) |

`default_preferences` and `feature_entitlements` are per-user data, NOT seed.

## Decision points

**1. The 8 dropped `*_updated_at` triggers (011/014).** These referenced the old `update_updated_at_column()` function and are absent from prod — almost certainly collateral damage from an out-of-band `DROP FUNCTION update_updated_at_column() CASCADE` (which would drop dependent triggers). The tables (`communities`, `igc_events`, `igc_players`, `igc_rounds`, `igc_tee_times`, `igc_pairings`, `igc_comments`, `public_pace_checkpoints`) still have `updated_at` columns but no auto-maintenance.
   - **Recommendation: omit from baseline (baseline = faithful prod snapshot).** Restoring the triggers changes prod behavior and would diverge the baseline from prod, complicating verification. If you want `updated_at` auto-maintained on those 8 tables, that is a **separate forward migration** (e.g. 028) reviewed on its own — not part of the baseline squash.

**2. Stale sample `igc_events` row ('upcoming-igc-event', 2026-05-30).**
   - **Recommendation: omit from `seed.sql`.** It is demo cruft, not "genuinely required static data." Prod keeps its row (we don't touch prod data); fresh DBs simply won't have the demo event.

**3. Baseline generation: `db pull` vs hand-squash.**
   - **Recommendation: `db pull` + trim + 2 manual additions.** It directly produces the current deployed schema with far less error surface than hand-extracting A-statements from 7 mixed migrations. The only manual additions are the auth-user trigger and the realtime publication (2 statements, copied verbatim from existing migrations).

## Verification plan (executed AFTER approval, before any remote repair)

1. **Prod backup (req #1):** schema + ledger already dumped to `/tmp/prod-schema/` (tables, columns, functions, triggers, policies, indexes, FKs, extensions, realtime, ledger). Kept as the comparison reference.
2. **Build blank local DB (req #2):** resolve the `supabase start` double-apply (req #8) first — see below. Then `supabase db reset --local` applies `0000_baseline` + `026` + `027` + `seed.sql` once via the ledger.
3. **Schema compare vs prod (req #3):** diff local public schema against `/tmp/prod-schema/`, expecting differences ONLY for: (a) `gh_trigger_log` absent locally (excluded), (b) 026's 7 columns on `igc_league_events` present locally / absent in prod, (c) `competition_live_cache` present locally / absent in prod. Any other diff is a defect to fix before proceeding.
4. **Seed/config verify (req #4):** confirm checkpoints/communities/clubs rows present locally; no per-user seed.
5. **App tests (req #5):** `pnpm test:unit` (pure-logic) + `pnpm lint` + relevant smoke against the clean DB.
6. **026/027 behavior (req #6):** confirm 026 CHECK constraints, `discovered_at`, both durable-version + timestamp columns, and the backfill (`event_format='individual', discovery_state='discovered' WHERE gg_tournament_id IS NOT NULL`) on the fresh DB; confirm 027 RLS enabled with NO public SELECT policy, `tenant_key`, scope CHECK.
7. **Double-apply resolution (req #8):** the `supabase start` fresh-volume bug (postgres image `migrate.sh` applies migrations raw, then the CLI re-applies via ledger → collision) is orthogonal to the squash but must be resolved so the canonical workflow applies migrations once via the ledger. Plan: (a) upgrade CLI 2.84.4 → 2.111.0 (available); (b) `supabase stop`, remove volumes, `supabase start`; (c) check `migration list` — if ledger is empty but tables exist (migrate.sh applied raw), run `supabase db reset --local` to reach a clean ledger-backed state. If `start` still tears down, fall back to a workflow that boots containers then `db reset`s.

## Remote reconciliation procedure (req #7) — NOT executed until schema comparison is clean AND user approves

Production already contains every object the baseline describes (baseline = prod minus `gh_trigger_log`), so the baseline must be marked applied **without running** (running would collide). `026`/`027` are genuinely absent from prod and will run for real.

```bash
# 0. Prerequisite: local schema comparison is clean (req #3 passed).

# 1. Mark the baseline as applied in prod WITHOUT executing it.
#    (safe: prod already has all baseline objects)
pnpm supabase migration repair --status applied --linked 0000

# 2. Apply the forward Standings migrations (026, 027) for real + record them.
#    db push runs only migrations not in the ledger; 0000 is now recorded, so it is skipped.
pnpm supabase db push --linked

# 3. (Optional / cosmetic) retire the archived versions from the prod ledger.
#    Prod ledger currently records 001–024 (018 absent). These files are archived
#    out of the executable dir; their ledger entries are stale but harmless.
pnpm supabase migration repair --status reverted --linked \
  001 002 003 004 005 006 007 008 009 010 011 012 013 014 015 016 017 019 020 021 022 023 024

# 4. Verify: prod ledger should now show only 0000, 026, 027 (and optionally the
#    retired 001–024 removed). Confirm 026 columns + 027 table now exist in prod.
pnpm supabase migration list --linked
pnpm supabase db query --linked -o csv "SELECT version,name FROM supabase_migrations.schema_migrations ORDER BY version;"
```

Note: 025 is **not** in the prod ledger today (applied out-of-band) and is folded into `0000_baseline`, so it needs no separate repair. Step 3 is cosmetic; skipping it leaves harmless stale ledger entries.

## Risks

- **`db pull` output noise / completeness:** scoped to `public` to avoid auth/storage internal noise; the 2 known gaps (auth-user trigger, realtime publication) are added manually and verified against the prod reference. If the comparison (req #3) reveals other gaps, the baseline is corrected before any remote repair.
- **Marking 0000 applied without running:** safe only because the baseline equals prod-minus-`gh_trigger_log`. The req #3 comparison is the gate that proves this; remote repair does not proceed until it is clean.
- **026/027 running on prod:** 026 is additive (`ALTER TABLE ADD COLUMN` + index + backfill) and idempotent; 027 creates a new table. Both are safe, non-destructive. The >12-op blast-radius guard and all standing Standings constraints still apply.
- **No data loss:** prod data is never touched; only DDL (026/027) and ledger entries change.