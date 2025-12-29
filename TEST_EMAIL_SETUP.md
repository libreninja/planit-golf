# Test Email Setup

## Quick Test Steps

### 1. Test Magic Link Email

1. **Go to your app**: `https://planit.golf/login` (or `http://localhost:5173/login` for local)

2. **Enter your email address** and click "Send magic link"

3. **Check your email inbox** (and spam folder if needed)

4. **Verify the email**:
   - ✅ **From address**: Should be `noreply@planit.golf` (NOT Supabase)
   - ✅ **Subject**: Should mention planit.golf
   - ✅ **Content**: Should have a clickable "Sign in to planit.golf" button
   - ✅ **No OTP codes**: Should NOT show any 6-digit codes
   - ✅ **Branding**: Should show planit.golf styling

5. **Click the magic link button** (or copy/paste the link)

6. **Verify you're signed in**:
   - Should redirect to `/trips` page
   - Should see "My Trips" page
   - Should NOT see login page

### 2. Test Email Deliverability

**Check these in your email client:**

- ✅ Email arrives (not in spam)
- ✅ "From" shows as `planit.golf` or `noreply@planit.golf`
- ✅ Email renders correctly (button works, styling looks good)
- ✅ Link works when clicked

### 3. Check Supabase Logs (If Issues)

1. **Go to Supabase Dashboard** → **Logs** → **Auth Logs**
2. **Look for**:
   - Email send attempts
   - Any errors
   - Delivery status

### 4. Test Different Scenarios

**Test these cases:**

1. **New user signup**:
   - Use an email that's never signed up before
   - Should create account and send magic link

2. **Existing user login**:
   - Use an email that already has an account
   - Should send magic link (not create new account)

3. **Link expiration**:
   - Wait 1+ hour after receiving email
   - Try clicking the link
   - Should show error (link expired)

4. **Multiple requests**:
   - Request magic link multiple times
   - Each should send a new email
   - Only the latest link should work

## Common Issues & Fixes

### Email Not Arriving

**Check:**
- Spam/junk folder
- Resend dashboard (if using Resend) for delivery status
- Supabase Auth Logs for errors
- DNS records are correct (SPF, DKIM)

**Fix:**
- Wait a few minutes (DNS can take time)
- Verify DNS records in Namecheap match Resend's requirements
- Check Resend dashboard for domain verification status

### Still Getting OTP Codes

**Check:**
- Email template in Supabase uses `{{ .ConfirmationURL }}` not `{{ .Token }}`
- Template is saved
- Try signing in again (clear cache)

**Fix:**
- Go to Supabase → Authentication → Email Templates → Magic Link
- Verify template uses `{{ .ConfirmationURL }}`
- Save and try again

### Email From Supabase (Not planit.golf)

**Check:**
- Custom SMTP is enabled in Supabase
- SMTP credentials are correct
- Domain is verified in Resend (if using Resend)

**Fix:**
- Go to Supabase → Project Settings → Auth → SMTP Settings
- Verify "Custom SMTP" is enabled
- Check all SMTP settings match Resend's requirements
- Verify domain in Resend dashboard shows "Verified"

### Magic Link Doesn't Work

**Check:**
- Redirect URLs in Supabase include your domain
- Site URL is set correctly
- Link hasn't expired

**Fix:**
- Go to Supabase → Authentication → URL Configuration
- Add redirect URL: `https://planit.golf/login`
- Set Site URL to: `https://planit.golf`
- Try requesting a new magic link

### Email Goes to Spam

**Check:**
- SPF record is set up correctly
- DKIM records are verified
- Domain reputation (new domains can have issues)

**Fix:**
- Verify all DNS records in Namecheap match Resend's requirements
- Wait 24-48 hours for domain reputation to improve
- Consider setting up DMARC record (optional but helps)

## Success Checklist

After testing, you should have:

- ✅ Emails arrive in inbox (not spam)
- ✅ Email from `noreply@planit.golf`
- ✅ Clickable magic link button works
- ✅ No OTP codes shown
- ✅ planit.golf branding visible
- ✅ Clicking link signs you in successfully
- ✅ Redirects to trips page after login

## Next Steps

Once email is working:

1. **Test with a real user** (someone else's email)
2. **Monitor Resend dashboard** for delivery rates
3. **Set up DMARC** (optional, improves deliverability)
4. **Consider email analytics** (track open rates, click rates)

