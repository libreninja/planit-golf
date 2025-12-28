import { createServiceClient } from '@/lib/supabase/service'
import { requireAuth } from '@/lib/auth'
import { NextResponse } from 'next/server'

export async function PATCH(request: Request) {
  try {
    const user = await requireAuth()
    const supabase = await createServiceClient()
    const body = await request.json()

    const { payment_id } = body

    if (!payment_id) {
      return NextResponse.json(
        { error: 'payment_id required' },
        { status: 400 }
      )
    }

    // Get payment and verify admin owns the trip
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .select(`
        id,
        trip_id,
        trips!inner (
          id,
          created_by
        )
      `)
      .eq('id', payment_id)
      .single()

    if (paymentError || !payment) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
    }

    if (payment.trips.created_by !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Update payment
    const { data, error } = await supabase
      .from('payments')
      .update({
        verified_at: new Date().toISOString(),
        verified_by: user.id,
      })
      .eq('id', payment_id)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json(data)
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to verify payment' },
      { status: 400 }
    )
  }
}

