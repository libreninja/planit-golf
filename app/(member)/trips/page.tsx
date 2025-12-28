import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { TripCard } from '@/components/trips/TripCard'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default async function TripsPage() {
  const user = await requireAuth()
  const supabase = await createClient()

  // Get trips where user has membership
  const { data: memberships, error } = await supabase
    .from('memberships')
    .select(`
      trips (
        id,
        slug,
        title,
        location_name,
        start_date,
        end_date,
        deposit_due_date
      )
    `)
    .eq('user_id', user.id)
    .in('status', ['invited', 'accepted'])

  if (error) {
    return (
      <div className="container mx-auto py-8">
        <Card>
          <CardHeader>
            <CardTitle>Error</CardTitle>
            <CardDescription>Failed to load trips</CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  // Get RSVP and payment status for each trip
  const tripsWithStatus = await Promise.all(
    (memberships || []).map(async (membership) => {
      const trip = membership.trips as any
      
      // Get RSVP status
      const { data: rsvp } = await supabase
        .from('rsvps')
        .select('status')
        .eq('trip_id', trip.id)
        .eq('user_id', user.id)
        .single()

      // Get payment status
      const { data: payment } = await supabase
        .from('payments')
        .select('verified_at')
        .eq('trip_id', trip.id)
        .eq('user_id', user.id)
        .eq('type', 'deposit')
        .single()

      let paymentStatus = 'not_reported'
      if (payment) {
        paymentStatus = payment.verified_at ? 'verified' : 'reported'
      }

      return {
        ...trip,
        rsvp_status: rsvp?.status || null,
        payment_status: paymentStatus,
      }
    })
  )

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">My Trips</h1>
        <p className="text-muted-foreground">
          Trips you've been invited to
        </p>
      </div>

      {tripsWithStatus.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No trips yet</CardTitle>
            <CardDescription>
              You haven't been invited to any trips yet. Check your email for invite links!
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {tripsWithStatus.map((trip) => (
            <TripCard key={trip.id} trip={trip} />
          ))}
        </div>
      )}
    </div>
  )
}

