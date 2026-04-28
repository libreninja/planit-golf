# Route Plan

## Phase 1 routes

### Public

```txt
/igc
```

Purpose:
- public unauthenticated IGC landing page
- newsletter destination
- leaderboard module
- public updates

### Authenticated

```txt
/me
/me/profile
/me/special
```

Purpose:
- user profile/account home
- preserve existing special features
- keep special features out of the public IGC experience

## Route behavior

### `/igc`

- Must not require auth.
- Should render even if user is logged out.
- Should not redirect to login.
- Should be safe to send in email.
- Should handle missing data gracefully.

### `/me`

- Requires auth.
- Redirects logged out users to sign in.
- Shows current user profile/account overview.

### `/me/special`

- Requires auth.
- Requires entitlement.
- Shows migrated legacy special features.
- If user is authenticated but not entitled, show a clear "not available" state or redirect to `/me`.

Interpretation:
- signing in alone is not sufficient
- new Planit users may have `/me` access without special tooling access
- the legacy tee-time preference tooling should only appear for invited/entitled users

## Redirects

If there is an existing route for special features, keep it temporarily:

```txt
/old-special-route -> /me/special
```

Only do this after identifying the existing route.

## Naming note

Prefer `/me` over `/profile` because:
- it is clearly user-specific
- it scales to settings, groups, account, and special features
- it avoids conflict with public member profile pages later
