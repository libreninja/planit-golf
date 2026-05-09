# planit.golf

A Next.js and Supabase web app for Interbay Golf Club tee-time preferences, event companions, public pace tools, and lightweight admin operations.

## Features

- **Good to Go** - invite-gated league tee-time preference collection
- **IGC event companion** - public event shell, local Golf Genius imports, leaderboard, feed, and logistics
- **Public pace board** - QR-driven pace timing and leaderboard
- **Admin dashboard** - roster sync, invites, registration runs, and operational tools
- **Email notifications** - invite delivery through SMTP when configured

## Tech Stack

- **Framework**: Next.js App Router
- **Language**: TypeScript
- **Database**: Supabase (PostgreSQL with RLS)
- **Auth**: Supabase Auth (Magic Links)
- **Styling**: Tailwind CSS + shadcn/ui
- **Email**: SMTP via Nodemailer
- **Deployment**: Vercel

## Setup

### Prerequisites

- Node.js 18+
- Supabase account
- SMTP credentials (optional - for email sending)
- Vercel account (for deployment)

### Environment Variables

Create a `.env.local` file:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# Golf Genius
GOLF_GENIUS_API_KEY=your_golf_genius_api_key
GOLF_GENIUS_BASE_URL=https://www.golfgenius.com

# Email (optional - if unset, invite links can still be shared manually)
SMTP_HOST=smtp.example.com
SMTP_PORT=465
SMTP_USER=your_smtp_user
SMTP_PASS=your_smtp_password
FROM_EMAIL=invites@planit.golf
REPLY_TO_EMAIL=invites@planit.golf
APP_URL=https://planit.golf
```

### Database Setup

1. Run the migrations in `supabase/migrations/` in filename order.

2. Create a Storage bucket named `qr-codes` with public read access

3. Configure Supabase Auth:
   - Enable email magic links
   - Set Site URL to your production domain
   - Add redirect URLs:
     - `/invite/*`
     - `/admin/*`
     - `/auth/callback`

### Installation

```bash
pnpm install
pnpm dev
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
  (admin)/         # Admin routes
  igc/             # IGC event companion routes
  scan/            # Public QR scan routes
  api/             # API routes
components/
  ui/              # shadcn/ui components
  igc/             # IGC event companion components
  admin/           # Admin components
  auth/            # Auth components
lib/
  supabase/        # Supabase clients
  igc/             # IGC data access and Golf Genius sync
  email/           # Email utilities
  validations/     # Zod schemas
supabase/
  migrations/      # Database migrations
```

## Security

- All database access is protected by Row Level Security (RLS)
- Admin routes check `profiles.is_admin` / `profiles.is_system_admin`
- Service role key only used in server routes
- Golf Genius credentials are server-side only
- Invite tokens are cryptographically secure

## License

Private project
