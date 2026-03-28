import { ServerClient } from 'postmark'

const postmarkToken = process.env.POSTMARK_SERVER_TOKEN
const client = postmarkToken ? new ServerClient(postmarkToken) : null
const fromEmail = process.env.FROM_EMAIL || 'welcome@planit.golf'
const replyToEmail = process.env.REPLY_TO_EMAIL || fromEmail

// Check if email is configured
export function isEmailConfigured() {
  return !!postmarkToken
}

export async function sendInviteEmail(inviteToken: string, email: string) {
  if (!client) {
    console.warn('Postmark not configured - skipping email send')
    return { skipped: true }
  }

  const appUrl = process.env.APP_URL || 'http://localhost:3000'
  const inviteUrl = `${appUrl}/invite/${inviteToken}`

  try {
    await client.sendEmail({
      From: fromEmail,
      ReplyTo: replyToEmail,
      To: email,
      Subject: 'You’re invited: Good to Go for IGC 2026',
      HtmlBody: `
        <div style="font-family: Georgia, serif; line-height: 1.6; color: #14281d;">
          <h2 style="margin: 0 0 16px;">Welcome to Good to Go.</h2>
          <p>The first rule of Good to Go is we don&apos;t talk about Good to Go.</p>
          <p>You&apos;re in for the <strong>IGC 2026 league</strong>. This is the private place to set your tee time preferences before the rush starts.</p>
          <p>No speeches. No ceremony. Just pick your times and be ready when the gate opens.</p>
          <p style="margin: 24px 0;">
            <a href="${inviteUrl}" style="background-color: #0f5132; color: white; padding: 12px 24px; text-decoration: none; border-radius: 9999px; display: inline-block; font-weight: 600;">Take your spot</a>
          </p>
          <p style="font-size: 14px; color: #4b6358;">If the button misbehaves, paste this into your browser:</p>
          <p style="font-size: 14px;"><a href="${inviteUrl}">${inviteUrl}</a></p>
          <hr style="border: 0; border-top: 1px solid #d6ddd8; margin: 24px 0;" />
          <p style="font-size: 13px; color: #4b6358;">
            This email was sent by planit.golf because an administrator invited you to Good to Go for the IGC 2026 league.
          </p>
        </div>
      `,
      TextBody: `Welcome to Good to Go. The first rule of Good to Go is we don't talk about Good to Go. You're in for the IGC 2026 league. Use this secure link to create your account or sign in: ${inviteUrl}\n\nThis email was sent by planit.golf because an administrator invited you to Good to Go for the IGC 2026 league.`,
    })
  } catch (error) {
    console.error('Failed to send invite email:', error)
    throw error
  }
}

export async function sendRSVPReminder(
  trip: { title: string; slug: string },
  email: string
) {
  if (!client) {
    console.warn('Postmark not configured - skipping email send')
    return { skipped: true }
  }

  const appUrl = process.env.APP_URL || 'http://localhost:3000'
  const tripUrl = `${appUrl}/trips/${trip.slug}`

  try {
    await client.sendEmail({
      From: process.env.FROM_EMAIL || 'invites@planit.golf',
      To: email,
      Subject: `RSVP needed for ${trip.title}`,
      HtmlBody: `
        <h2>RSVP Reminder</h2>
        <p>Please RSVP for <strong>${trip.title}</strong>.</p>
        <p><a href="${tripUrl}" style="background-color: #0070f3; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">RSVP Now</a></p>
        <p>Or visit: <a href="${tripUrl}">${tripUrl}</a></p>
      `,
      TextBody: `Please RSVP for ${trip.title}. Visit: ${tripUrl}`,
    })
  } catch (error) {
    console.error('Failed to send RSVP reminder:', error)
    throw error
  }
}

export async function sendDepositReminder(
  trip: { title: string; slug: string },
  email: string,
  dueDate: string
) {
  if (!client) {
    console.warn('Postmark not configured - skipping email send')
    return { skipped: true }
  }

  const appUrl = process.env.APP_URL || 'http://localhost:3000'
  const tripUrl = `${appUrl}/trips/${trip.slug}`

  try {
    await client.sendEmail({
      From: process.env.FROM_EMAIL || 'invites@planit.golf',
      To: email,
      Subject: `Deposit due for ${trip.title}`,
      HtmlBody: `
        <h2>Deposit Reminder</h2>
        <p>Your deposit for <strong>${trip.title}</strong> is due by ${dueDate}.</p>
        <p><a href="${tripUrl}" style="background-color: #0070f3; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">View Trip & Pay</a></p>
        <p>Or visit: <a href="${tripUrl}">${tripUrl}</a></p>
      `,
      TextBody: `Your deposit for ${trip.title} is due by ${dueDate}. Visit: ${tripUrl}`,
    })
  } catch (error) {
    console.error('Failed to send deposit reminder:', error)
    throw error
  }
}
