# Next Steps - Getting Started

## ✅ Completed
- [x] Supabase project created
- [x] Database migrations run
- [x] Dev server running
- [x] Auth working (confirmation email received)

## 🎯 Next Steps

### 1. Create Your First Trip (Admin)

1. **Log in** at `http://localhost:3000/login` with the email you just confirmed
2. **Go to Admin Dashboard** at `http://localhost:3000/admin`
   - You should see "No trips yet" since you haven't created any
3. **Click "Create Trip"**
4. **Fill in trip details:**
   - Title: e.g., "Bandon Crossings 2026"
   - Slug: auto-generated from title (e.g., `bandon-crossings-2026`)
   - Location, dates, deposit amount, etc.
   - Payment info (Venmo handle, Zelle, etc.)
5. **Save the trip**

### 2. Test the Invite Flow

1. **In the trip edit page**, go to the "Invites" tab
2. **Add email addresses** (one per line) - use a different email than your admin account
3. **Click "Send Invites"**
   - If Postmark isn't configured, you'll see invite links to copy manually
   - If Postmark is configured, emails will be sent automatically
4. **Copy an invite link** (if email not configured)
5. **Open in incognito/private window** and go to the invite link
6. **Log in** with the invited email address
7. **Verify** you're redirected to the trip page

### 3. Test Member Features

As the invited user:
1. **View trip details** - see overview, itinerary, payment info
2. **Submit RSVP** - click "RSVP" button, fill out form
3. **Report payment** - click "I Paid" button, enter payment details
4. **View your trips** - go to `/trips` to see your trip list

### 4. Test Admin Features

As admin:
1. **Go back to admin dashboard** (`/admin`)
2. **Click "Manage Trip"** on your trip
3. **Check the "Roster" tab:**
   - See all invited members
   - View RSVP status
   - View payment status
   - Filter by needs RSVP, needs deposit, etc.
4. **Verify a payment:**
   - If a member reported a payment, click "Verify Payment"
   - Status should change to "Verified"

### 5. Test Reminders (Optional - if email configured)

1. **In trip edit page**, go to "Roster" tab
2. **Filter** by "Needs RSVP" or "Needs Deposit"
3. **Send reminders** (if you have the reminder endpoint set up)

## 🔧 Environment Variables Check

Make sure your `.env.local` has:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
APP_URL=http://localhost:3000
FROM_EMAIL=invites@planit.golf
# POSTMARK_SERVER_TOKEN=optional
```

## 🐛 Troubleshooting

### Can't access `/admin`
- Make sure you're logged in with the email that created the trip
- Admin access is based on `created_by` field in trips table

### Invite link not working
- Check that the invite token matches in the database
- Verify the user email matches the `invited_email` in memberships table

### Can't see trips
- Verify RLS policies are enabled (migration 002)
- Check that memberships exist for your user

### Payment/RSVP not saving
- Check browser console for errors
- Verify RLS policies allow user to insert/update their own records

## 🚀 Ready for Production?

Once everything works locally:
1. Deploy to Vercel
2. Set environment variables in Vercel dashboard
3. Update Supabase Auth redirect URLs to production domain
4. Test end-to-end in production

