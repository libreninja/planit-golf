# Fix Magic Link Redirect to Production

The magic link is redirecting to localhost instead of production. Here's how to fix it:

## Step 1: Add Environment Variable in Vercel

1. **Go to Vercel Dashboard** → Your project → **Settings** → **Environment Variables**

2. **Add new variable**:
   - **Name**: `VITE_APP_URL`
   - **Value**: `https://planit.golf`
   - **Environment**: Production, Preview, Development (select all)

3. **Click "Save"**

4. **Redeploy** your project (go to Deployments → Redeploy)

## Step 2: Update Supabase Settings

1. **Go to Supabase Dashboard** → **Authentication** → **URL Configuration**

2. **Set Site URL**:
   - Change to: `https://planit.golf`
   - (Remove any localhost URLs)

3. **Update Redirect URLs**:
   - Remove: `http://localhost:5173/login` (if present)
   - Keep: `https://planit.golf/login`
   - Keep: `https://planit.golf/**` (wildcard)
   - Add: `https://planit.golf` (root)

4. **Click "Save"**

## Step 3: Verify Email Template

1. **Go to Supabase** → **Authentication** → **Email Templates** → **Magic Link**

2. **Check the template** - make sure it uses:
   - `{{ .ConfirmationURL }}` (not hardcoded localhost)

3. **The template should NOT have** any hardcoded URLs like:
   - `http://localhost:5173`
   - `http://localhost:3000`

4. **Save** if you made changes

## Step 4: Test

1. **Request a new magic link** from production (`https://planit.golf/login`)

2. **Check the email** - the link should point to `https://planit.golf/login?...`

3. **Click the link** - should redirect to production, not localhost

## Troubleshooting

### Still redirecting to localhost?

**Check:**
- Vercel environment variable `VITE_APP_URL` is set to `https://planit.golf`
- Project has been redeployed after adding the variable
- Supabase Site URL is `https://planit.golf`
- Supabase redirect URLs don't include localhost

**Fix:**
- Remove localhost from Supabase redirect URLs
- Redeploy Vercel project
- Request a fresh magic link (old links might still have localhost)

### Link shows localhost in email?

**Check:**
- Email template doesn't have hardcoded localhost
- Supabase Site URL is correct
- `emailRedirectTo` in code uses `VITE_APP_URL`

**Fix:**
- Update email template to use `{{ .ConfirmationURL }}` only
- Verify `VITE_APP_URL` is set in Vercel
- Redeploy

### Works locally but not in production?

**This is expected!** The code now:
- Uses `VITE_APP_URL` in production (set to `https://planit.golf`)
- Falls back to `window.location.origin` in local dev (localhost)

This means:
- ✅ Production magic links → `https://planit.golf`
- ✅ Local dev magic links → `http://localhost:5173`

## Verification Checklist

After fixing, verify:

- ✅ `VITE_APP_URL` is set in Vercel to `https://planit.golf`
- ✅ Project has been redeployed
- ✅ Supabase Site URL is `https://planit.golf`
- ✅ Supabase redirect URLs include `https://planit.golf/login`
- ✅ No localhost URLs in Supabase settings
- ✅ Email template uses `{{ .ConfirmationURL }}` (not hardcoded)
- ✅ Magic link in email points to `https://planit.golf`
- ✅ Clicking link redirects to production site

