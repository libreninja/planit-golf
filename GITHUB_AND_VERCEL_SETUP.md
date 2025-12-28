# Push to GitHub and Connect to Vercel

## Step 1: Create GitHub Repository

1. **Go to [github.com](https://github.com)** and log in
2. **Click the "+" icon** in the top right → **New repository**
3. **Repository details**:
   - **Name**: `planit-golf` (or whatever you prefer)
   - **Description**: "Golf trip planning app for planit.golf"
   - **Visibility**: Private (recommended) or Public
   - **DO NOT** initialize with README, .gitignore, or license (we already have these)
4. **Click "Create repository"**

## Step 2: Push Code to GitHub

After creating the repo, GitHub will show you commands. Use these:

```bash
cd /Users/jbizzle/projects/bigdeal

# Add the remote (replace YOUR_USERNAME with your GitHub username)
git remote add origin https://github.com/YOUR_USERNAME/planit-golf.git

# Or if using SSH:
# git remote add origin git@github.com:YOUR_USERNAME/planit-golf.git

# Push to GitHub
git branch -M main
git push -u origin main
```

**Note**: If you haven't set up GitHub authentication, you may need to:
- Use a Personal Access Token (Settings → Developer settings → Personal access tokens)
- Or set up SSH keys

## Step 3: Connect Vercel to GitHub Repo

### Option A: Update Existing Vercel Project

1. **Go to Vercel Dashboard** → Find the project serving planit.golf
2. **Settings** → **Git**
3. **Disconnect** current repository (if connected to different repo)
4. **Connect Git Repository**:
   - Click "Connect Git Repository"
   - Select your GitHub account
   - Choose `planit-golf` (or whatever you named it)
   - Click "Connect"
5. **Update Build Settings**:
   - **Framework Preset**: Vite (or "Other")
   - **Root Directory**: `./` (leave default)
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
   - **Install Command**: `npm install`
6. **Environment Variables**:
   - Go to **Settings** → **Environment Variables**
   - Add:
     - `VITE_SUPABASE_URL` = your Supabase URL
     - `VITE_SUPABASE_ANON_KEY` = your Supabase anon key
7. **Redeploy**:
   - Go to **Deployments** tab
   - Click "Redeploy" or push a new commit

### Option B: Create New Vercel Project (Recommended)

1. **Go to Vercel Dashboard** → **Add New Project**
2. **Import Git Repository**:
   - Select your GitHub account
   - Choose `planit-golf` repository
   - Click "Import"
3. **Configure Project**:
   - **Framework Preset**: Vite (should auto-detect)
   - **Root Directory**: `./` (default)
   - **Build Command**: `npm run build` (auto-detected)
   - **Output Directory**: `dist` (auto-detected)
   - **Install Command**: `npm install` (auto-detected)
4. **Environment Variables**:
   - Click "Add" and add:
     - `VITE_SUPABASE_URL` = your Supabase URL
     - `VITE_SUPABASE_ANON_KEY` = your Supabase anon key
5. **Deploy**:
   - Click "Deploy"
   - Wait for build to complete
6. **Add Custom Domain**:
   - Go to **Settings** → **Domains**
   - Add `planit.golf`
   - If it's already connected to another project, you'll need to remove it from the old project first

## Step 4: Update Supabase Redirect URLs

1. **Go to Supabase Dashboard** → **Authentication** → **URL Configuration**
2. **Add Redirect URLs**:
   - `https://planit.golf/login`
   - `https://planit.golf/**` (wildcard)
3. **Update Site URL**:
   - Set to `https://planit.golf`

## Step 5: Verify Deployment

1. **Visit** `https://planit.golf`
2. **Should see** your login page (not the Next.js starter)
3. **Test login** - magic link should work

## Troubleshooting

### Build Fails
- Check Vercel build logs
- Verify `package.json` has correct scripts
- Make sure `vercel.json` exists (it does)

### 404 on Routes
- Verify `vercel.json` has the rewrite rule (already configured)
- This handles React Router client-side routing

### Environment Variables Not Working
- Make sure they start with `VITE_` prefix
- Redeploy after adding env vars
- Check Vercel logs

### Domain Not Updating
- Wait a few minutes for DNS propagation
- Check Vercel → Settings → Domains shows planit.golf
- Verify DNS in Namecheap still points to Vercel

## Next Steps After Deployment

1. **Set up email** (Resend) - See `DOMAIN_AND_HOSTING_SETUP.md`
2. **Configure Supabase SMTP** - See `SUPABASE_PLANIT_GOLF_SETUP.md`
3. **Test magic link emails** - Should come from planit.golf
4. **Customize email templates** - In Supabase dashboard

