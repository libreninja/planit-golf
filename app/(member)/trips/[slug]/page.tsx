import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { notFound } from 'next/navigation'
import { format } from 'date-fns'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import Image from 'next/image'
import { RSVPForm } from '@/components/trips/RSVPForm'
import { PaymentForm } from '@/components/trips/PaymentForm'

export default async function TripDetailPage({
  params,
}: {
  params: { slug: string }
}) {
  const user = await requireAuth()
  const supabase = await createClient()

  // Get trip by slug (RLS will enforce membership check)
  const { data: trip, error: tripError } = await supabase
    .from('trips')
    .select('*')
    .eq('slug', params.slug)
    .single()

  if (tripError || !trip) {
    notFound()
  }

  // Get user's RSVP
  const { data: rsvp } = await supabase
    .from('rsvps')
    .select('*')
    .eq('trip_id', trip.id)
    .eq('user_id', user.id)
    .single()

  // Get user's payment
  const { data: payment } = await supabase
    .from('payments')
    .select('*')
    .eq('trip_id', trip.id)
    .eq('user_id', user.id)
    .eq('type', 'deposit')
    .single()

  const itinerary = trip.itinerary as Array<{
    day: string
    title: string
    details: string
  }> | null

  const formatDate = (date: string | null) => {
    if (!date) return null
    return format(new Date(date), 'MMMM d, yyyy')
  }

  const formatCurrency = (cents: number) => {
    return `$${(cents / 100).toFixed(2)}`
  }

  const getMemoTemplate = () => {
    if (!trip.required_memo_template) return ''
    // Simple template replacement - could be enhanced
    return trip.required_memo_template
  }

  return (
    <div className="container mx-auto py-8 px-4 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-2">{trip.title}</h1>
        {trip.location_name && (
          <p className="text-xl text-muted-foreground">{trip.location_name}</p>
        )}
        {(trip.start_date || trip.end_date) && (
          <p className="text-muted-foreground mt-2">
            {trip.start_date && trip.end_date ? (
              <>
                {formatDate(trip.start_date)} - {formatDate(trip.end_date)}
              </>
            ) : (
              trip.start_date && formatDate(trip.start_date)
            )}
          </p>
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* Overview */}
        {trip.overview && (
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle>Overview</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="prose max-w-none whitespace-pre-wrap">
                {trip.overview}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Quick Actions */}
        <Card>
          <CardHeader>
            <CardTitle>Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <RSVPForm tripId={trip.id} existingRSVP={rsvp || null} />
            <PaymentForm tripId={trip.id} existingPayment={payment || null} depositAmount={trip.deposit_amount_cents} />
          </CardContent>
        </Card>

        {/* Itinerary */}
        {itinerary && itinerary.length > 0 && (
          <Card className="md:col-span-2 lg:col-span-3">
            <CardHeader>
              <CardTitle>Itinerary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {itinerary.map((item, index) => (
                  <div key={index} className="border-l-4 border-primary pl-4 py-2">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline">{item.day}</Badge>
                      <h3 className="font-semibold">{item.title}</h3>
                    </div>
                    {item.details && (
                      <p className="text-sm text-muted-foreground">{item.details}</p>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Payment Information */}
        <Card className="md:col-span-2 lg:col-span-3">
          <CardHeader>
            <CardTitle>Payment Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {trip.deposit_amount_cents > 0 && (
              <div>
                <p className="text-sm font-medium mb-1">Deposit Amount</p>
                <p className="text-2xl font-bold">{formatCurrency(trip.deposit_amount_cents)}</p>
                {trip.deposit_due_date && (
                  <p className="text-sm text-muted-foreground mt-1">
                    Due by: {formatDate(trip.deposit_due_date)}
                  </p>
                )}
              </div>
            )}

            {trip.required_memo_template && (
              <div>
                <p className="text-sm font-medium mb-1">Payment Memo</p>
                <p className="text-sm bg-muted p-2 rounded font-mono">
                  {getMemoTemplate()}
                </p>
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              {trip.venmo_handle && (
                <div>
                  <p className="text-sm font-medium mb-2">Venmo</p>
                  <p className="text-sm">@{trip.venmo_handle}</p>
                  {trip.venmo_qr_url && (
                    <div className="mt-2">
                      <Image
                        src={trip.venmo_qr_url}
                        alt="Venmo QR Code"
                        width={200}
                        height={200}
                        className="rounded"
                      />
                    </div>
                  )}
                </div>
              )}

              {trip.zelle_recipient && (
                <div>
                  <p className="text-sm font-medium mb-2">Zelle</p>
                  <p className="text-sm">{trip.zelle_recipient}</p>
                </div>
              )}
            </div>

            {payment && (
              <div className="mt-4 p-4 bg-muted rounded">
                <p className="text-sm font-medium mb-2">Your Payment Status</p>
                <div className="flex items-center gap-2">
                  <Badge variant={payment.verified_at ? 'default' : 'secondary'}>
                    {payment.verified_at ? 'Verified' : 'Reported'}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {formatCurrency(payment.amount_cents)} via {payment.method}
                  </span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

