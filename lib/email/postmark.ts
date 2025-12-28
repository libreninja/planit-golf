import { ServerClient } from 'postmark'

const postmarkToken = process.env.POSTMARK_SERVER_TOKEN
const client = postmarkToken ? new ServerClient(postmarkToken) : null

// Check if email is configured
export function isEmailConfigured() {
  return !!postmarkToken
}

export async function sendInviteEmail(
  inviteToken: string,
  trip: { title: string; slug: string },
  email: string
) {
  if (!client) {
    console.warn('Postmark not configured - skipping email send')
    return { skipped: true }
  }

  const appUrl = process.env.APP_URL || 'http://localhost:3000'
  const inviteUrl = `${appUrl}/invite/${inviteToken}`

  try {
    await client.sendEmail({
      From: process.env.FROM_EMAIL || 'invites@planit.golf',
      To: email,
      Subject: `You're invited to ${trip.title}`,
      HtmlBody: `
        <h2>You're invited!</h2>
        <p>You've been invited to join <strong>${trip.title}</strong>.</p>
        <p><a href="${inviteUrl}" style="background-color: #0070f3; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">Accept Invite</a></p>
        <p>Or copy this link: <a href="${inviteUrl}">${inviteUrl}</a></p>
      `,
      TextBody: `You've been invited to join ${trip.title}. Accept your invite here: ${inviteUrl}`,
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

