import { createServiceClient } from '@/lib/supabase/service'
import { requireAuth } from '@/lib/auth'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  try {
    const user = await requireAuth()
    const supabase = await createServiceClient()
    const { searchParams } = new URL(request.url)
    const tripId = searchParams.get('trip_id')

    if (!tripId) {
      return NextResponse.json({ error: 'trip_id required' }, { status: 400 })
    }

    // Verify user is admin
    const { data: trip } = await supabase
      .from('trips')
      .select('id')
      .eq('id', tripId)
      .eq('created_by', user.id)
      .single()

    if (!trip) {
      return NextResponse.json({ error: 'Trip not found' }, { status: 404 })
    }

    // Get all memberships with user info
    const { data: memberships, error: membershipsError } = await supabase
      .from('memberships')
      .select(`
        id,
        invited_email,
        status,
        invited_at,
        accepted_at,
        user_id,
        users:user_id (
          email
        )
      `)
      .eq('trip_id', tripId)

    if (membershipsError) {
      return NextResponse.json(
        { error: membershipsError.message },
        { status: 400 }
      )
    }

    // Get RSVPs and payments for each member
    const roster = await Promise.all(
      (memberships || []).map(async (membership: any) => {
        const userId = membership.user_id

        // Get RSVP
        let rsvpStatus = null
        if (userId) {
          const { data: rsvp } = await supabase
            .from('rsvps')
            .select('status')
            .eq('trip_id', tripId)
            .eq('user_id', userId)
            .single()
          rsvpStatus = rsvp?.status || null
        }

        // Get payment
        let paymentStatus = 'not_reported'
        let paymentId = null
        let paymentAmount = null
        if (userId) {
          const { data: payment } = await supabase
            .from('payments')
            .select('id, amount_cents, verified_at')
            .eq('trip_id', tripId)
            .eq('user_id', userId)
            .eq('type', 'deposit')
            .single()

          if (payment) {
            paymentId = payment.id
            paymentAmount = payment.amount_cents
            paymentStatus = payment.verified_at ? 'verified' : 'reported'
          }
        }

        return {
          id: membership.id,
          invited_email: membership.invited_email,
          user_email: membership.users?.email || null,
          status: membership.status,
          rsvp_status: rsvpStatus,
          payment_status: paymentStatus,
          payment_id: paymentId,
          payment_amount: paymentAmount,
        }
      })
    )

    return NextResponse.json(roster)
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to fetch roster' },
      { status: 400 }
    )
  }
}

