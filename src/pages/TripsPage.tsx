import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Pencil, LogOut } from 'lucide-react'
import { getSupabaseClient } from '../lib/supabase'

const supabase = getSupabaseClient()

export default function TripsPage() {
  const [trips, setTrips] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    const loadTrips = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        navigate('/login')
        return
      }

      setUserId(session.user.id)

      // First, update any memberships where invited_email matches but user_id is null
      // This links the membership to the user when they first sign in
      await supabase
        .from('memberships')
        .update({ 
          user_id: session.user.id,
          status: 'accepted',
          accepted_at: new Date().toISOString()
        })
        .eq('invited_email', session.user.email?.toLowerCase() || '')
        .is('user_id', null)
        .in('status', ['invited'])

      // Get trips where user has membership (by user_id OR by email match)
      const { data: memberships, error: membershipError } = await supabase
        .from('memberships')
        .select(`
          trips (
            id,
            slug,
            title,
            location_name,
            start_date,
            end_date,
            deposit_due_date,
            created_by
          )
        `)
        .or(`user_id.eq.${session.user.id},and(invited_email.eq.${session.user.email?.toLowerCase() || ''},user_id.is.null)`)
        .in('status', ['invited', 'accepted'])

      // Get trips created by this user
      const { data: createdTrips, error: createdError } = await supabase
        .from('trips')
        .select('id, slug, title, location_name, start_date, end_date, deposit_due_date, created_by')
        .eq('created_by', session.user.id)

      if (membershipError) {
        console.error('Error loading memberships:', membershipError)
      }
      if (createdError) {
        console.error('Error loading created trips:', createdError)
      }

      // Merge and deduplicate trips
      const membershipTripList = (memberships || [])
        .map((m: any) => m.trips)
        .filter(Boolean)
      
      const createdTripList = createdTrips || []
      
      // Combine and deduplicate by trip id
      const allTripsMap = new Map<string, any>()
      membershipTripList.forEach((trip: any) => {
        if (trip) allTripsMap.set(trip.id, trip)
      })
      createdTripList.forEach((trip: any) => {
        if (trip) allTripsMap.set(trip.id, trip)
      })
      
      setTrips(Array.from(allTripsMap.values()))
      setLoading(false)
    }

    loadTrips()
  }, [navigate])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 w-full">
      <div className="w-full">
        <div className="flex justify-between items-center mb-8 px-4 sm:px-6 pt-4 sm:pt-6">
          <div>
            <h1 className="text-3xl font-bold">My Trips</h1>
            <p className="text-gray-600 mt-1">Trips you've been invited to</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/admin/trips/new')}
              className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
            >
              Create Trip
            </button>
            <button
              onClick={async () => {
                await supabase.auth.signOut()
                navigate('/login')
              }}
              className="px-3 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors flex items-center gap-2"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>

        {trips.length === 0 ? (
          <div className="bg-white p-8 text-center mx-4 sm:mx-6 mb-4 sm:mb-6">
            <p className="text-gray-600 mb-2">No trips yet</p>
            <p className="text-sm text-gray-500">
              You haven't been invited to any trips yet. Check your email for invite links!
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 px-4 sm:px-6 pb-4 sm:pb-6">
            {trips.map((trip: any) => (
              <div
                key={trip.id}
                className="bg-white rounded-lg shadow p-6 hover:shadow-lg cursor-pointer transition-shadow relative"
                onClick={() => navigate(`/trips/${trip.slug}`)}
              >
                {trip.created_by === userId && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      navigate(`/admin/trips/${trip.id}`)
                    }}
                    className="absolute top-4 right-4 p-2 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                    aria-label="Edit trip"
                  >
                    <Pencil className="w-5 h-5" />
                  </button>
                )}
                <h3 className="font-semibold text-lg mb-2 pr-8">{trip.title}</h3>
                {trip.location_name && (
                  <p className="text-gray-600 text-sm mb-2">{trip.location_name}</p>
                )}
                {trip.start_date && (
                  <p className="text-gray-500 text-sm">
                    {new Date(trip.start_date).toLocaleDateString()}
                    {trip.end_date && ` - ${new Date(trip.end_date).toLocaleDateString()}`}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

