# Configure Supabase for OTP Codes (Not Magic Links)

To get 6-digit codes instead of magic links, you need to configure Supabase's email template.

## Steps:

1. **Go to Supabase Dashboard** → **Authentication** → **Email Templates**

2. **Edit the "Magic Link" template** (or create a custom one)

3. **Change the template to show the OTP code:**

Replace the template content with:
```html
<h2>Your Verification Code</h2>
<p>Your verification code is: <strong>{{ .Token }}</strong></p>
<p>Enter this code to sign in. It expires in 10 minutes.</p>
```

Or use this simpler version:
```
Your verification code is: {{ .Token }}

Enter this code to sign in. It expires in 10 minutes.
```

**Note:** The code length may vary. Just copy and paste the entire code from the email.

4. **Save the template**

5. **Important:** Make sure `emailRedirectTo` is NOT set in your code (which we've already done)

## Alternative: Use Passwordless Email Template

If available, you can also:
1. Go to **Authentication** → **Email Templates**
2. Look for "Passwordless" or "OTP" template
3. Enable/configure that template instead

## Test

After updating the template:
1. Request a code from your app
2. Check your email - you should see a 6-digit code
3. Enter the code in the app

The `{{ .Token }}` variable will be replaced with the actual 6-digit code.

