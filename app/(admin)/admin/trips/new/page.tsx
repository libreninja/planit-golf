import { TripEditor } from '@/components/admin/TripEditor'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function NewTripPage() {
  return (
    <div className="container mx-auto py-8 px-4 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Create Trip</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Trip Details</CardTitle>
        </CardHeader>
        <CardContent>
          <TripEditor />
        </CardContent>
      </Card>
    </div>
  )
}

