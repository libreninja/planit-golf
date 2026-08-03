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
