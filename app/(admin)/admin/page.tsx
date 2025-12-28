import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { format } from 'date-fns'

export default async function AdminPage() {
  const user = await requireAuth()
  const supabase = await createClient()

  // Get all trips created by this user
  const { data: trips, error } = await supabase
    .from('trips')
    .select('*')
    .eq('created_by', user.id)
    .order('created_at', { ascending: false })

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

  // Get stats for each trip
  const tripsWithStats = await Promise.all(
    (trips || []).map(async (trip) => {
      // Count members
      const { count: memberCount } = await supabase
        .from('memberships')
        .select('*', { count: 'exact', head: true })
        .eq('trip_id', trip.id)

      // Count RSVPs
      const { count: rsvpCount } = await supabase
        .from('rsvps')
        .select('*', { count: 'exact', head: true })
        .eq('trip_id', trip.id)
        .eq('status', 'yes')

      // Count verified payments
      const { count: paymentCount } = await supabase
        .from('payments')
        .select('*', { count: 'exact', head: true })
        .eq('trip_id', trip.id)
        .eq('type', 'deposit')
        .not('verified_at', 'is', null)

      return {
        ...trip,
        memberCount: memberCount || 0,
        rsvpCount: rsvpCount || 0,
        paymentCount: paymentCount || 0,
      }
    })
  )

  const formatDate = (date: string | null) => {
    if (!date) return null
    return format(new Date(date), 'MMM d, yyyy')
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="mb-8 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold mb-2">Admin Dashboard</h1>
          <p className="text-muted-foreground">
            Manage your trips
          </p>
        </div>
        <Button asChild>
          <Link href="/admin/trips/new">Create Trip</Link>
        </Button>
      </div>

      {tripsWithStats.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No trips yet</CardTitle>
            <CardDescription>
              Create your first trip to get started.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/admin/trips/new">Create Trip</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {tripsWithStats.map((trip) => (
            <Card key={trip.id} className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <CardTitle>{trip.title}</CardTitle>
                {trip.location_name && (
                  <CardDescription>{trip.location_name}</CardDescription>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                {(trip.start_date || trip.end_date) && (
                  <div className="text-sm text-muted-foreground">
                    {trip.start_date && trip.end_date ? (
                      <>
                        {formatDate(trip.start_date)} - {formatDate(trip.end_date)}
                      </>
                    ) : (
                      trip.start_date && formatDate(trip.start_date)
                    )}
                  </div>
                )}
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <div className="font-medium">{trip.memberCount}</div>
                    <div className="text-muted-foreground">Members</div>
                  </div>
                  <div>
                    <div className="font-medium">{trip.rsvpCount}</div>
                    <div className="text-muted-foreground">RSVPs</div>
                  </div>
                  <div>
                    <div className="font-medium">{trip.paymentCount}</div>
                    <div className="text-muted-foreground">Paid</div>
                  </div>
                </div>
                <Button asChild variant="outline" className="w-full">
                  <Link href={`/admin/trips/${trip.id}`}>Manage Trip</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

