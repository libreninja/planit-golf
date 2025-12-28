import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { rsvpSchema } from '@/lib/validations/rsvp'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const user = await requireAuth()
    const supabase = await createClient()
    const body = await request.json()

    const { trip_id, ...rsvpData } = body

    // Validate input
    const validated = rsvpSchema.parse(rsvpData)

    // Upsert RSVP (user can only modify their own)
    const { data, error } = await supabase
      .from('rsvps')
      .upsert(
        {
          trip_id,
          user_id: user.id,
          ...validated,
        },
        {
          onConflict: 'trip_id,user_id',
        }
      )
      .select()
      .single()

    if (error) {
      console.error('RSVP error:', error)
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json(data)
  } catch (error: any) {
    console.error('RSVP error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to save RSVP' },
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

    if (!tripId) {
      return NextResponse.json({ error: 'trip_id required' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('rsvps')
      .select('*')
      .eq('trip_id', tripId)
      .eq('user_id', user.id)
      .single()

    if (error && error.code !== 'PGRST116') {
      // PGRST116 is "not found" which is OK
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json(data || null)
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to fetch RSVP' },
      { status: 400 }
    )
  }
}

