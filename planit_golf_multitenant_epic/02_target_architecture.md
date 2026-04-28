# Target Architecture

## Product surfaces

### 1. Public tenant/league pages

Public pages are for unauthenticated visitors.

Example:
- `/igc`
- `/igc/news`
- `/igc/leaderboard`
- `/igc/rules`
- `/igc/events`

These pages should not require login.

They should be fast, cacheable, and safe to share in emails.

### 2. Authenticated user area

Authenticated pages are for logged in users.

Example:
- `/me`
- `/me/profile`
- `/me/features`
- `/me/settings`
- `/me/groups`
- `/me/admin` if needed later

Existing special features should move here first.

### 3. Future group/trip/member areas

Later:
- user belongs to many groups
- group may be a league, club, trip group, or informal friend group
- group may or may not have a public landing page
- group slugs may collide, so URLs need a strategy

Locked modeling decision:
- public identity belongs to `tenant`
- actual user membership belongs to `group`
- a group may belong to a tenant, or may stand alone

Recommended simple starting point:
- reserve clean public slugs for official public tenants, like `/igc`
- model Interbay men's league and women's league as separate groups under tenant `igc`
- model Big Deal as a private standalone group with no public landing page yet
- use internal IDs or invite links for informal/private groups later
- avoid overbuilding the final URL system now

## Recommended route model

### Public routes

```txt
/[tenantSlug]
/[tenantSlug]/news
/[tenantSlug]/leaderboard
/[tenantSlug]/events
```

For now, only enable known public tenants like `igc`.

### User routes

```txt
/me
/me/profile
/me/special
/me/settings
```

Move existing special user features to `/me/special` or a more specific name.

### Admin routes, later

```txt
/admin
/admin/tenants
/admin/tenants/[tenantId]
```

Do not build these unless needed for this epic.

## Auth boundary

Public tenant pages:
- should not call protected Supabase auth as a render blocker
- should not require session
- should use curated public server APIs or carefully scoped public-safe server reads
- should never assume the browser can query private tables directly

Authenticated user pages:
- must verify the current user
- must check feature access/entitlement
- must not rely only on client-side hiding

Special feature boundary:
- basic account creation and sign in do not imply access to legacy tee-time preference tooling
- special tooling should be gated separately from normal membership/account access

## Performance principle

The public IGC page should be designed for email traffic and quick loads:
- avoid blocking server render on too many queries
- prefer cached public reads where possible
- progressively load noncritical widgets
- keep initial payload small
- treat leaderboard, standings, newsletter, and announcements as public modules with explicit loading/fallback behavior
