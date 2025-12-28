# Supabase Setup Guide

## Step 1: Create a Supabase Project

1. Go to [https://supabase.com](https://supabase.com) and sign in (or create an account)
2. Click **"New Project"**
3. Fill in the details:
   - **Name**: e.g., "Trip HQ" or "bigdeal"
   - **Database Password**: Choose a strong password (save it securely!)
   - **Region**: Choose the region closest to you/your users
4. Click **"Create new project"** (takes 1-2 minutes)

## Step 2: Get Your API Keys

1. In your Supabase project dashboard, go to **Settings** → **API**
2. Copy these values (you'll need them for `.env.local`):
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role** key → `SUPABASE_SERVICE_ROLE_KEY` (⚠️ Keep this secret!)

## Step 3: Run Database Migrations

1. In your Supabase dashboard, go to **SQL Editor**
2. Click **"New query"**
3. Copy and paste the contents of `supabase/migrations/001_initial_schema.sql`
4. Click **"Run"** (or press Cmd/Ctrl + Enter)
5. Wait for success message
6. Create a new query and run `supabase/migrations/002_rls_policies.sql`

**Alternative: Using Supabase CLI** (if you have it installed)
```bash
supabase db push
```

## Step 4: Set Up Storage Bucket

1. Go to **Storage** in the Supabase dashboard
2. Click **"New bucket"**
3. Name it: `qr-codes`
4. Make it **Public** (toggle on)
5. Click **"Create bucket"**

## Step 5: Configure Authentication

1. Go to **Authentication** → **URL Configuration**
2. Set **Site URL** to your production domain (or `http://localhost:3000` for local dev)
3. Add these **Redirect URLs**:
   - `http://localhost:3000/auth/callback` (for local dev - REQUIRED)
   - `http://localhost:3000/trips` (for local dev)
   - `http://localhost:3000/invite/*` (for local dev)
   - `http://localhost:3000/admin/*` (for local dev)
   - `https://planit.golf/auth/callback` (for production - REQUIRED)
   - `https://planit.golf/trips` (for production)
   - `https://planit.golf/invite/*` (for production)
   - `https://planit.golf/admin/*` (for production)

4. Go to **Authentication** → **Providers**
5. Ensure **Email** provider is enabled
6. Configure email templates if desired (or use Supabase defaults)

## Step 6: Set Up Environment Variables

Create a `.env.local` file in your project root:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here

# Postmark (Optional - if not set, invite links will be shown in UI for manual sharing)
# Get from postmarkapp.com if you want automated email sending
POSTMARK_SERVER_TOKEN=your-postmark-token

# Email
FROM_EMAIL=invites@planit.golf
APP_URL=http://localhost:3000
```

## Step 7: Verify Setup

1. Start your Next.js dev server: `npm run dev`
2. Try logging in at `http://localhost:3000/login`
3. Check that you receive the magic link email

## Troubleshooting

### Migration Errors
- Make sure you run migrations in order (001 before 002)
- Check that all tables were created (check in Table Editor)

### Storage Issues
- Verify the bucket is named exactly `qr-codes`
- Ensure the bucket is set to **Public**
- Check bucket policies allow read access

### Auth Issues
- Verify redirect URLs are correctly configured
- Check that email provider is enabled
- Ensure Site URL matches your actual domain

### RLS Policy Issues
- Policies are created in migration 002
- Test with a user account to verify access control works
- Use the service role key only in server-side API routes

## Next Steps

After Supabase is set up:
1. (Optional) Set up Postmark for automated email sending, or skip and use invite links from the UI
2. Deploy to Vercel
3. Update environment variables in Vercel
4. Update Supabase redirect URLs to production domain

**Note:** If you don't set up Postmark, the app will still work! Invite links will be displayed in the admin UI so you can copy and share them manually via text, email, or any other method.

