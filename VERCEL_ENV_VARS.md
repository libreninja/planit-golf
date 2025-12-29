# Vercel Environment Variables Setup

The error "supabaseUrl is required" means your environment variables aren't set in Vercel.

## Quick Fix

1. **Go to Vercel Dashboard**: https://vercel.com/dashboard
2. **Select your project** (planit-golf)
3. **Go to Settings** → **Environment Variables**
4. **Add these two variables**:

   ```
   VITE_SUPABASE_URL=https://your-project-id.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key-here
   ```

5. **Important**: 
   - Use `VITE_` prefix (not `NEXT_PUBLIC_`)
   - Make sure they're set for **Production**, **Preview**, and **Development** environments
   - Click "Save" after adding each one

6. **Redeploy**:
   - Go to **Deployments** tab
   - Click the three dots (⋯) on the latest deployment
   - Click "Redeploy"

## Where to Find Your Supabase Credentials

1. **Go to Supabase Dashboard**: https://supabase.com/dashboard
2. **Select your project**
3. **Go to Settings** → **API**
4. **Copy**:
   - **Project URL** → This is your `VITE_SUPABASE_URL`
   - **anon/public key** → This is your `VITE_SUPABASE_ANON_KEY`

## Verify It's Working

After redeploying, check the browser console. You should NOT see the "supabaseUrl is required" error anymore.

## Troubleshooting

### Still seeing the error?
- Make sure variable names are exactly: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
- Check that values don't have extra spaces or quotes
- Verify the deployment completed successfully
- Clear your browser cache and hard refresh (Cmd+Shift+R or Ctrl+Shift+R)

### Variables not updating?
- Vercel caches environment variables. After adding them, you MUST redeploy
- Make sure you clicked "Save" after adding each variable
- Check that you selected all environments (Production, Preview, Development)

