# Auth Troubleshooting

## Issue: Magic Link Redirects to Login

If clicking the magic link in your email just redirects you back to login, check these:

### 1. Supabase Redirect URL Configuration

In your Supabase dashboard:
1. Go to **Authentication** → **URL Configuration**
2. Make sure these redirect URLs are added:
   - `http://localhost:3000/api/auth/callback` (for local dev)
   - `https://planit.golf/api/auth/callback` (for production)

3. **Site URL** should be:
   - `http://localhost:3000` (for local dev)
   - `https://planit.golf` (for production)

### 2. Check Browser Console

Open browser DevTools (F12) and check:
- **Console tab**: Look for any errors
- **Network tab**: Check if the callback request is successful
- **Application/Storage tab**: Check if cookies are being set

### 3. Verify Environment Variables

Make sure `.env.local` has:
```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
```

### 4. Test the Callback Directly

Try accessing the callback URL manually:
```
http://localhost:3000/api/auth/callback?code=test
```

You should see a redirect (even if the code is invalid).

### 5. Check Supabase Logs

In Supabase dashboard:
1. Go to **Logs** → **Auth Logs**
2. Look for errors when clicking the magic link

### 6. Common Issues

**Issue**: "Invalid redirect URL"
- **Fix**: Add the callback URL to Supabase redirect URLs list

**Issue**: Session not persisting
- **Fix**: Check that cookies are being set (browser DevTools → Application → Cookies)
- **Fix**: Make sure you're not blocking third-party cookies

**Issue**: Middleware redirecting too early
- **Fix**: The middleware should allow `/api/auth/callback` through (already configured)

### 7. Manual Test

1. Request magic link
2. Check email for link
3. Copy the full URL from the email
4. Open in a new incognito window
5. Check browser console for errors
6. Check Network tab to see what requests are made

### 8. Reset Session

If stuck, try:
1. Clear browser cookies for localhost
2. Request a new magic link
3. Try again

