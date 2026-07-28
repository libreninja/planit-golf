# Seattle Cup Scouting MVP — Session Handoff

Repo-local handoff for the next Claude Code session. Read this first. Current as of 2026-07-28.

## 1. Product goal

Seattle Cup scouting MVP for **Interbay** captains. The board helps a captain:

- evaluate the Interbay candidate pool (35 real Golf Genius-derived Top-35 candidates)
- manage candidate **consideration state** (Considering / Out / Selected)
- manage per-session **availability** (Fourball / Scramble / Chapman / Singles)
- review relevant player information (player-detail page)
- record/share scouting **observations** (notes, attributed to the scout)
- ultimately support roster-selection decisions

This is the actual current product, not speculative future functionality.

## 2. Architecture & ownership boundaries

- **planit.golf** (this repo; Next.js App Router + Supabase) — the captain-facing UI, auth, and entitlements.
- **planit-ai** — a *separate* hosted production service (its own Vercel project + its own isolated Supabase/Postgres) that owns all Seattle Cup scouting data and the GG ingestion.
- **planit.golf Supabase owns authentication + access entitlements** (including the Seattle Cup scouting entitlement). planit-ai does NOT own planit.golf auth.
- **planit-ai Supabase owns the Seattle Cup scouting data** (candidates, state, availability, notes, tags, identities, events, registrations, standings). Isolated from the planit.golf Supabase project.
- planit.golf calls planit-ai **server-to-server** using the configured `PLANIT_AI_API_URL` + shared secret. The captain identity is passed as `x-planit-actor`; it is never exposed to the browser.
- **Production planit.golf is NOT yet running this scouting UI.** Hosted planit-ai IS already deployed and is intentionally its own production service — do not reprovision it.

## 3. Current deployed state

- **planit-ai Supabase:** project `planit-ai`, ref `ibavaevafjctyczorrpw` (isolated).
- **planit-ai Vercel:** project `planit-ai`, service URL `https://planit-ai-theta.vercel.app` (production, already live).
- **Current planit.golf scouting PREVIEW:** https://nextjs-boilerplate-ehoelylqg-libreninjas-projects.vercel.app/igc/seattle-cup/scouting — SSO-protected, requires the existing scouting entitlement.
- **planit.golf production:** NOT deployed with this work yet.
- **Josh's PlanIt account already has an active Seattle Cup scouting entitlement.** Do NOT create another entitlement unless investigation proves it necessary.

## 4. What is currently working (implemented + verified)

### Candidate board (`app/igc/seattle-cup/scouting/candidate-board.tsx`)
- 35 real GG-derived Top-35 candidates.
- Candidate state displayed and **editable inline** (3-segment pill: Considering/Out/Selected).
- Availability displayed and **editable inline** (per-session chips opening a 6-option portal menu).
- Filtering (one collapsible Filters panel: state / handicap range / availability).
- Player-detail navigation.
- Current grouping/layout: each candidate = primary row + secondary Availability strip, visually grouped; subtle alternating candidate-group tint (`bg-primary/[0.05]`); stronger boundary between candidates than within.
- Mobile: card list (`md:hidden`), not the desktop table forced onto phones.

### Candidate state
- Domain values: **Considering / Out / Selected**.
- Persisted and **shared** across scouts/captains (NOT a personal per-user preference).
- Immediate/optimistic; no Save button.

### Availability
- Four sessions: **Fourball / Scramble / Chapman / Singles** (sort_order 1→4).
- Editable directly from the board; saves immediately/optimistically.
- Shared scouting data.
- **Independent of candidate state:** marking unavailable does NOT auto-mark Out; changing state does NOT alter availability.
- Six values preserved exactly: fully_available / partially_available / unavailable / response_pending / no_response / `''` (Not asked yet). Unknown (`''`) must NOT silently become unavailable.

### Player detail (`app/igc/seattle-cup/scouting/players/[id]/`)
- Still exists; uses the same persisted state/availability data. Form-based state + batch-availability actions (with revalidate) coexist with the board's immediate-save actions.

### Notes
- Shared, attributed to the scout/captain who entered them.

### Tags
- Model/API still exist; **intentionally hidden** from the current UI. Do not casually reintroduce.

### Data sharing
- Collaborative: state, availability, notes, and underlying tags are all shared. The entitlement is an access gate, not a private workspace.

## 5. Product decisions already made (do not reverse)

- **Board is directly operable.** No detail-page workflows for routine actions. State + availability save immediately. NO Save/dirty-state workflow.
- **Candidate state** (Considering/Out/Selected) is a shared captain decision, distinct from any derived availability/stage concept.
- **Availability ⊥ candidate state.** Do not auto-mark Out from availability. Unknown ≠ unavailable ≠ no-response.
- **Filters:** one coherent collapsible Filters panel (state / handicap / availability). Active filters stay obvious when collapsed. Optimistic client-side filter state; URL/searchParams stays canonical/shareable. Filter clicks acknowledge immediately (don't appear dead during server nav).
- **Candidate visual grouping:** each candidate is one record (primary + availability rows belong together). Subtle alternating group tint, not per-row zebra striping.
- **Handicap semantics:** plus handicaps exist; stored internally as negatives (internal `-2.3` = displayed `+2.3`). UI uses golf notation. Zero is NOT the lowest handicap. Stable lower presentation bound = **+5.0 (internal -5)**; upper bound is dataset-derived so >18 players stay reachable.
- **Seattle Cup 18 reference:** 18.0 is a UI reference mark ONLY. It is NOT an encoded eligibility cutoff. Do NOT auto-hide/mark-Out/declare-ineligible >18 players. Do not implement an eligibility rule until the authoritative current 2026 rule is verified (Handicap Index vs playing/course handicap — not yet confirmed).
- **League work** became a distracting side quest and is parked. Do not restart unless explicitly instructed.

## 6. Current UX status

Latest scouting-board UX work is implemented, validated, and deployed to **preview only**. Current behavior: one collapsible Filters panel; state/handicap-range/availability filtering; optimistic interactions with subtle pending feedback; inline state + availability editing with immediate optimistic persistence; grouped primary+availability rows; mobile card treatment.

### Latest handicap-filter implementation (the most recent change)
Replaced the old separate Min/Max range bars with **ONE conventional dual-thumb range slider + linked editable Min/Max text inputs** (no library added — two overlaid native `<input type="range">` with pointer-events only on thumbs, plus a positioned fill div between thumbs).

- One shared horizontal track; two thumbs (Min/Max); selected interval filled between them.
- Linked Min/Max text inputs share the SAME state as the slider (two-way sync): dragging a thumb updates its input immediately; typing a valid handicap + committing (blur/Enter) updates the slider/filter.
- No Apply/Save button. Text entry does not navigate per-keystroke (commits on blur/Enter).
- Slider filtering stays optimistic with debounced (250ms) URL sync. `?hcpmin=&hcpmax=` stays canonical/shareable. Full-range values → no hcp filter → no params serialized.
- Golf notation: internal -5 → `+5.0`, -2.3 → `+2.3`, 0 → `0.0`, 7.4 → `7.4`. Typing `+2.5` parses to internal -2.5.
- Bounds: lower +5.0 / internal -5; upper dataset-derived; step 0.1; >18 reachable. 18.0 = reference mark, not a cutoff.
- Input behavior: clamp to bounds; Min ≤ Max, Max ≥ Min; incomplete input allowed while focused; normalizes to canonical golf notation on commit.

Latest validation: TypeScript clean, ESLint clean, `next build` succeeds. A narrow temporary Playwright harness covered slider/input sync, `+2.5` parsing, constraints, dragging Min/Max, and clearing the range — then harness/test were removed before deploy.

**Latest preview:** https://nextjs-boilerplate-ehoelylqg-libreninjas-projects.vercel.app/igc/seattle-cup/scouting — **awaiting Josh's FINAL browser acceptance.** If accepted, the next task is production-readiness/rollout planning. Do NOT automatically start another scouting UX iteration.

## 7. Current scouting data / provenance

Hosted board data is real Golf Genius-derived. Known hosted state (Phase 1): 35 Top-35 candidates, 1026 identities, 130 events, 1502 registrations, 257 standings, 4 Seattle Cup sessions.

- **GHIN is NOT authoritative/live** in the hosted system. Current hosted handicap snapshots are GG-derived fallback values and may be stale.
- The dev GHIN fixture was deliberately NOT promoted to hosted production. Expect 0 fixture GHIN observations in hosted data, and no Phase 0 test notes/tags promoted from local PGlite.
- Preserve provenance honestly.

## 8. Opponent-data findings (investigated, NOT built)

- Historical Seattle Cup data (~2019–2025) already exists in the hosted planit-ai ingestion.
- ~227 distinct non-IGC historical Seattle Cup players observed; `external_player_identity` already supports them.
- Club/team affiliation lives in registration `source_raw` (not a clean structured field). Relevant fields: `team_name` and `custom_fields.Affiliation`; these may disagree.
- GG handicap snapshots exist for many identities but are not current authoritative GHIN.
- No opponent league standings comparable to IGC's exist in the available GG data.
- Useful opponent views would require extracting/normalizing affiliation and creating an opponent-pool/intelligence concept. GHIN for opponents is optional future work.
- **Do NOT build opponent UI merely because this information exists.**

## 9. Known technical debt / traps

- **planit.golf fresh-local bootstrap:** the Supabase migration chain has known problems on a fresh reset — migration 019 depends on `gh_trigger_log` absent on a fresh stack; migration 020 `DROP FUNCTION` conflicts with existing trigger dependencies; subsequent migrations can be blocked. Phase 0 worked around this with a migration subset. This is a bootstrap defect, NOT a scouting-product defect.
- **Local Supabase / Colima:** the local analytics/vector container had a Docker-socket bind-mount issue under Colima; analytics was disabled locally (unnecessary for scouting). (Preserve only if still relevant.)
- **Production safety:** planit.golf production is LIVE with existing Good to Go users. Production deploy must not break Good to Go / tee-time-preference functionality. Always verify preview vs production Vercel targets — do not infer `vercel deploy` target/alias behavior. An earlier accidental production deployment (incorrect CLI flag assumptions) was rolled back; do not repeat. **Always `vercel deploy --target preview` (never `--prod`) unless explicitly approved.**
- **Hosted planit-ai** is intentionally a separate hosted production service. Deploying planit.golf production is NOT permission to reprovision/rebuild planit-ai infrastructure.

## 10. Git / worktree state (actual, as of 2026-07-28)

- **Worktree path:** `/Users/jb/projects/planit-golf/.worktrees/event-centric-platform`
- **Branch:** `feature/event-centric-platform` — **13 commits ahead of `origin/feature/event-centric-platform`, NOT pushed.**
- **The scouting MVP product work is ENTIRELY UNCOMMITTED in the working tree.** The board itself was never committed. Specifically:
  - **Untracked (new, product):** `app/igc/seattle-cup/scouting/candidate-board.tsx` (the core board UI), `app/igc/seattle-cup/scouting/players/[id]/availability-editor.tsx`.
  - **Modified (product):** `app/igc/seattle-cup/scouting/actions.ts` (immediate-save actions), `app/igc/seattle-cup/scouting/page.tsx` (searchParams hcpmin/hcpmax, dropped distribution fetch), `app/igc/seattle-cup/scouting/players/[id]/page.tsx`, `components/app-shell/app-shell.tsx`, `lib/planit-ai/client.ts`, `.gitignore` (adds `.vercel`).
  - The 13 ahead-of-origin commits are earlier work (league, shell, scouting area/access model) — committed locally but not pushed.
- **Disposable local Phase 0 tooling (untracked, NOT product):** `scripts/phase0-acceptance.mjs`, `scripts/phase0-dev-golf.sh`, `scripts/seed-local-captain.mjs`, `supabase/config.toml`, `supabase/.gitignore`. These are local-bootstrap helpers (local Supabase + local planit-ai on :3001); they should NOT be bundled into a product commit.
- **Nothing has been cleaned/deleted for this handoff.** Working tree is left as-is.

## 11. NEXT STEPS (ordered, short)

A. **Josh performs final browser acceptance** of the current scouting preview.
B. If there are concrete acceptance defects, fix ONLY those defects.
C. Once accepted, **freeze the scouting MVP.** Do not keep polishing.
D. Prepare and review a **deliberate planit.golf production rollout**, covering at minimum: exact commit/worktree state to ship; preview-vs-production env differences; production `PLANIT_AI_API_URL`/secret requirements; hosted planit-ai health; hosted scouting-data health/provenance; production auth/entitlement behavior; existing Good to Go regression safety; login/navigation smoke coverage; rollback target + procedure; confirmation that parked league UI won't create a bad production experience.
E. Deploy planit.golf production **ONLY after explicit approval.**
F. Smoke-test production: homepage/navigation, login, existing Good to Go / tee-time-preference, scouting access for Josh, scouting board read, candidate-state write/persistence, availability write/persistence, player detail, notes (if appropriate), unauthorized-access behavior, rollback readiness.
G. Put the production scouting MVP in front of **Noah**. Verify collaborative behavior with two users: Josh changes state/availability → Noah sees it; Noah changes shared data → Josh sees it; notes retain author attribution.
H. Use real captain feedback to decide the next increment (candidates: importing/normalizing actual availability responses, current GHIN integration, opponent intelligence, roster/mock-draft support). **Do NOT automatically start one.** Let real usage set priority.

## 12. Explicit non-goals for the next session

Unless explicitly instructed: no league work; no AI/NL work (the service is named planit-ai but that is not a mandate); no opponent UI; no GHIN implementation; no mock-draft/roster expansion; no invitations/email; no new candidate-state values; no new availability semantics; no Seattle Cup eligibility automation; no infrastructure reprovisioning; no planit.golf production deployment without explicit approval; no unrelated refactoring.

**The immediate objective after acceptance is SHIPPING THE EXISTING MVP SAFELY, not finding another feature to build.**