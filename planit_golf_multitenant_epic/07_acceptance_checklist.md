# Acceptance Checklist

## Public IGC page

- [ ] `/igc` loads while logged out.
- [ ] `/igc` does not redirect to sign in.
- [ ] `/igc` has a league identity/header.
- [ ] `/igc` has newsletter/latest update area.
- [ ] `/igc` has leaderboard area.
- [ ] `/igc` handles missing data gracefully.
- [ ] `/igc` does not expose private user/member data.
- [ ] `/igc` is fast enough for email traffic.

## Existing special users

- [ ] Existing special user can sign in.
- [ ] Existing special user can access new `/me/special`.
- [ ] Existing special feature behavior still works.
- [ ] Old route redirects or remains available during migration.
- [ ] Non entitled user cannot access special feature.
- [ ] Newly created normal user can access `/me` without receiving special tooling.

## Authenticated user area

- [ ] `/me` requires auth.
- [ ] `/me/profile` requires auth.
- [ ] Logged out visitor gets a clear sign in path.
- [ ] Logged in user can navigate to their account/profile.

## Multi tenant foundation

- [ ] Tenant slug `igc` is represented in config or database.
- [ ] Route structure does not prevent future tenants.
- [ ] User identity is not coupled to tenant identity.
- [ ] Entitlements are separate from normal group membership.
- [ ] Interbay men's and women's leagues can be represented as separate groups under `igc`.
- [ ] Big Deal can be represented as a private standalone group.

## Performance

- [ ] Public page avoids unnecessary auth calls.
- [ ] Public page does not block on expensive noncritical data.
- [ ] Server response time is checked in DevTools.
- [ ] Slow data modules have loading or fallback states.
