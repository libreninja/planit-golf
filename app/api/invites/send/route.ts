import { createServiceClient } from '@/lib/supabase/service'
import { requireAuth } from '@/lib/auth'
import { sendInviteEmail, isEmailConfigured } from '@/lib/email/postmark'
import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'

export async function POST(request: Request) {
  try {
    const user = await requireAuth()
    const supabase = await createServiceClient()
    const body = await request.json()

    const { trip_id, emails } = body

    if (!trip_id || !Array.isArray(emails) || emails.length === 0) {
      return NextResponse.json(
        { error: 'trip_id and emails array required' },
        { status: 400 }
      )
    }

    // Verify user is admin (created the trip)
    const { data: trip, error: tripError } = await supabase
      .from('trips')
      .select('id, title, slug')
      .eq('id', trip_id)
      .eq('created_by', user.id)
      .single()

    if (tripError || !trip) {
      return NextResponse.json({ error: 'Trip not found' }, { status: 404 })
    }

    // Process emails
    const processedEmails = emails
      .map((email: string) => email.trim().toLowerCase())
      .filter((email: string) => email && email.includes('@'))

    if (processedEmails.length === 0) {
      return NextResponse.json(
        { error: 'No valid emails provided' },
        { status: 400 }
      )
    }

    let sent = 0
    let failed = 0

    // Create memberships and send invites
    for (const email of processedEmails) {
      try {
        // Generate secure invite token
        const inviteToken = randomBytes(32).toString('hex')

        // Check if membership already exists
        const { data: existing } = await supabase
          .from('memberships')
          .select('id')
          .eq('trip_id', trip_id)
          .eq('invited_email', email)
          .single()

        if (existing) {
          // Update existing membership with new token
          await supabase
            .from('memberships')
            .update({
              invite_token: inviteToken,
              status: 'invited',
            })
            .eq('id', existing.id)
        } else {
          // Create new membership
          await supabase.from('memberships').insert({
            trip_id,
            invited_email: email,
            invite_token: inviteToken,
            status: 'invited',
            role: 'guest',
          })
        }

        // Send email (if configured)
        const emailResult = await sendInviteEmail(inviteToken, trip, email)
        if (!emailResult?.skipped) {
          sent++
        } else {
          // Email not configured, but invite was created
          sent++
        }
      } catch (error) {
        console.error(`Failed to invite ${email}:`, error)
        failed++
      }
    }

    return NextResponse.json({ 
      sent, 
      failed,
      email_configured: isEmailConfigured()
    })
  } catch (error: any) {
    console.error('Invite error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to send invites' },
      { status: 400 }
    )
  }
}

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

    const { data, error } = await supabase
      .from('memberships')
      .select('*')
      .eq('trip_id', tripId)
      .order('invited_at', { ascending: false })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json(data || [])
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to fetch invites' },
      { status: 400 }
    )
  }
}

