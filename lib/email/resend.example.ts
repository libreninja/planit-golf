/**
 * Example Resend implementation
 * 
 * To use Resend instead of Postmark:
 * 1. Install: npm install resend
 * 2. Get API key from https://resend.com
 * 3. Replace lib/email/postmark.ts with this file (renamed to postmark.ts)
 * 4. Update environment variable: RESEND_API_KEY instead of POSTMARK_SERVER_TOKEN
 */

import { Resend } from 'resend'

const resendApiKey = process.env.RESEND_API_KEY
const resend = resendApiKey ? new Resend(resendApiKey) : null

export function isEmailConfigured() {
  return !!resendApiKey
}

export async function sendInviteEmail(
  inviteToken: string,
  trip: { title: string; slug: string },
  email: string
) {
  if (!resend) {
    console.warn('Resend not configured - skipping email send')
    return { skipped: true }
  }

  const appUrl = process.env.APP_URL || 'http://localhost:3000'
  const inviteUrl = `${appUrl}/invite/${inviteToken}`

  try {
    await resend.emails.send({
      from: process.env.FROM_EMAIL || 'invites@planit.golf',
      to: email,
      subject: `You're invited to ${trip.title}`,
      html: `
        <h2>You're invited!</h2>
        <p>You've been invited to join <strong>${trip.title}</strong>.</p>
        <p><a href="${inviteUrl}" style="background-color: #0070f3; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">Accept Invite</a></p>
        <p>Or copy this link: <a href="${inviteUrl}">${inviteUrl}</a></p>
      `,
      text: `You've been invited to join ${trip.title}. Accept your invite here: ${inviteUrl}`,
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
  if (!resend) {
    console.warn('Resend not configured - skipping email send')
    return { skipped: true }
  }

  const appUrl = process.env.APP_URL || 'http://localhost:3000'
  const tripUrl = `${appUrl}/trips/${trip.slug}`

  try {
    await resend.emails.send({
      from: process.env.FROM_EMAIL || 'invites@planit.golf',
      to: email,
      subject: `RSVP needed for ${trip.title}`,
      html: `
        <h2>RSVP Reminder</h2>
        <p>Please RSVP for <strong>${trip.title}</strong>.</p>
        <p><a href="${tripUrl}" style="background-color: #0070f3; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">RSVP Now</a></p>
        <p>Or visit: <a href="${tripUrl}">${tripUrl}</a></p>
      `,
      text: `Please RSVP for ${trip.title}. Visit: ${tripUrl}`,
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
  if (!resend) {
    console.warn('Resend not configured - skipping email send')
    return { skipped: true }
  }

  const appUrl = process.env.APP_URL || 'http://localhost:3000'
  const tripUrl = `${appUrl}/trips/${trip.slug}`

  try {
    await resend.emails.send({
      from: process.env.FROM_EMAIL || 'invites@planit.golf',
      to: email,
      subject: `Deposit due for ${trip.title}`,
      html: `
        <h2>Deposit Reminder</h2>
        <p>Your deposit for <strong>${trip.title}</strong> is due by ${dueDate}.</p>
        <p><a href="${tripUrl}" style="background-color: #0070f3; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">View Trip & Pay</a></p>
        <p>Or visit: <a href="${tripUrl}">${tripUrl}</a></p>
      `,
      text: `Your deposit for ${trip.title} is due by ${dueDate}. Visit: ${tripUrl}`,
    })
  } catch (error) {
    console.error('Failed to send deposit reminder:', error)
    throw error
  }
}

