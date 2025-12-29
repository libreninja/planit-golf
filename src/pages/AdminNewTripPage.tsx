import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getSupabaseClient } from '../lib/supabase'

const supabase = getSupabaseClient()

export default function AdminNewTripPage() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  const [formData, setFormData] = useState({
    title: '',
    slug: '',
    location_name: '',
    start_date: '',
    end_date: '',
    overview: '',
    deposit_amount_cents: '',
    deposit_due_date: '',
    venmo_handle: '',
    zelle_recipient: '',
    add_creator_as_member: true, // Default to true
  })

  const generateSlug = (title: string) => {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
  }

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const title = e.target.value
    setFormData({
      ...formData,
      title,
      slug: generateSlug(title),
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        navigate('/login')
        return
      }

      const tripData = {
        title: formData.title,
        slug: formData.slug,
        location_name: formData.location_name || null,
        start_date: formData.start_date || null,
        end_date: formData.end_date || null,
        overview: formData.overview || null,
        deposit_amount_cents: formData.deposit_amount_cents ? parseInt(formData.deposit_amount_cents) * 100 : 0,
        deposit_due_date: formData.deposit_due_date || null,
        venmo_handle: formData.venmo_handle || null,
        zelle_recipient: formData.zelle_recipient || null,
        created_by: session.user.id,
      }

      const { data, error: insertError } = await supabase
        .from('trips')
        .insert(tripData as any)
        .select()
        .single()

      if (insertError) {
        throw insertError
      }

      // If option is checked, add creator as a member
      if (formData.add_creator_as_member && data) {
        const tripDataResult = data as any
        const { error: membershipError } = await supabase
          .from('memberships')
          .insert({
            trip_id: tripDataResult.id,
            user_id: session.user.id,
            invited_email: session.user.email,
            status: 'accepted',
            accepted_at: new Date().toISOString(),
          } as any)

        if (membershipError) {
          console.error('Error adding creator as member:', membershipError)
          // Don't fail the whole operation, just log it
        }
      }

      const tripDataResult = data as any
      navigate(`/admin/trips/${tripDataResult.id}`)
    } catch (err: any) {
      setError(err.message || 'Failed to create trip')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto py-8 px-4 max-w-4xl">
        <button
          onClick={() => navigate('/trips')}
          className="mb-4 text-blue-600 hover:text-blue-800"
        >
          ← Back to Trips
        </button>

        <div className="bg-white rounded-lg shadow p-6">
          <h1 className="text-3xl font-bold mb-6">Create New Trip</h1>

          {error && (
            <div className="mb-4 p-3 bg-red-50 text-red-800 rounded-md text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-2">
                Title *
              </label>
              <input
                id="title"
                type="text"
                value={formData.title}
                onChange={handleTitleChange}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g., Bandon Crossings 2026"
              />
            </div>

            <div>
              <label htmlFor="slug" className="block text-sm font-medium text-gray-700 mb-2">
                Slug (auto-generated)
              </label>
              <input
                id="slug"
                type="text"
                value={formData.slug}
                onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50"
                placeholder="bandon-crossings-2026"
              />
            </div>

            <div>
              <label htmlFor="location_name" className="block text-sm font-medium text-gray-700 mb-2">
                Location
              </label>
              <input
                id="location_name"
                type="text"
                value={formData.location_name}
                onChange={(e) => setFormData({ ...formData, location_name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g., Bandon, OR"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="start_date" className="block text-sm font-medium text-gray-700 mb-2">
                  Start Date
                </label>
                <input
                  id="start_date"
                  type="date"
                  value={formData.start_date}
                  onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label htmlFor="end_date" className="block text-sm font-medium text-gray-700 mb-2">
                  End Date
                </label>
                <input
                  id="end_date"
                  type="date"
                  value={formData.end_date}
                  onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div>
              <label htmlFor="overview" className="block text-sm font-medium text-gray-700 mb-2">
                Overview
              </label>
              <textarea
                id="overview"
                value={formData.overview}
                onChange={(e) => setFormData({ ...formData, overview: e.target.value })}
                rows={4}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Trip description..."
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="deposit_amount_cents" className="block text-sm font-medium text-gray-700 mb-2">
                  Deposit Amount ($)
                </label>
                <input
                  id="deposit_amount_cents"
                  type="number"
                  step="0.01"
                  value={formData.deposit_amount_cents}
                  onChange={(e) => setFormData({ ...formData, deposit_amount_cents: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="0.00"
                />
              </div>

              <div>
                <label htmlFor="deposit_due_date" className="block text-sm font-medium text-gray-700 mb-2">
                  Deposit Due Date
                </label>
                <input
                  id="deposit_due_date"
                  type="date"
                  value={formData.deposit_due_date}
                  onChange={(e) => setFormData({ ...formData, deposit_due_date: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="venmo_handle" className="block text-sm font-medium text-gray-700 mb-2">
                  Venmo Handle
                </label>
                <input
                  id="venmo_handle"
                  type="text"
                  value={formData.venmo_handle}
                  onChange={(e) => setFormData({ ...formData, venmo_handle: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="@username"
                />
              </div>

              <div>
                <label htmlFor="zelle_recipient" className="block text-sm font-medium text-gray-700 mb-2">
                  Zelle Recipient
                </label>
                <input
                  id="zelle_recipient"
                  type="text"
                  value={formData.zelle_recipient}
                  onChange={(e) => setFormData({ ...formData, zelle_recipient: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="email@example.com"
                />
              </div>
            </div>

            <div className="flex items-center">
              <input
                id="add_creator_as_member"
                type="checkbox"
                checked={formData.add_creator_as_member}
                onChange={(e) => setFormData({ ...formData, add_creator_as_member: e.target.checked })}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              />
              <label htmlFor="add_creator_as_member" className="ml-2 block text-sm text-gray-700">
                Add me as a member of this trip (so I can see it in "My Trips")
              </label>
            </div>

            <div className="flex gap-4">
              <button
                type="button"
                onClick={() => navigate('/trips')}
                className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !formData.title}
                className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50"
              >
                {loading ? 'Creating...' : 'Create Trip'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

