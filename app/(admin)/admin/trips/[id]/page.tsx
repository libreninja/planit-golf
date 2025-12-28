import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { notFound } from 'next/navigation'
import { TripEditor } from '@/components/admin/TripEditor'
import { InviteList } from '@/components/admin/InviteList'
import { RosterTable } from '@/components/admin/RosterTable'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export default async function EditTripPage({
  params,
}: {
  params: { id: string }
}) {
  const user = await requireAuth()
  const supabase = await createClient()

  // Get trip (RLS will ensure user is the creator)
  const { data: trip, error } = await supabase
    .from('trips')
    .select('*')
    .eq('id', params.id)
    .eq('created_by', user.id)
    .single()

  if (error || !trip) {
    notFound()
  }

  return (
    <div className="container mx-auto py-8 px-4 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Edit Trip: {trip.title}</h1>
      </div>

      <Tabs defaultValue="details" className="space-y-6">
        <TabsList>
          <TabsTrigger value="details">Trip Details</TabsTrigger>
          <TabsTrigger value="invites">Invites</TabsTrigger>
          <TabsTrigger value="roster">Roster</TabsTrigger>
        </TabsList>

        <TabsContent value="details">
          <Card>
            <CardHeader>
              <CardTitle>Trip Details</CardTitle>
            </CardHeader>
            <CardContent>
              <TripEditor trip={trip} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="invites">
          <Card>
            <CardHeader>
              <CardTitle>Send Invites</CardTitle>
            </CardHeader>
            <CardContent>
              <InviteList tripId={trip.id} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="roster">
          <Card>
            <CardHeader>
              <CardTitle>Roster</CardTitle>
            </CardHeader>
            <CardContent>
              <RosterTable tripId={trip.id} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

