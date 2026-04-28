# Codex Prompt: Epic Kickoff

You are working in the Planit Golf codebase.

We are starting an epic to support multi tenant public league pages while preserving existing special features for existing users.

Locked product/architecture decisions:
- keep `profiles` as the account/user model for this epic
- `igc` is the first public tenant
- Interbay men's league and women's league are separate groups under `igc`
- Big Deal is a private standalone group for now
- memberships should join `profiles` to `groups`
- special tee-time tooling is entitlement gated and must not become generally available to all signed-in users
- public tenant data should be delivered through curated server APIs or clearly public-safe server reads

## Goals

1. Identify the current framework, routing structure, auth boundary, and data fetching patterns.
2. Locate the existing special user features.
3. Propose a minimal migration plan that moves those features into an authenticated `/me` area.
4. Add a public unauthenticated IGC landing page route.
5. Keep changes incremental and low risk.
6. Do not migrate auth providers or infrastructure.

## Expected implementation order

Plan around this sequence unless the repo structure makes it clearly unsafe:
1. Public `/igc` shell
2. Authenticated `/me` area shell
3. Move existing special feature UI to `/me/special`
4. Add or confirm entitlement gating
5. Add lightweight tenant config
6. Wire public data modules incrementally

## Important product context

Existing users have special features that no general IGC member should receive.

General IGC members will get an email about a newsletter. That email should point to a public unauthenticated IGC league landing page with leaderboard data, newsletter content, and other public league information.

The long term product is multi tenant:
- leagues
- course clubs
- friend groups
- trips

But this first epic should avoid overbuilding.

## First task

Inspect the repo and produce an implementation plan before editing code.

Do not start by inventing a large new schema.
Do not introduce a second canonical user table.
Do not generalize the URL system beyond what this first tenant needs.
Do not wire public pages directly to private operational reads without an explicit public-safe server layer.

Please report:
- framework and router style
- current auth implementation
- current protected routes
- current public routes
- where special features live today
- how the current `profiles` model is being used as the account layer
- whether there is already an entitlement-like access check for the special tooling
- whether existing league/member concepts map naturally to tenant-backed groups
- likely data sources for leaderboard/newsletter modules
- any obvious performance risks in page rendering
- proposed file changes
- proposed tests or smoke checks

## Constraints

- Do not break existing users.
- Do not require auth for `/igc`.
- Do not expose special features publicly.
- Do not treat tenant membership as equivalent to special tooling entitlement.
- Do not introduce AWS, Cognito, or a new auth provider.
- Do not introduce `app_users` in this epic unless the user explicitly approves a profile-model migration.
- Avoid large rewrites.
- Prefer small, reviewable commits.

## Deliverable

Create a short implementation plan with:
- phases in recommended execution order
- exact files likely to change
- route/auth risks
- data-source assumptions for `/igc`
- the smallest useful first commit

Then stop and wait for approval before making broad changes.
