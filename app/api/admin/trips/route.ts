import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { tripSchema } from '@/lib/validations/trip'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const user = await requireAuth()
    const supabase = await createClient()
    const body = await request.json()

    // Validate input
    const validated = tripSchema.parse(body)

    // Create trip (RLS will ensure user is admin)
    const { data, error } = await supabase
      .from('trips')
      .insert({
        ...validated,
        created_by: user.id,
      })
      .select()
      .single()

    if (error) {
      console.error('Trip creation error:', error)
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json(data)
  } catch (error: any) {
    console.error('Trip creation error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to create trip' },
      { status: 400 }
    )
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireAuth()
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'id required' }, { status: 400 })
    }

    const body = await request.json()

    // Validate input
    const validated = tripSchema.parse(body)

    // Update trip (RLS will ensure user is the creator)
    const { data, error } = await supabase
      .from('trips')
      .update(validated)
      .eq('id', id)
      .eq('created_by', user.id)
      .select()
      .single()

    if (error) {
      console.error('Trip update error:', error)
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json(data)
  } catch (error: any) {
    console.error('Trip update error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to update trip' },
      { status: 400 }
    )
  }
}

