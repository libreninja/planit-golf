# Trip HQ (bigdeal.golf) — MVP Build Plan (Cursor-Ready)

## Goal
Build a cloud-hosted, invite-only Trip HQ web app where golfers log in and **only see trips they’ve been invited to**. Each trip page shows itinerary/costs/payment QR codes and supports **RSVP + “I paid”** confirmations. One admin (me) can create/edit trips, invite people, track statuses, and send reminder emails.

**Primary constraints**
- Dead simple for guests (no passwords; magic-link login)
- Strong access control (cannot view trips without invitation)
- Cloud deployment (Vercel + Supabase)
- MVP uses Venmo/Zelle via QR + tracking (no Stripe yet)

---

## Architecture (Cloud)
- **Next.js (App Router) + TypeScript** deployed on **Vercel**
- **Supabase** for:
  - Auth (magic link)
  - Postgres database (RLS enforced)
  - Storage (QR images)
- Email sending:
  - Use **Postmark** (recommended) via a Next.js server route for invite/reminder emails
  - Supabase handles auth email (magic links)

Domain: **bigdeal.golf** (optionally use `trips.bigdeal.golf` later)

---

## Repo Setup
- Next.js 14+ App Router
- Tailwind (optional but fine)
- Supabase JS client
- Zod for validation
- React Hook Form (optional) for forms

---

## Routes / Pages
### Public
- `/login` — email input, sends magic link
- `/invite/[token]` — claims invite for logged-in user, redirects to trip page

### Authed (Member)
- `/trips` — “My Trips” list (only invited trips)
- `/trips/[slug]` — trip detail page with:
  - overview, itinerary, costs, deposit deadline
  - payment rails (Venmo QR, Zelle)
  - RSVP form/modal
  - “I paid” confirmation form/modal

### Admin (Me only)
- `/admin` — list trips + create trip
- `/admin/trips/[id]` — edit trip + invite members + roster table
- `/admin/trips/[id]/remind` — send reminders to filtered set

---

## Data Model (Supabase Postgres)

### `trips`
- `id uuid primary key default gen_random_uuid()`
- `slug text unique not null` (e.g. `bandon-crossings-2026`)
- `title text not null`
- `location_name text`
- `start_date date`
- `end_date date`
- `overview text` (markdown OK)
- `itinerary jsonb` (array of blocks; see seed format below)
- `deposit_amount_cents int not null default 0`
- `deposit_due_date date`
- payment rails:
  - `venmo_handle text`
  - `venmo_qr_url text` (Supabase Storage public URL)
  - `zelle_recipient text` (email or phone)
  - `required_memo_template text` (e.g. `BC26 Deposit - {LastName}`)
- `created_by uuid not null` (auth.users.id)
- `created_at timestamptz default now()`
- `updated_at timestamptz default now()`

### `memberships`
Invite + access control join table.
- `id uuid primary key default gen_random_uuid()`
- `trip_id uuid not null references trips(id) on delete cascade`
- `user_id uuid null references auth.users(id) on delete set null`
- `invited_email text not null` (lowercased)
- `role text not null default 'guest'` (guest|organizer)
- `status text not null default 'invited'` (invited|accepted|declined)
- `invite_token text unique not null`
- `invited_at timestamptz default now()`
- `accepted_at timestamptz null`

### `rsvps`
- `id uuid primary key default gen_random_uuid()`
- `trip_id uuid not null references trips(id) on delete cascade`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `status text not null` (yes|no|maybe)
- `arrival_at timestamptz null`
- `departure_at timestamptz null`
- `walking_pref text null` (walk|ride|either)
- `notes text null`
- `updated_at timestamptz default now()`
- unique constraint: `(trip_id, user_id)`

### `payments`
Tracks “reported” vs “verified”.
- `id uuid primary key default gen_random_uuid()`
- `trip_id uuid not null references trips(id) on delete cascade`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `type text not null default 'deposit'`
- `amount_cents int not null`
- `method text not null` (venmo|zelle|cashapp|other)
- `identifier text null` (venmo handle / last4 / etc.)
- `memo text null`
- `reported_at timestamptz default now()`
- `verified_at timestamptz null`
- `verified_by uuid null references auth.users(id)`
- optional unique: `(trip_id, user_id, type)`

---

## Security & Access Control (Supabase RLS)

### Core rule
A user can view a trip only if:
- there exists a row in `memberships` where:
  - `trip_id = trips.id`
  - `user_id = auth.uid()`
  - `status in ('invited','accepted')`

### Enable RLS on: `trips`, `memberships`, `rsvps`, `payments`

#### `memberships` policies
- SELECT: user can select rows where `user_id = auth.uid()`
- UPDATE: user can update their own row only to set `status` (`accepted|declined`) and `accepted_at`
- INSERT/DELETE: only admin via service role (server routes)

#### `trips` policies
- SELECT: allowed if membership exists for `auth.uid()`
- INSERT/UPDATE/DELETE: allowed if `created_by = auth.uid()` (single admin)

#### `rsvps` policies
- SELECT/UPSERT: user can read/write their own RSVP (`user_id = auth.uid()`)
- Admin can read/write all RSVPs for trips where `created_by = auth.uid()`

#### `payments` policies
- SELECT/INSERT: user can create/read their own payments (`user_id = auth.uid()`)
- UPDATE:
  - user can update their own unverified payment fields
  - admin can set `verified_at` and `verified_by` for trips they own

**Important:** Do not rely only on UI gating; RLS must enforce.

---

## Supabase Auth
- Enable email magic link.
- Configure Site URL to production domain.
- Configure redirect URLs:
  - `/trips`
  - `/invite/*`
  - `/admin/*` (optional)
- Ensure emails are delivered (Supabase default OK; Postmark later if needed).

---

## Storage
- Create bucket: `qr-codes` (public read)
- Upload Venmo QR images (and optionally CashApp)
- Store public URLs in `trips.venmo_qr_url` etc.

---

## Email Sending (Invites + Reminders)
Use Postmark from server-side routes (Vercel functions).

### Email types
1. Invite: “You’re invited to {Trip}”
2. Reminder RSVP: “RSVP needed for {Trip}”
3. Reminder Deposit: “Deposit due by {DATE} for {Trip}”

### Required environment variables
Vercel env vars:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only)
- `POSTMARK_SERVER_TOKEN`
- `FROM_EMAIL=invites@bigdeal.golf`
- `APP_URL=https://bigdeal.golf`

---

## Invite Flow (Implement Precisely)
1. Admin creates trip in `/admin`
2. Admin adds invite list (emails) in `/admin/trips/[id]`
3. Server route:
   - lowercases emails
   - creates `memberships` rows with:
     - `invited_email`
     - `invite_token = random secure token`
     - `status = invited`
     - `role = guest`
4. Server sends email with link:
   - `${APP_URL}/invite/${invite_token}`

### Claiming the invite
- `/invite/[token]` page:
  - if not logged in: redirect to `/login?next=/invite/[token]`
  - if logged in:
    - find membership by token
    - verify user email matches `invited_email` (case-insensitive)
    - set `user_id = auth.uid()`, `status = accepted`, `accepted_at = now()`
    - redirect to `/trips/[slug]`

Edge case: user logged in with different email → show error and “Switch account” instructions.

---

## Status Logic (UI)
For each member row:
- RSVP: show `Not RSVPed` if no row in `rsvps`
- Deposit:
  - no payment row → `Not reported`
  - payment exists and `verified_at is null` → `Reported`
  - `verified_at not null` → `Verified`

Admin roster table should filter:
- `Needs RSVP`
- `Deposit missing`
- `Reported not verified`

---

## UI Components (Minimal)
- TripCard: title, dates, RSVP status, deposit status
- TripDetail:
  - Overview
  - Itinerary list
  - Costs + deadlines
  - Payment section with QR image + memo string
  - Buttons: RSVP, I Paid
- RSVPForm modal
- PaymentForm modal
- AdminTripEditor (form)
- InviteList editor (textarea of emails + Send Invites button)
- RosterTable with quick actions:
  - Mark verified
  - Copy reminder list

---

## Implementation Steps (Cursor Task List)

### Phase 1 — Foundation
- [ ] Create Next.js app (TS, App Router)
- [ ] Add Supabase client setup (browser + server)
- [ ] Add auth session handling (middleware to protect routes)

### Phase 2 — Database + RLS
- [ ] Create tables in Supabase (SQL migrations)
- [ ] Enable RLS + policies (SQL)
- [ ] Create Storage bucket `qr-codes`

### Phase 3 — Member UX
- [ ] `/login` sends magic link
- [ ] `/trips` lists invited trips (via membership join)
- [ ] `/trips/[slug]` trip detail loads securely
- [ ] RSVP upsert
- [ ] Payment report insert/upsert

### Phase 4 — Admin UX
- [ ] `/admin` create trip
- [ ] `/admin/trips/[id]` edit trip fields + upload QR (or paste URL)
- [ ] Invite flow (server route) + Postmark email sending
- [ ] Roster table + mark verified action (server route uses service role or admin RLS)

### Phase 5 — Reminders
- [ ] Send reminders to filtered lists (server route)
- [ ] Store last reminder timestamp (optional: add `last_reminded_at` to memberships)

### Phase 6 — Deploy
- [ ] Deploy to Vercel
- [ ] Set env vars
- [ ] Configure domain `bigdeal.golf`
- [ ] Configure Supabase Auth redirect URLs
- [ ] End-to-end test: invite self, claim, RSVP, report payment, verify

---

## Seed Data Format (Example itinerary json)
```json
[
  { "day": "Friday", "title": "Arrival + warm-up round", "details": "Check-in, optional twilight, dinner plan TBD" },
  { "day": "Saturday", "title": "Main round + replay options", "details": "Morning tee time, afternoon replay if weather cooperates" },
  { "day": "Sunday", "title": "Morning golf + Super Bowl", "details": "Early round then game setup" }
]
