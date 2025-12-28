# Deploy planit.golf to Vercel

Since your domain is already pointing to Vercel, here's how to replace the Next.js starter with this Vite app:

## Step 1: Push This Code to GitHub

1. **Initialize git** (if not already):
   ```bash
   git init
   git add .
   git commit -m "Initial commit - planit.golf Vite app"
   ```

2. **Create a GitHub repo** (or use existing)

3. **Push to GitHub**:
   ```bash
   git remote add origin https://github.com/yourusername/your-repo.git
   git push -u origin main
   ```

## Step 2: Update Vercel Project

You have two options:

### Option A: Update Existing Vercel Project

1. **Go to Vercel Dashboard** → Your project
2. **Settings** → **General**
3. **Update Framework Preset**:
   - Change from "Next.js" to "Vite"
4. **Update Build Settings**:
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
   - **Install Command**: `npm install`
5. **Connect to new GitHub repo** (if using different repo)
6. **Redeploy**

### Option B: Create New Vercel Project (Recommended)

1. **Go to Vercel Dashboard**
2. **Add New Project**
3. **Import your GitHub repo** (the one with this Vite app)
4. **Configure**:
   - **Framework Preset**: Vite (auto-detected)
   - **Root Directory**: `./` (or leave default)
   - **Build Command**: `npm run build` (auto-detected)
   - **Output Directory**: `dist` (auto-detected)
5. **Environment Variables**:
   - Add `VITE_SUPABASE_URL`
   - Add `VITE_SUPABASE_ANON_KEY`
6. **Deploy**

7. **Update Custom Domain**:
   - Go to **Settings** → **Domains**
   - Remove old domain (if needed)
   - Add `planit.golf` (or it might already be there)
   - Vercel will verify DNS automatically

## Step 3: Environment Variables in Vercel

Add these in **Vercel Dashboard** → **Settings** → **Environment Variables**:

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

**Important**: Vite uses `VITE_` prefix (not `NEXT_PUBLIC_`)

## Step 4: Update Supabase Redirect URLs

1. **Go to Supabase Dashboard** → **Authentication** → **URL Configuration**
2. **Add/Update Redirect URLs**:
   - `https://planit.golf/login`
   - `https://planit.golf/**` (wildcard)
3. **Update Site URL**:
   - Set to `https://planit.golf`

## Step 5: Test Deployment

1. Visit `https://planit.golf`
2. Should see your login page
3. Try signing in - magic link should work

## Troubleshooting

### Build Fails
- Check that `vercel.json` is in the repo
- Verify `package.json` has correct build script
- Check Vercel build logs

### 404 Errors on Routes
- Make sure `vercel.json` has the rewrite rule (already included)
- This handles client-side routing

### Environment Variables Not Working
- Make sure they start with `VITE_`
- Redeploy after adding env vars
- Check Vercel logs

### Domain Not Working
- Check DNS in Namecheap (should already be set)
- Verify in Vercel → Settings → Domains
- Wait a few minutes for DNS propagation

## What Happens to Old Next.js App?

- If you're updating the same Vercel project: It gets replaced
- If creating new project: Old one stays but won't be connected to domain
- You can delete the old project later if needed

## Next Steps After Deployment

1. **Set up email** (Resend) - See `DOMAIN_AND_HOSTING_SETUP.md`
2. **Configure Supabase SMTP** - See `SUPABASE_PLANIT_GOLF_SETUP.md`
3. **Test magic link emails** - Should come from planit.golf
4. **Update email templates** - Customize in Supabase dashboard

