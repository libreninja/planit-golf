# Codex Slice Prompts

Use these as separate Codex tasks after the kickoff inspection.

---

## Slice 1: Create public IGC landing page shell

Create a public unauthenticated route for Interbay Golf Club.

Preferred route:
```txt
/igc
```

Requirements:
- Must not require login.
- Must not redirect to sign in.
- Should render a clean landing page shell.
- Include placeholder sections for:
  - IGC identity/header
  - newsletter/latest update
  - leaderboard
  - upcoming events or schedule
  - pace/rules/news section
- Use existing styling/components where possible.
- Keep data static or mocked if real data wiring is unclear.
- Do not move existing special features yet.

After implementation, provide:
- files changed
- how to run/test
- any assumptions

---

## Slice 2: Create authenticated `/me` area

Create an authenticated user area.

Preferred routes:
```txt
/me
/me/profile
/me/special
```

Requirements:
- `/me` requires login.
- `/me/profile` requires login.
- `/me/special` requires login and explicit entitlement before any real special feature UI is exposed.
- Use existing auth/session helpers.
- Keep UI minimal.
- Do not duplicate auth logic if helpers already exist.

After implementation, provide:
- files changed
- how unauthenticated users are handled
- how authenticated users are loaded
- any performance concerns

---

## Slice 3: Move existing special features to `/me/special`

Find the existing special user feature UI and move or re mount it under `/me/special`.

Requirements:
- Existing entitled users must retain access.
- Non entitled users must not see the feature.
- Preserve existing behavior as much as possible.
- Add a temporary redirect from the old route if one exists.
- Avoid changing feature internals unless needed.

Before coding:
- identify the old route/component
- identify how special access is currently determined
- propose the safest move

After implementation:
- list old route behavior
- list new route behavior
- include smoke tests

---

## Slice 4: Add tenant configuration for IGC

Add a lightweight tenant configuration layer.

Requirements:
- Define IGC as a public tenant with slug `igc`.
- Include name, shortName, description, and enabled sections.
- Do not require full database migration unless existing architecture makes that easy.
- Prefer a simple config file first if DB schema is not ready.
- Reflect that Interbay men's and women's leagues are separate groups under the `igc` tenant, even if those groups are not fully modeled in this slice yet.

Example shape:
```ts
{
  slug: "igc",
  name: "Interbay Golf Club",
  shortName: "IGC",
  visibility: "public",
  sections: {
    newsletter: true,
    leaderboard: true,
    events: true
  }
}
```

Use this config on the `/igc` page.

---

## Slice 5: Wire public leaderboard data safely

Wire real leaderboard data into `/igc` if an existing safe source exists.

Requirements:
- Do not expose private data.
- Do not require login.
- Prefer curated server-side data fetch with caching or static revalidation.
- Avoid blocking the whole page on slow leaderboard data if possible.
- Add loading/empty/error states.

If no safe source exists:
- create a TODO and leave mocked data in place
- do not invent unsafe direct public reads

---

## Slice 6: Newsletter/public post support

Add a public newsletter/latest update section to `/igc`.

Requirements:
- Link to Substack or internal post pages if available.
- Keep content public and unauthenticated.
- If data source is not ready, use a config driven featured post/link.
- Do not build a full CMS in this slice.

---

## Slice 7: Basic navigation changes

Add navigation from authenticated user area to public IGC page and vice versa where appropriate.

Requirements:
- Logged out visitors on `/igc` should see public navigation only.
- Logged in users may see a link to `/me`.
- Do not show special feature links to non entitled users.
- Do not imply that belonging to a tenant automatically grants special tooling access.
