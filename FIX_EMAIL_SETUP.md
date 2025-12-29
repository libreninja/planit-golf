# Fix Email Setup - Magic Links from planit.golf

You're currently getting OTP code emails instead of magic links. Here's how to fix it:

## Step 1: Update Email Template in Supabase

1. **Go to Supabase Dashboard** → Your project → **Authentication** → **Email Templates**

2. **Click on "Magic Link" template**

3. **Replace the entire template** with this (this sends a clickable link, not a code):

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="text-align: center; margin-bottom: 30px;">
    <h1 style="color: #2563eb; margin: 0; font-size: 32px;">planit.golf</h1>
  </div>
  
  <div style="background: #f9fafb; border-radius: 8px; padding: 30px; margin-bottom: 20px;">
    <h2 style="margin-top: 0; color: #111827;">Sign in to planit.golf</h2>
    <p style="margin-bottom: 30px;">Click the button below to sign in to your account:</p>
    
    <div style="text-align: center; margin: 30px 0;">
      <a href="{{ .ConfirmationURL }}" style="display: inline-block; background: #2563eb; color: white; text-decoration: none; padding: 14px 28px; border-radius: 6px; font-weight: 600;">
        Sign in to planit.golf
      </a>
    </div>
    
    <p style="font-size: 14px; color: #6b7280; margin-top: 30px;">
      Or copy and paste this link into your browser:<br>
      <a href="{{ .ConfirmationURL }}" style="color: #2563eb; word-break: break-all; font-size: 12px;">{{ .ConfirmationURL }}</a>
    </p>
  </div>
  
  <p style="font-size: 12px; color: #9ca3af; text-align: center; margin-top: 30px;">
    This link will expire in 1 hour. If you didn't request this email, you can safely ignore it.
  </p>
  
  <p style="font-size: 12px; color: #9ca3af; text-align: center; margin-top: 10px;">
    © planit.golf
  </p>
</body>
</html>
```

**IMPORTANT**: Make sure you're using `{{ .ConfirmationURL }}` (for magic links), NOT `{{ .Token }}` (for OTP codes).

4. **Click "Save"**

## Step 2: Set Up Custom SMTP (Resend - Recommended)

This will make emails come from `noreply@planit.golf` instead of Supabase.

### A. Set Up Resend

1. **Sign up at [resend.com](https://resend.com)** (free tier: 3,000 emails/month)

2. **Add your domain**:
   - Go to **Domains** → **Add Domain**
   - Enter `planit.golf`
   - Resend will show you DNS records to add

3. **Add DNS records in Namecheap**:
   - Log into Namecheap
   - Go to **Domain List** → Click **Manage** next to planit.golf
   - Go to **Advanced DNS**
   - Add the records Resend provides:
     - **DKIM records** (multiple TXT records)
     - **SPF record** (TXT record)
     - **DMARC record** (TXT record - optional but recommended)

4. **Wait for verification** (usually 5-15 minutes)

5. **Get your API key**:
   - Go to **API Keys** in Resend dashboard
   - Click **Create API Key**
   - Name it "Supabase SMTP"
   - Copy the key (you'll need it in the next step)

### B. Configure in Supabase

1. **Go to Supabase Dashboard** → **Project Settings** → **Auth** → **SMTP Settings**

2. **Enable "Custom SMTP"**

3. **Enter these settings**:
   - **SMTP Host**: `smtp.resend.com`
   - **SMTP Port**: `587`
   - **SMTP User**: `resend`
   - **SMTP Password**: Your Resend API key (from step A.5)
   - **Sender Email**: `noreply@planit.golf`
   - **Sender Name**: `planit.golf`

4. **Click "Save"**

5. **Test it**:
   - Go to **Authentication** → **Users**
   - Click on a user
   - Click "Send magic link" to test

## Step 3: Verify It's Working

1. **Go to your app** and try to sign in
2. **Check your email** - it should:
   - Come from `noreply@planit.golf` (not Supabase)
   - Have a clickable "Sign in to planit.golf" button
   - Show planit.golf branding
   - NOT show any OTP codes

## Troubleshooting

### Still getting OTP codes?
- Make sure the email template uses `{{ .ConfirmationURL }}` not `{{ .Token }}`
- Check that you saved the template
- Try signing in again (Supabase might cache the old template)

### Emails not sending?
- Check Resend dashboard for errors
- Verify DNS records are correct in Namecheap
- Check Supabase logs: **Logs** → **Auth Logs**

### Emails going to spam?
- Make sure SPF/DKIM records are set up correctly
- Wait a few hours for DNS to propagate
- Check Resend dashboard for deliverability issues

### Magic link not working?
- Verify redirect URLs in Supabase: **Authentication** → **URL Configuration**
- Make sure `https://planit.golf/login` is in the redirect URLs
- Check that Site URL is set to `https://planit.golf`

## Alternative: Use SendGrid Instead of Resend

If you prefer SendGrid:

1. Sign up at [sendgrid.com](https://sendgrid.com)
2. Verify your domain (similar DNS setup)
3. Create an API key
4. In Supabase SMTP settings:
   - **SMTP Host**: `smtp.sendgrid.net`
   - **SMTP Port**: `587`
   - **SMTP User**: `apikey`
   - **SMTP Password**: Your SendGrid API key
   - **Sender Email**: `noreply@planit.golf`
   - **Sender Name**: `planit.golf`

