import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { format } from 'date-fns'

interface TripCardProps {
  trip: {
    id: string
    slug: string
    title: string
    location_name: string | null
    start_date: string | null
    end_date: string | null
    deposit_due_date: string | null
    rsvp_status: string | null
    payment_status: string | null
  }
}

export function TripCard({ trip }: TripCardProps) {
  const formatDate = (date: string | null) => {
    if (!date) return null
    return format(new Date(date), 'MMM d, yyyy')
  }

  const getRSVPBadgeVariant = (status: string | null) => {
    if (!status) return 'outline'
    if (status === 'yes') return 'default'
    if (status === 'no') return 'destructive'
    return 'secondary'
  }

  const getPaymentBadgeVariant = (status: string | null) => {
    if (!status || status === 'not_reported') return 'outline'
    if (status === 'verified') return 'default'
    return 'secondary'
  }

  return (
    <Link href={`/trips/${trip.slug}`}>
      <Card className="hover:shadow-lg transition-shadow cursor-pointer h-full">
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
          <div className="flex gap-2 flex-wrap">
            <Badge variant={getRSVPBadgeVariant(trip.rsvp_status)}>
              RSVP: {trip.rsvp_status || 'Not RSVPed'}
            </Badge>
            <Badge variant={getPaymentBadgeVariant(trip.payment_status)}>
              Payment: {trip.payment_status === 'verified' ? 'Verified' : trip.payment_status === 'reported' ? 'Reported' : 'Not reported'}
            </Badge>
          </div>
          {trip.deposit_due_date && (
            <div className="text-xs text-muted-foreground">
              Deposit due: {formatDate(trip.deposit_due_date)}
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  )
}

