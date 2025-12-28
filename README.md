# planit.golf

A cloud-hosted, invite-only golf trip planning web app. Built with React + Vite, Supabase, and deployed on Vercel.

## Features

- **Magic Link Authentication** - No passwords required
- **Invite-Only Access** - Users can only see trips they've been invited to
- **RSVP Management** - Guests can RSVP with arrival/departure details
- **Payment Tracking** - Report payments and admin verification
- **Admin Dashboard** - Create trips, send invites, manage roster
- **Email Notifications** - Invites and reminders via Postmark

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Database**: Supabase (PostgreSQL with RLS)
- **Auth**: Supabase Auth (Magic Links)
- **Styling**: Tailwind CSS + shadcn/ui
- **Email**: Postmark
- **Deployment**: Vercel

## Setup

### Prerequisites

- Node.js 18+
- Supabase account
- Postmark account (optional - for email sending)
- Vercel account (for deployment)

### Environment Variables

Create a `.env.local` file:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# Postmark (Optional - if not set, invite links will be shown in UI for manual sharing)
POSTMARK_SERVER_TOKEN=your_postmark_token

# Email
FROM_EMAIL=invites@planit.golf
APP_URL=https://planit.golf
```

### Database Setup

1. Run the migrations in `supabase/migrations/`:
   - `001_initial_schema.sql` - Creates all tables
   - `002_rls_policies.sql` - Sets up Row Level Security

2. Create a Storage bucket named `qr-codes` with public read access

3. Configure Supabase Auth:
   - Enable email magic links
   - Set Site URL to your production domain
   - Add redirect URLs:
     - `/trips`
     - `/invite/*`
     - `/admin/*`

### Installation

```bash
npm install
npm run dev
```

## Deployment

### Vercel

1. Connect your GitHub repository to Vercel
2. Add all environment variables in Vercel dashboard
3. Deploy

### Domain Configuration

1. Configure custom domain in Vercel
2. Update `APP_URL` environment variable
3. Update Supabase Auth redirect URLs

## Project Structure

```
app/
  (auth)/          # Public auth routes
  (member)/        # Member-facing routes
  (admin)/         # Admin routes
  api/             # API routes
components/
  ui/              # shadcn/ui components
  trips/           # Trip-related components
  admin/           # Admin components
  auth/            # Auth components
lib/
  supabase/        # Supabase clients
  email/           # Email utilities
  validations/     # Zod schemas
supabase/
  migrations/      # Database migrations
```

## Security

- All database access is protected by Row Level Security (RLS)
- Admin routes check `created_by = auth.uid()`
- Service role key only used in server routes
- Invite tokens are cryptographically secure

## License

Private project

