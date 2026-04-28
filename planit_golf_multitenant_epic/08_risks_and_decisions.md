# Risks and Decisions

## Decision: Use `/me` for authenticated user area

Reason:
- Clear user/account semantics.
- Avoids conflict with public member profiles.
- Scales to profile, settings, groups, and special features.

## Decision: Use `/igc` for first public tenant page

Reason:
- Simple, memorable URL for email/newsletter.
- Better than nested group URLs for public league identity.
- Can reserve clean slugs for official public tenants.

## Decision: Keep `profiles` as the user/account model

Reason:
- the current app already uses `profiles` as the account layer
- introducing `app_users` now would create a second source of truth
- this epic is meant to stay incremental and low risk

## Decision: Model membership at the group level

Reason:
- users can belong to official league groups and private friend groups at the same time
- tenants represent public identity, but groups represent actual operational membership
- this supports Interbay plus Big Deal without schema ambiguity

Concrete examples:
- Interbay men's league is a group under `igc`
- Interbay women's league is a group under `igc`
- Big Deal is a private standalone group for now

## Risk: Existing special features leak into public IGC experience

Mitigation:
- Move special features behind `/me/special`.
- Add explicit entitlement check.
- Keep public tenant data separate from private feature data.
- Do not treat normal account creation or tenant membership as sufficient for special tooling access.

## Risk: Overbuilding multi tenancy too early

Mitigation:
- Start with a config-backed IGC tenant if database migrations are not necessary yet.
- Add DB-backed tenancy only when needed.
- Keep URL strategy simple.
- Keep group modeling simple and explicit rather than adding a full generalized org system in this epic.

## Risk: Security model for public data is too vague

Mitigation:
- Prefer curated public server APIs first.
- Return explicit public DTOs only.
- Add direct anon-readable views only when the exposed columns and policies are fully understood.

## Risk: Public page performance remains slow

Mitigation:
- Do not call auth helpers from `/igc`.
- Avoid `no-store` unless absolutely necessary.
- Cache public data or use revalidation.
- Load heavy widgets progressively.

## Risk: Old users lose access

Mitigation:
- Identify current access rules before moving anything.
- Add tests or smoke checks.
- Keep redirect from old route.
- Roll out in small commits.
