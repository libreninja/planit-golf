import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { paymentSchema } from '@/lib/validations/payment'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const user = await requireAuth()
    const supabase = await createClient()
    const body = await request.json()

    const { trip_id, type, ...paymentData } = body

    // Validate input
    const validated = paymentSchema.parse(paymentData)

    // Upsert payment (user can only create/modify their own)
    const { data, error } = await supabase
      .from('payments')
      .upsert(
        {
          trip_id,
          user_id: user.id,
          type: type || 'deposit',
          ...validated,
        },
        {
          onConflict: 'trip_id,user_id,type',
        }
      )
      .select()
      .single()

    if (error) {
      console.error('Payment error:', error)
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json(data)
  } catch (error: any) {
    console.error('Payment error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to save payment' },
      { status: 400 }
    )
  }
}

export async function GET(request: Request) {
  try {
    const user = await requireAuth()
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const tripId = searchParams.get('trip_id')
    const type = searchParams.get('type') || 'deposit'

    if (!tripId) {
      return NextResponse.json({ error: 'trip_id required' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('payments')
      .select('*')
      .eq('trip_id', tripId)
      .eq('user_id', user.id)
      .eq('type', type)
      .single()

    if (error && error.code !== 'PGRST116') {
      // PGRST116 is "not found" which is OK
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json(data || null)
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to fetch payment' },
      { status: 400 }
    )
  }
}

