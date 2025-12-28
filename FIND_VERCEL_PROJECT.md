# How to Find Your Vercel Project

Since planit.golf is already deployed on Vercel, here's how to find which project it is:

## Method 1: Check Vercel Dashboard (Easiest)

1. **Go to [vercel.com](https://vercel.com)** and log in
2. **Go to your Dashboard**
3. **Look for projects** - You should see a list of all your projects
4. **Check each project's domains**:
   - Click on a project
   - Go to **Settings** → **Domains**
   - Look for `planit.golf` in the list
   - That's your project!

## Method 2: Check Vercel CLI (If Installed)

If you have Vercel CLI installed:

```bash
# Install Vercel CLI (if not installed)
npm i -g vercel

# Login to Vercel
vercel login

# List all projects
vercel projects list

# Or check current directory's project
vercel inspect
```

## Method 3: Check GitHub Repositories

1. **Go to your GitHub account**
2. **Look for repositories** that might be connected to Vercel
3. **Check if any have Vercel deployments**:
   - Look for a Vercel badge in README
   - Check repository settings for Vercel integration
   - Look for `.vercel` folder in the repo

## Method 4: Check DNS Records

1. **Log into Namecheap**
2. **Go to Domain List** → **Manage** for planit.golf
3. **Go to Advanced DNS**
4. **Look for CNAME or A records** pointing to Vercel
5. **The record value** might give you clues (though it's usually just `cname.vercel-dns.com`)

## Method 5: Check Vercel Project Settings

Once you find the project in Vercel:

1. **Go to the project**
2. **Settings** → **General**
   - Check **Framework Preset** (should say "Next.js" for the current app)
   - Check **Git Repository** (shows which GitHub repo it's connected to)
3. **Settings** → **Domains**
   - Should show `planit.golf` and `www.planit.golf`

## What to Look For

The project serving planit.golf will have:
- **Domain**: `planit.golf` in the domains list
- **Framework**: Likely "Next.js" (for the starter app)
- **Git Repository**: Connected to a GitHub repo (might be a starter template)

## Next Steps After Finding It

Once you find the project, you can:

### Option A: Update the Existing Project
- Change framework from "Next.js" to "Vite"
- Update build settings
- Connect to your new GitHub repo with this Vite app
- Redeploy

### Option B: Create New Project (Recommended)
- Create a new Vercel project
- Import your GitHub repo with this Vite app
- Add `planit.golf` as a custom domain
- Remove domain from old project (or delete old project)

## Quick Check: Vercel Dashboard

The fastest way:
1. **vercel.com/dashboard**
2. **Look at all projects**
3. **Click each one** → **Settings** → **Domains**
4. **Find the one with `planit.golf`**

That's your project!

