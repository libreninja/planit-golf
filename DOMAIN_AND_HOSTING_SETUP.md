# planit.golf Domain & Hosting Setup Guide

## Current Situation
- Domain: `planit.golf` registered through Namecheap
- App: React + Vite (static site)
- Hosting: Not yet decided

## Step 1: Set Up Email (Do This First)

You can set up email independently of hosting. Here are the best options:

### Option A: Resend (Recommended - Easiest)

**Why Resend?**
- Free tier: 3,000 emails/month
- Easy setup
- Great deliverability
- Simple API
- Custom domain support

**Setup Steps:**

1. **Sign up at [resend.com](https://resend.com)**

2. **Add your domain:**
   - Go to **Domains** → **Add Domain**
   - Enter `planit.golf`
   - Resend will give you DNS records to add

3. **Add DNS records in Namecheap:**
   - Log into Namecheap
   - Go to **Domain List** → Click **Manage** next to planit.golf
   - Go to **Advanced DNS**
   - Add the records Resend provides:
     - **DKIM records** (TXT records)
     - **SPF record** (TXT record)
     - **DMARC record** (TXT record)

4. **Verify domain in Resend** (takes a few minutes)

5. **Get your API key** from Resend dashboard

6. **Configure in Supabase:**
   - Go to Supabase Dashboard → **Project Settings** → **Auth** → **SMTP Settings**
   - Enable **Custom SMTP**
   - **SMTP Host**: `smtp.resend.com`
   - **SMTP Port**: `587`
   - **SMTP User**: `resend`
   - **SMTP Password**: Your Resend API key
   - **Sender Email**: `noreply@planit.golf`
   - **Sender Name**: `planit.golf`

### Option B: SendGrid (Alternative)

**Why SendGrid?**
- Free tier: 100 emails/day
- More established
- Good deliverability

**Setup:**
1. Sign up at [sendgrid.com](https://sendgrid.com)
2. Verify your domain (similar DNS setup)
3. Create API key
4. Configure in Supabase with SendGrid SMTP settings

### Option C: Google Workspace (If You Want Full Email)

**Why Google Workspace?**
- Full email accounts (you@planit.golf)
- Professional setup
- Costs ~$6/month per user

**Setup:**
1. Sign up for Google Workspace
2. Verify domain ownership
3. Use Gmail SMTP in Supabase

## Step 2: Hosting Options

Since you're using Vite + React, you need static hosting. Here are the best options:

### Option A: Vercel (Recommended - Easiest)

**Why Vercel?**
- Free tier is generous
- Automatic deployments from Git
- Great for React apps
- Easy custom domain setup
- Built-in SSL

**Setup:**
1. Push your code to GitHub
2. Sign up at [vercel.com](https://vercel.com)
3. Import your GitHub repo
4. Vercel auto-detects Vite and builds
5. Add custom domain: `planit.golf`
6. Vercel gives you DNS records to add in Namecheap

**DNS in Namecheap:**
- Add **A Record** or **CNAME** that Vercel provides
- Point to Vercel's servers

### Option B: Netlify (Alternative)

**Why Netlify?**
- Similar to Vercel
- Free tier available
- Easy setup

**Setup:** Similar to Vercel - connect GitHub, add domain

### Option C: Cloudflare Pages (Free + Fast)

**Why Cloudflare Pages?**
- Completely free
- Fast CDN
- Easy setup
- Good if you're already using Cloudflare

### Option D: Railway / Render (If You Need More Control)

**Why Railway/Render?**
- More control over build process
- Can run Node.js if needed later
- Still easy to use

## Step 3: DNS Configuration in Namecheap

Once you choose hosting, you'll need to point your domain:

### For Vercel/Netlify:

1. **Log into Namecheap**
2. **Domain List** → **Manage** → **Advanced DNS**
3. **Add Record:**
   - **Type**: `CNAME` or `A Record` (hosting provider will tell you)
   - **Host**: `@` (for root domain) or `www` (for www.planit.golf)
   - **Value**: Provided by your hosting service
   - **TTL**: Automatic

### For Email (Resend/SendGrid):

You'll add these records separately:
- **TXT records** for SPF, DKIM, DMARC (provided by email service)
- These don't conflict with hosting records

## Step 4: Environment Variables

Once hosting is set up, add these in your hosting platform:

```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

**Note:** Vite uses `VITE_` prefix for public env vars (not `NEXT_PUBLIC_`)

## Recommended Order of Operations

1. **Set up email first** (Resend) - Can be done now
   - Sign up for Resend
   - Add DNS records in Namecheap
   - Configure Supabase SMTP
   - Test email sending

2. **Choose hosting** (Vercel recommended)
   - Push code to GitHub
   - Deploy to Vercel
   - Add custom domain
   - Add DNS records in Namecheap

3. **Update Supabase redirect URLs**
   - Add `https://planit.golf/login` to allowed redirects
   - Update Site URL to `https://planit.golf`

## Quick Start: Email Setup Right Now

If you want to get email working immediately:

1. **Sign up for Resend** (5 minutes)
2. **Add domain in Resend** (2 minutes)
3. **Copy DNS records from Resend** (1 minute)
4. **Add DNS records in Namecheap** (5 minutes)
   - Go to Advanced DNS
   - Add each TXT record Resend provides
5. **Wait for verification** (5-30 minutes)
6. **Configure Supabase SMTP** (5 minutes)
7. **Test** - Send yourself a magic link!

Total time: ~30 minutes

## DNS Records You'll Need

### For Email (Resend):
- **DKIM**: Multiple TXT records (Resend provides)
- **SPF**: One TXT record
- **DMARC**: One TXT record

### For Hosting (Vercel):
- **A Record** or **CNAME**: Points domain to Vercel
- **CNAME for www**: Points www.planit.golf to Vercel

These can coexist - DNS supports multiple record types for the same domain.

## Questions?

- **Email working but hosting not ready?** That's fine! You can test locally and emails will work.
- **Hosting ready but email not?** You can deploy, but auth emails won't send until email is configured.
- **Want to test locally?** Use `http://localhost:5173` - Supabase will send emails even in dev mode.

## Next Steps

1. **Right now**: Set up Resend email (follow steps above)
2. **When ready**: Choose hosting (Vercel recommended)
3. **Deploy**: Push to GitHub, connect to Vercel
4. **Point domain**: Add DNS records in Namecheap
5. **Update Supabase**: Add production redirect URLs

