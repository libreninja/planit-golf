# Configure Supabase for planit.golf Branding

This guide will help you configure Supabase Auth to send all emails from planit.golf, so users never see Supabase branding.

## Step 1: Configure Custom SMTP in Supabase

1. Go to your **Supabase Dashboard** → **Project Settings** → **Auth** → **SMTP Settings**

2. Enable **Custom SMTP** and configure:
   - **SMTP Host**: Your email provider's SMTP server (e.g., `smtp.gmail.com`, `smtp.sendgrid.net`, or your custom SMTP)
   - **SMTP Port**: Usually `587` (TLS) or `465` (SSL)
   - **SMTP User**: Your email address (e.g., `noreply@planit.golf`)
   - **SMTP Password**: Your email account password or app-specific password
   - **Sender Email**: `noreply@planit.golf` (or `hello@planit.golf`)
   - **Sender Name**: `planit.golf`

**Note**: You'll need to set up email for planit.golf first. Options:
- **Google Workspace** (if you have planit.golf domain): Use Gmail SMTP
- **SendGrid**: Free tier available, supports custom domains
- **Resend**: Modern email API, great for transactional emails
- **AWS SES**: If you're using AWS infrastructure
- **Your hosting provider**: Many provide SMTP services

## Step 2: Configure Site URL and Redirect URLs

1. Go to **Authentication** → **URL Configuration**

2. Set **Site URL**:
   - Production: `https://planit.golf`
   - Local dev: `http://localhost:5173` (or your Vite dev port)

3. Add **Redirect URLs**:
   - `https://planit.golf/login` (production)
   - `http://localhost:5173/login` (local dev)
   - `https://planit.golf/**` (wildcard for all routes)
   - `http://localhost:5173/**` (wildcard for local dev)

## Step 3: Customize Email Templates

1. Go to **Authentication** → **Email Templates**

2. **Magic Link Template** - Replace with:

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="text-align: center; margin-bottom: 30px;">
    <h1 style="color: #2563eb; margin: 0;">planit.golf</h1>
  </div>
  
  <div style="background: #f9fafb; border-radius: 8px; padding: 30px; margin-bottom: 20px;">
    <h2 style="margin-top: 0; color: #111827;">Sign in to planit.golf</h2>
    <p style="margin-bottom: 30px;">Click the button below to sign in to your account:</p>
    
    <a href="{{ .ConfirmationURL }}" style="display: inline-block; background: #2563eb; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 600; margin: 20px 0;">
      Sign in to planit.golf
    </a>
    
    <p style="font-size: 14px; color: #6b7280; margin-top: 30px;">
      Or copy and paste this link into your browser:<br>
      <a href="{{ .ConfirmationURL }}" style="color: #2563eb; word-break: break-all;">{{ .ConfirmationURL }}</a>
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

3. **Change Email Template** - Update if you want to allow email changes:

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="text-align: center; margin-bottom: 30px;">
    <h1 style="color: #2563eb; margin: 0;">planit.golf</h1>
  </div>
  
  <div style="background: #f9fafb; border-radius: 8px; padding: 30px; margin-bottom: 20px;">
    <h2 style="margin-top: 0; color: #111827;">Confirm your new email</h2>
    <p>Click the button below to confirm your new email address:</p>
    
    <a href="{{ .ConfirmationURL }}" style="display: inline-block; background: #2563eb; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 600; margin: 20px 0;">
      Confirm Email
    </a>
  </div>
  
  <p style="font-size: 12px; color: #9ca3af; text-align: center; margin-top: 30px;">
    If you didn't request this change, please contact support.
  </p>
</body>
</html>
```

4. **Reset Password Template** (if you enable password auth later):

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="text-align: center; margin-bottom: 30px;">
    <h1 style="color: #2563eb; margin: 0;">planit.golf</h1>
  </div>
  
  <div style="background: #f9fafb; border-radius: 8px; padding: 30px; margin-bottom: 20px;">
    <h2 style="margin-top: 0; color: #111827;">Reset your password</h2>
    <p>Click the button below to reset your password:</p>
    
    <a href="{{ .ConfirmationURL }}" style="display: inline-block; background: #2563eb; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 600; margin: 20px 0;">
      Reset Password
    </a>
  </div>
  
  <p style="font-size: 12px; color: #9ca3af; text-align: center; margin-top: 30px;">
    This link will expire in 1 hour. If you didn't request this, you can safely ignore it.
  </p>
</body>
</html>
```

## Step 4: Test the Setup

1. Start your dev server: `npm run dev`
2. Go to `http://localhost:5173/login`
3. Enter your email and click "Send magic link"
4. Check your email - it should:
   - Come from `noreply@planit.golf` (or your configured sender)
   - Have planit.golf branding
   - Link should work and sign you in

## Step 5: Verify Email Domain (Important for Deliverability)

To ensure emails don't go to spam:

1. **Set up SPF record** in your DNS:
   ```
   TXT record: v=spf1 include:_spf.supabase.co ~all
   ```
   (Or include your SMTP provider's SPF if using custom SMTP)

2. **Set up DKIM** (if using custom SMTP, your provider will give you DKIM keys)

3. **Set up DMARC** (optional but recommended):
   ```
   TXT record: _dmarc.planit.golf
   Value: v=DMARC1; p=none; rua=mailto:dmarc@planit.golf
   ```

## Troubleshooting

### Emails not sending
- Check SMTP credentials are correct
- Verify SMTP port (587 for TLS, 465 for SSL)
- Check Supabase logs: **Logs** → **Auth Logs**

### Emails going to spam
- Set up SPF/DKIM records
- Use a reputable email service (SendGrid, Resend, etc.)
- Warm up your domain (send emails gradually)

### Magic link not working
- Verify redirect URLs are configured correctly
- Check that Site URL matches your domain
- Ensure the link hasn't expired (1 hour default)

## Next Steps

Once configured, users will:
- Receive emails from planit.golf
- See planit.golf branding in all emails
- Never see Supabase mentioned anywhere
- Have a seamless sign-in experience

