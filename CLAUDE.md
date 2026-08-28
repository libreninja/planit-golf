# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

planit.golf is a Next.js + Supabase web app for Interbay Golf Club featuring:
- **Good to Go**: invite-gated league tee-time preference collection
- **IGC Event Companion**: public event shell with Golf Genius imports, leaderboards, and feeds
- **Public Pace Board**: QR-driven pace timing and leaderboards
- **Admin Dashboard**: roster sync, invites, registration runs, and operational tools

## Tech Stack

- **Framework**: Next.js 16 App Router (TypeScript)
- **Database**: Supabase (PostgreSQL with RLS)
- **Auth**: Supabase Auth (Magic Links)
- **Styling**: Tailwind CSS + shadcn/ui
- **Testing**: Playwright (smoke tests)
- **Package Manager**: pnpm (required)

## Development Commands

```bash
# Install dependencies
pnpm install

# Start dev server
pnpm dev

# Build for production
pnpm build

# Run ESLint
pnpm lint

# Run smoke tests (Playwright)
pnpm test:smoke
pnpm test:smoke:headed    # Visible browser

# Local Supabase (uses scripts/run-supabase.mjs)
pnpm supabase

# Member sync from Golf Genius
pnpm sync:members:dry      # Preview changes
pnpm sync:members          # Apply changes

# Event sync from Golf Genius
pnpm sync:events:dry       # Preview changes
pnpm sync:events           # Apply changes

# Generate QR codes for public pace board
pnpm generate:public-pace-qr
```

## Releasing / Deploying

**Canonical release flow — GitHub auto-deploy. NEVER `vercel deploy --prod` from the CLI.**

This project is connected to Vercel via the GitHub integration. The flow that builds and serves correctly is:

1. Commit on a feature branch (off `main`).
2. `git push` the branch → open a Pull Request against `main`.
3. Merge the PR. Vercel auto-builds `main` and deploys to production (`www.planit.golf`, `planit.golf`, `bigdeal.planit.golf`). Squash-merge is the repo convention (see `git log` — `… (#N)`).

**Deployment listings may be incomplete.** The available Vercel deployment-list tooling (CLI/MCP) may enumerate only a subset of deployments and miss Git-triggered ones — absence from such a listing is **not** proof that a Git deployment did not occur (observed 2026-08-27: a merged `main` deploy was live while the listing showed only older CLI-agent deploys). Verify a deploy via deployment metadata when available (deploy `meta.gitCommitSha` / `target=production`), and otherwise by direct production verification: curl the affected routes/content and confirm the merged behavior is serving.

**Do not use `vercel deploy --prod` / `vercel deploy --target=production` to ship or "restore" a page.** This has caused a hard outage: a CLI deploy of current `main` (code byte-identical to a known-good GitHub deploy) built `READY`/`PROMOTED` but served a bare edge-level **500 on every route** (including `/`, `/scouting`, `/womens-league`) with no function logs, while the identical code deployed via the GitHub integration served 200 everywhere. The GitHub integration is the build/source-of-truth; CLI deploys diverge from it (build env / rootDirectory / config handling) and can 500 even when the build reports success. Surface or restore a page by merging it into `main`, not by CLI-deploying a branch.

**Rolling back a bad production deploy.** Do not rebuild. Re-assign the production aliases to the last known-good `main` deploy in one action:
```bash
vercel promote <last-good-deploy-url> --yes   # e.g. nextjs-boilerplate-<hash>-libreninjas-projects.vercel.app
```
Find the last good `main` deploy in the Vercel dashboard (Deployments, target=production, from `main`) or via the API:
`https://api.vercel.com/v6/deployments?projectId=prj_jYKeHFnoeXhi30uhvtjAD1H1jQL2&teamId=team_2OwWZEiWXYEgSrbbyaqfrRNg&target=production&limit=N` (pick the most recent READY one whose `meta.gitCommitRef` is `main`). After promoting, verify routes with `curl -s -o /dev/null -w "%{http_code}\n" https://www.planit.golf/...`.

**Environment & protection.** Env vars (Supabase, Golf Genius, SMTP, `CRON_SECRET`, etc.) are configured on the Vercel project (Production environment), not in the repo — the GitHub build picks them up automatically; a CLI deploy may not. Deployment Protection: `ssoProtection = "all_except_custom_domains"` — preview URLs (`*.vercel.app`) are SSO-gated (curl returns `302 → vercel.com/sso-api`); the production custom domains are **public**. Public pages use an **app-level** gate (`requireScoutingAccess` / `requireAuth` in the route) — an anonymous request returns `200` with an inline "Sign in" body, not a redirect.

**Local build signal ≠ deploy readiness.** `pnpm build` (Turbopack) typechecks only the app build graph; standalone `tests/` and unimported WIP may have `tsc --noEmit` errors that do NOT break `next build`. Conversely, do not deploy a working tree with stray untracked WIP (matchups, probe scripts, half-built routes) — it can ship half-built code. Ship from clean, committed `main` via the GitHub flow.

## Architecture

### Supabase Client Patterns

Three distinct Supabase clients are used depending on context:

1. **Browser Client** (`lib/supabase/client.ts`): For client components
   - Uses `createBrowserClient` from `@supabase/ssr`

2. **Server Client** (`lib/supabase/server.ts`): For Server Components and Actions
   - Uses `createServerClient` with cookie handling
   - Respects RLS policies based on authenticated user

3. **Service Role Client** (`lib/supabase/service.ts`): For admin operations
   - Uses service role key, bypasses RLS
   - Only use in server-side code (Server Actions, API routes)
   - Never expose to browser

### Authentication & Authorization

- Auth method: Supabase Magic Links (passwordless email)
- Admin check: `profiles.is_admin` or `profiles.is_system_admin` columns
- Auth utilities: `lib/auth.ts` - `requireAuth()`, `requireAdmin()`, `getProfileRoles()`
- System admins: Configured via `SYSTEM_ADMIN_EMAILS` env var (comma-separated)

### Row Level Security (RLS)

All tables have RLS enabled. Key patterns:
- `trips`: Creators are admins; members with 'invited' or 'accepted' status can view
- `memberships`: Users view their own; trip creators can add members
- `rsvps`: Users manage their own; admins manage all for their trips

### Server Actions Organization

Server actions are co-located by feature:
- `app/actions.ts`: Core invite/auth operations
- `app/preference-actions.ts`: Tee-time preference submissions
- `app/admin-actions.ts`: Admin-only operations
- `app/session-actions.ts`: Session management
- `app/igc/actions.ts`: IGC event companion actions

### Route Groups

- `(auth)/`: Public auth routes (login, signup, invite acceptance)
- `(admin)/`: Admin-only routes (middleware checks `is_admin` or `is_system_admin`)
- `igc/`: Public IGC event companion
- `scan/`: Public QR scan routes
- `api/`: API routes (member preferences, admin operations)

### Database Migrations

Migrations are in `supabase/migrations/` and run in filename order. Key tables:
- `profiles`: User profiles with `is_admin`, `is_system_admin` flags
- `members`: Golf club members synced from Golf Genius
- `trips`: Events/trips with registration schedules
- `memberships`: User-to-trip associations
- `rsvps`: Tee-time preferences within trips
- `public_pace_scans`: QR pace timing data
- `igc_events`, `igc_players`, `igc_feed_items`: IGC event companion data

### Golf Genius Integration

- `lib/igc/golfgenius-sync.ts`: Golf Genius API client
- `lib/igc/data.ts`: IGC-specific data access
- Sync scripts in `scripts/sync-*.mjs`
- API key stored in `GOLF_GENIUS_API_KEY` env var

### Email System

- Uses Nodemailer with SMTP
- Optional: if SMTP not configured, invite links can be shared manually
- `lib/email/mailer.ts`: Email sending utilities

### Testing

- Playwright for smoke tests in `tests/smoke.spec.ts`
- Tests run against local dev server by default
- Set `PLAYWRIGHT_BASE_URL` to test against deployed instance

### Environment Variables

Required:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GOLF_GENIUS_API_KEY`
- `GOLF_GENIUS_BASE_URL` (default: https://www.golfgenius.com)

Optional (email functionality):
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`
- `FROM_EMAIL`, `REPLY_TO_EMAIL`

Configuration:
- `APP_URL`: Production URL for invite links
- `SYSTEM_ADMIN_EMAILS`: Comma-separated list of system admin emails
- `CRON_SECRET`: Secret gating `/api/cron/reconcile` (hourly reconciliation)

## Deployment

This project is deployed by **git-connected continuous deployment** — do **not** use the `vercel` CLI to deploy.

- **Repo:** `github.com/libreninja/planit-golf`, branch `main`.
- **Vercel project:** `pg-sc-source-of-truth`; production domain `www.planit.golf` (a project domain that auto-points to the **latest production deployment**).
- **How to deploy a change:** open a PR against `main`, merge it (or push to `main`). Vercel auto-builds and deploys to production; `www.planit.golf` auto-points to the new deployment. Verify with `curl -s -o /dev/null -w '%{http_code}' https://www.planit.golf/api/seattle-cup/live?round=1` (expect `200`).
- **Env vars** (Supabase URL/keys, `GOLF_GENIUS_API_KEY`, etc.) are configured in the Vercel dashboard as encrypted project secrets and are injected automatically on git deploys. Local dev uses `.env.local` (gitignored).

### ⚠️ Do not deploy via the `vercel` CLI — it has caused a production outage

A restricted CLI auth scope makes manual deploys dangerous here:

- **`vercel --prod --yes`** deploys in a scope that **cannot access the project's encrypted env vars**. The resulting deployment is env-less and returns **500** on every route with `Error: Your project's URL and Key are required to create a Supabase client!` (the Supabase session middleware throws). It still becomes "latest production" and breaks `www.planit.golf` until the next git deploy overtakes it.
- **`vercel env ls`** reports *"No Environment Variables found"* and **`vercel ls`** shows only CLI-created deployments. **This is a lie of scope** — the CLI cannot see the project's encrypted secrets or its git-auto-deployed deployments. Do not trust either command as a readout of project state, and do not "fix" the missing env by adding vars from the CLI.
- **`vercel alias set www.planit.golf <deployment>`** does **not** override the project domain (which auto-points to latest prod). It creates conflicting route aliases that can worsen an outage. Never alias the production domain.

The recovery from a CLI-induced outage is: **stop issuing `vercel` commands** and merge/push to `main` so a git auto-deploy becomes the latest production deployment. (A broken CLI deploy was self-healed on 2026-08-26 when PRs #8/#9/#10/#11 merged to `main` and overtook it.)
