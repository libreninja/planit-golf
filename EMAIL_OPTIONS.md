# Email Service Options

## What You're Giving Up Without Email

Without an email service, you lose:
1. **Automated invite emails** - Users won't automatically receive invite links
2. **RSVP reminders** - No automated reminders to RSVP
3. **Deposit reminders** - No automated payment deadline reminders

**But you still have:**
- ✅ Invite links displayed in admin UI (copy & share manually)
- ✅ All core functionality (RSVP, payments, trip management)
- ✅ Users can still claim invites via the links

## Email Service Alternatives

### 1. **Resend** (Recommended - Easiest) ⭐
- **Free tier**: 100 emails/day, 3,000/month
- **Setup**: 5 minutes
- **Pros**: 
  - Modern API, great DX
  - Easy domain verification
  - Built for developers
  - Generous free tier
- **Cons**: Newer service (but very reliable)
- **Best for**: Most use cases

### 2. **SendGrid**
- **Free tier**: 100 emails/day forever
- **Setup**: 10-15 minutes
- **Pros**: 
  - Established, reliable
  - Good free tier
  - Detailed analytics
- **Cons**: 
  - More complex setup
  - Domain verification can be tedious
- **Best for**: If you need analytics

### 3. **Mailgun**
- **Free tier**: 5,000 emails/month for 3 months, then paid
- **Setup**: 10 minutes
- **Pros**: 
  - Good free trial
  - Reliable delivery
- **Cons**: 
  - Free tier expires
  - More expensive after trial
- **Best for**: Short-term testing

### 4. **AWS SES** (Cheapest at Scale)
- **Cost**: $0.10 per 1,000 emails (after free tier)
- **Free tier**: 62,000 emails/month (if on EC2)
- **Setup**: 20-30 minutes
- **Pros**: 
  - Extremely cheap
  - Very reliable
  - Scales well
- **Cons**: 
  - More complex setup
  - AWS account required
  - Domain verification required
- **Best for**: High volume or cost-conscious

### 5. **Nodemailer with Gmail/SMTP** (Free but Limited)
- **Cost**: Free
- **Setup**: 10 minutes
- **Pros**: 
  - Completely free
  - Simple setup
- **Cons**: 
  - Gmail: 500 emails/day limit
  - Can hit spam filters
  - Not recommended for production
- **Best for**: Development/testing only

### 6. **Self-Hosted** (Advanced)
- **Options**: Postfix, Mail-in-a-Box, Mailcow
- **Cost**: Server costs only
- **Setup**: 2-4 hours
- **Pros**: 
  - Full control
  - No per-email costs
- **Cons**: 
  - Complex setup & maintenance
  - Deliverability issues
  - IP reputation management
  - Not recommended unless you're experienced
- **Best for**: Advanced users only

## Recommendation

**For most users**: Start with **Resend** - it's the easiest to set up and has a generous free tier.

**For high volume**: Consider **AWS SES** once you outgrow free tiers.

**For now**: You can skip email entirely and use the manual invite link sharing - it works perfectly fine!

## Quick Setup: Resend (Recommended)

1. Sign up at [resend.com](https://resend.com) (free tier: 100 emails/day)
2. Verify your domain (add DNS records)
3. Get your API key
4. Install: `npm install resend`
5. Replace `lib/email/postmark.ts` with `lib/email/resend.example.ts` (rename it)
6. Update env var: `RESEND_API_KEY=your_key` instead of `POSTMARK_SERVER_TOKEN`

That's it! Resend is much easier to set up than Postmark.

## Implementation

The codebase is already set up to easily switch email providers. See:
- `lib/email/postmark.ts` - Current Postmark implementation
- `lib/email/resend.example.ts` - Example Resend implementation

Both use the same function signatures, so switching is just a file swap!

