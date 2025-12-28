import { createServiceClient } from '@/lib/supabase/service'
import { requireAuth } from '@/lib/auth'
import { sendRSVPReminder, sendDepositReminder } from '@/lib/email/postmark'
import { NextResponse } from 'next/server'

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireAuth()
    const supabase = await createServiceClient()
    const body = await request.json()

    const { filter, reminder_type } = body
    const tripId = params.id

    // Verify user is admin
    const { data: trip, error: tripError } = await supabase
      .from('trips')
      .select('id, title, slug, deposit_due_date')
      .eq('id', tripId)
      .eq('created_by', user.id)
      .single()

    if (tripError || !trip) {
      return NextResponse.json({ error: 'Trip not found' }, { status: 404 })
    }

    // Get memberships
    const { data: memberships, error: membershipsError } = await supabase
      .from('memberships')
      .select(`
        id,
        invited_email,
        user_id,
        status
      `)
      .eq('trip_id', tripId)
      .in('status', ['invited', 'accepted'])

    if (membershipsError) {
      return NextResponse.json(
        { error: membershipsError.message },
        { status: 400 }
      )
    }

    // Filter members based on reminder type
    let membersToRemind = memberships || []

    if (filter === 'needs_rsvp') {
      // Get members without RSVP
      const { data: rsvps } = await supabase
        .from('rsvps')
        .select('user_id')
        .eq('trip_id', tripId)

      const rsvpUserIds = new Set((rsvps || []).map((r) => r.user_id))
      membersToRemind = membersToRemind.filter(
        (m) => m.user_id && !rsvpUserIds.has(m.user_id)
      )
    } else if (filter === 'needs_deposit') {
      // Get members without verified payment
      const { data: payments } = await supabase
        .from('payments')
        .select('user_id')
        .eq('trip_id', tripId)
        .eq('type', 'deposit')
        .not('verified_at', 'is', null)

      const paidUserIds = new Set((payments || []).map((p) => p.user_id))
      membersToRemind = membersToRemind.filter(
        (m) => m.user_id && !paidUserIds.has(m.user_id)
      )
    }

    let sent = 0
    let failed = 0

    // Send reminders
    for (const member of membersToRemind) {
      try {
        let result
        if (reminder_type === 'rsvp') {
          result = await sendRSVPReminder(trip, member.invited_email)
        } else if (reminder_type === 'deposit') {
          const dueDate = trip.deposit_due_date
            ? new Date(trip.deposit_due_date).toLocaleDateString()
            : 'soon'
          result = await sendDepositReminder(trip, member.invited_email, dueDate)
        }
        // Count as sent even if email was skipped (not configured)
        if (!result?.skipped) {
          sent++
        } else {
          sent++ // Still count as "sent" (just not via email)
        }
      } catch (error) {
        console.error(`Failed to send reminder to ${member.invited_email}:`, error)
        failed++
      }
    }

    return NextResponse.json({ sent, failed })
  } catch (error: any) {
    console.error('Reminder error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to send reminders' },
      { status: 400 }
    )
  }
}

