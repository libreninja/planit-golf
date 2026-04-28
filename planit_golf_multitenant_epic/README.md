# Planit Golf Multi Tenant Epic Prep

This packet is designed to hand to Codex before implementation.

Primary goal:
- Preserve existing special user features.
- Move those features into an authenticated user profile/account area.
- Introduce public, unauthenticated tenant landing pages.
- Start with Interbay Golf Club as the first public tenant experience.
- Model leagues and private golf communities in a way that supports overlap.
- Keep the migration incremental and low risk.

Locked decisions for this packet:
- `profiles` remains the account/user model for this epic.
- `igc` is a public tenant.
- Interbay men's league and women's league are separate groups under `igc`.
- Big Deal is a private standalone group for now.
- Memberships join `profiles` to `groups`.
- Special tee-time tooling remains invite/entitlement gated.
- Public tenant data should come from curated server APIs or public-safe server reads.

Recommended order:
1. Read `01_epic_context.md`
2. Read `02_target_architecture.md`
3. Read `03_data_model_plan.md`
4. Read `04_route_plan.md`
5. Execute `05_codex_prompt_epic_kickoff.md`
6. Then execute the slice prompts in `06_codex_slice_prompts.md`

Preferred implementation order after kickoff approval:
1. Add `/igc` public landing page shell with static or mocked modules.
2. Add `/me`, `/me/profile`, and `/me/special` route shells using existing auth helpers.
3. Identify and move the current special tee-time tooling to `/me/special`.
4. Add explicit entitlement gating for the special tooling if it is not already isolated cleanly.
5. Add lightweight tenant config for `igc`.
6. Wire public-safe data into `/igc` incrementally: leaderboard first, then newsletter/announcements, then other modules.

Implementation guardrails:
- Prefer reusing existing `profiles`, auth helpers, and route patterns over inventing new abstractions.
- Do not introduce a large multi-tenant schema migration before the public and authenticated route model is working.
- Do not make `/igc` depend on authenticated session state.
- Do not make basic account creation imply access to legacy special tooling.
