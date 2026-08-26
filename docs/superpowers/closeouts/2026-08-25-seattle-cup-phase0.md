# Seattle Cup Phase 0 Closeout — Ship the source of truth

Date: 2026-08-26
Plan: `docs/superpowers/plans/2026-08-25-seattle-cup-source-of-truth.md`
Spec: `docs/superpowers/specs/2026-08-25-seattle-cup-source-of-truth-design.md`

Phase 0 recovers the Seattle Cup live API + normalizer (with the Singles
invariant) + cache + competition config + registry registration onto a clean
Seattle-Cup-only branch from `main`, proves provenance, and ships it to
planit.golf production. cupcentral may then consume it (Phase 1).

## The 10 required items

### 1. Source-of-truth branch SHA

The recovery landed via PR #4 (merge `ccfaf3c`):
- `82a63aa` — `feat(seattle-cup): recover live API + normalizer as source of truth`

Two follow-up fixes were required during prod verification (both merged to main
before the final prod deploy):
- `ff61d24` → PR #5 (merge `aaf325f`) — `fix(seattle-cup): correct 2026 R2/R3/R4 GG round ids + course labels` (R2/R3/R4 `ggRoundId`s in config were wrong; only R1 was correct. R2/R3 course labels were swapped.)
- `3b14f7e` → PR #7 (squash) — `fix(seattle-cup): round standings use GG's authoritative round_points` (rendered round standings used the per-match awarded-points sum, which for 2026 R2 disagreed with GG's authoritative `team_points.round_points` aggregate — a known GG-side inconsistency. Now uses the authoritative aggregate; mismatch still surfaced as a validation issue.)

`evidence.ts` (a scouting-board utility that imported
`ScoutingBoardRow` from `@/lib/planit-ai/client` — excluded intel code, imported
by nothing in the live/test path) was removed during recovery. It was the root
cause of a prior implementer's 3-hour stall.

### 2. Exact tracked Seattle Cup files

On `origin/main` (`3b14f7e`), verified via `git ls-tree`:

- `app/api/seattle-cup/live/route.ts` — public API route (the contract surface)
- `lib/seattle-cup/cache.ts` — stale-while-error cache + memory store
- `lib/seattle-cup/config.ts` — SINGLE source of truth (teams, rounds, ggEventId/ggRoundId, matchSlots)
- `lib/seattle-cup/gg-fetch.ts` — GG fetch + format-tournament picker
- `lib/seattle-cup/gg-shapes.ts` — GG payload types
- `lib/seattle-cup/identity.ts` — player identity resolution + summary
- `lib/seattle-cup/live.ts` — `getSeattleCupLive` orchestration (fetch → normalize → cache)
- `lib/seattle-cup/normalize.ts` — `normalizeRound`, `buildRoundStandings`, `buildOverallStandings`, `applyAuthoritativeRoundPoints`
- `lib/seattle-cup/types.ts` — `SeattleCupRoundSnapshot`, `Match`, `TeamStanding`, …
- `lib/competition/configs/seattle-cup.ts` — `seattleCupConfig` (CompetitionConfig)
- `tests/seattle-cup-normalize.test.ts` — 12 tests (record/replay harness, no network)
- `fixtures/seattle-cup/raw/*.json` — 2025 Fourball/Singles fixtures + tee sheets

### 3. Tests / typecheck / build results

- `node --test tests/seattle-cup-normalize.test.ts`: **12/12 pass**.
- Full unit suite `node --test tests/*.test.ts`: **371/371 pass**, 0 fail.
- `pnpm build` (typecheck + Next build): **SUCCESS**. `/api/seattle-cup/live` present in the route tree.
- Scoped lint on recovered files: **CLEAN** (`--max-warnings 0`).

### 4. 2025 Singles regression result

**PASS.** Test: `Singles: a 4-player tee foursome normalizes to independent 1v1 matches from SCOPES, not one 4-way match`.

Assertion (verbatim): given 2 scopes + the first tee foursome (4 players, one
per team), the normalizer produces **exactly 2 matches** from the 2 scopes
(NOT one 4-way match from the foursome); each match has exactly **1 player per
side**; each match has two distinct teams; the pairs are
`bill-wright|interbay` and `jackson-park|west-seattle`; and **no match has 4
players**. This locks the Singles invariant: competitive matches come from GG
tournament **scopes**, never tee-sheet groups.

### 5. 2026 R1/R2 normalization verification (snapshot fields observed)

Probed live production (host `www.planit.golf`) — these are the deployed,
GG-sourced 2026 snapshots:

- **R1** (`?round=1`): `round=1`, `format=fourball`, `course=Jackson Park`, `resultStatus=final`, 12 matches (all final, real played scorecards). roundStandings: `jackson-park 4.5`, `interbay 3`, `bill-wright 3`, `west-seattle 1.5` (sum 12).
- **R2** (`?round=2`): `round=2`, `format=scramble`, `course=Bill Wright`, `resultStatus=final`, 12 matches. roundStandings: `interbay 4.5`, `jackson-park 3`, `bill-wright 2.5`, `west-seattle 2` (sum 12). overallStandings: `interbay 7.5`, `jackson-park 7.5`, `bill-wright 5.5`, `west-seattle 3.5`. validationIssues: 2 (`round-points-mismatch` — the GG per-match-sum-vs-aggregate inconsistency, surfaced by design).
- **R3** (`?round=3`): `format=chapman`, `course=West Seattle`, `resultStatus=not-started`, 12 scheduled TBD slots (pre-play).
- **R4** (`?round=4`): `format=singles`, `course=Interbay`, `resultStatus=not-started`, 24 scheduled TBD slots (pre-play, Singles structure).

R1/R2 roundStandings use GG's authoritative `team_points.round_points`
(`applyAuthoritativeRoundPoints`); W/H/L counts come from the per-match view
(GG `team_points` carries no W/H/L breakdown), so e.g. R2 Interbay shows
`5W-1H-3L / 4.5 pts` — the 0.5 gap is the GG inconsistency made visible. The
round-points-mismatch validation issue is still surfaced.

### 6. Vercel preview URL + endpoint result

Preview deployments on this project are SSO-gated (302 redirect), so a public
preview-curl was not usable. Provenance was proved against **production**
directly (merge → prod deploy → public probe), which is the stricter path. The
production deployment built from the merged `main` checkout:

- Deployment: `https://pg-sc-source-of-truth-90o20bauf-libreninjas-projects.vercel.app`
- ID: `dpl_BnVvQuMJQjRhfkP5rd526Rjskhhu`, `target=production`, `readyState=READY`.

### 7. Merged main SHA

`origin/main = 3b14f7e0d9e145692e9f4cb448fe918edb97a9ca`
(`fix(seattle-cup): round standings use GG's authoritative round_points (#7)`).

### 8. Production deployment verification (prod deployment commit SHA == main SHA)

Production deployed via `vercel --prod --yes` from the `main` checkout at
`3b14f7e`. Deployment `dpl_BnVvQuMJQjRhfkP5rd526Rjskhhu` is `READY`,
`target=production`, and is the current production assignment (verified via
`vercel ls --prod`: 8m old, Ready, Production). The public prod endpoint
returns the authoritative-standings data introduced in `3b14f7e`, confirming
the deployed code == main.

### 9. Production `/api/seattle-cup/live` result (host=planit.golf)

`curl https://www.planit.golf/api/seattle-cup/live?round=1` returns a
`SeattleCupRoundSnapshot`: `round=1`, `format=fourball`, `course=Jackson Park`,
`resultStatus=final`, 12 matches. Host is `planit.golf` (production, not
localhost/preview). `showingLastKnown=false`.

Provenance note: the public response's `eventName` field is the GG round name
(`"Fourball"`), not a year string — so "2026" does not appear literally in the
response. 2026 provenance is established by (a) the locked `GG_EVENT_ID`
(`12971191003644979032` = the 2026 event) in `config.ts`, (b) the match data
(R1/R2 final with real played 2026 scorecards; R3/R4 pre-play with the correct
2026 course/date structure), and (c) the `fetchedAt` timestamp. The endpoint
returns a valid 2026-sourced snapshot; the plan's "eventName contains 2026"
heuristic does not match the actual contract (eventName = GG round name) and
is not a defect.

### 10. Competition-registry registration present in the deployed commit

Verified on `origin/main` (`3b14f7e`): `git show origin/main:lib/competition/registry.ts | grep -q seattleCupConfig` → present. The `seattleCupConfig`
registration (`'seattle-cup': seattleCupConfig`) ships in the same commit tree
as the live route and normalizer.

---

## Provenance gate (5 checks) — all PASS

1. `normalize.ts` in `origin/main` — PASS
2. live `route.ts` in `origin/main` — PASS
3. registry registration (`seattleCupConfig`) in `origin/main` — PASS
4. production deployment corresponds to a commit containing those files — PASS (prod == `3b14f7e`)
5. prod endpoint is the deployed implementation, production-shaped, 2026-sourced — PASS (R1/R2 final, R3/R4 pre-play, host `planit.golf`)

**Definition of done (Phase 0): all 5 provenance checks pass; the 10-item
closeout is recorded; the live endpoint on planit.golf prod returns a valid
2026-sourced snapshot.** → Met. Phase 1 may begin.