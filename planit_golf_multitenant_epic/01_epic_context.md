# Epic Context: Multi Tenant Planit Golf

## Current situation

Planit Golf currently has an existing authenticated site with users who have access to a special set of features. Those features should not become part of the general public league experience.

The product direction is expanding toward multi tenant support for:
- Golf leagues
- Course clubs
- Friend groups
- Trips
- Public landing pages
- Newsletters
- Leaderboards
- Group-specific content

Interbay Golf Club, or IGC, is the first concrete tenant/league use case.

## Product intent

General IGC members will receive an email about the newsletter. That email should point them to a public, unauthenticated IGC landing page.

That public page should support:
- League identity
- Leaderboard data
- Newsletter links/posts
- Public league updates
- Potential future links to schedules, standings, rules, pace of play updates, and events

Existing special users should retain their current capabilities, but those capabilities should move into a protected user profile/account section.

Additionally:
- New users may create a Planit Golf account without being entitled to the legacy tee-time preference tooling.
- Authenticated users may eventually belong to multiple groups and move between public tenant pages and private group experiences.
- A user may belong to both an official tenant-linked league and unrelated private golf groups at the same time.

Concrete example:
- Interbay Golf Club is a public tenant.
- Interbay men's league is one group under that tenant.
- Interbay women's league is another group under that tenant.
- Big Deal is a private friend group outside the formal tenant structure for now.
- Many users may belong to both IGC league groups and Big Deal.

## Key constraint

Do not break existing users.

This should be an incremental migration:
- Keep existing functionality available.
- Move it behind a new authenticated route.
- Build public tenant pages alongside it.
- Avoid a large auth or infrastructure migration during this epic.

## Non goals for this epic

- Do not migrate auth providers.
- Do not move from Vercel/Supabase to AWS.
- Do not redesign the entire app.
- Do not require all IGC members to create accounts.
- Do not implement every tenant feature immediately.
- Do not build a full social network.

## Success criteria

- Existing special users can still access their special features after the route change.
- `/igc` or equivalent public route loads without authentication.
- Public IGC page can display placeholder or real leaderboard/newsletter modules.
- The route model supports future tenants without ugly URLs.
- The auth model separates public viewers from authenticated users.
- The data model supports users who belong to multiple groups at once, including tenant-linked leagues and standalone private groups.
