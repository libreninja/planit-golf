import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import DatePicker from 'react-datepicker'
import MDEditor from '@uiw/react-md-editor'
import { getSupabaseClient } from '../lib/supabase'

const supabase = getSupabaseClient()

export default function AdminTripPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [trip, setTrip] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['overview']))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [formData, setFormData] = useState({
    title: '',
    slug: '',
    location_name: '',
    start_date: '',
    end_date: '',
    overview: '',
    deposit_amount_cents: '',
    full_cost_cents: '',
    deposit_due_date: '',
    venmo_handle: '',
    zelle_recipient: '',
  })

  const [members, setMembers] = useState<any[]>([])
  const [newEmail, setNewEmail] = useState('')
  const [addMeAsMember, setAddMeAsMember] = useState(false)
  const [addingMember, setAddingMember] = useState(false)
  
  const [games, setGames] = useState<any[]>([])
  const [newGame, setNewGame] = useState({
    details: '',
    prize_fund_cents: '',
  })
  const [addingGame, setAddingGame] = useState(false)
  const [editingGameIndex, setEditingGameIndex] = useState<number | null>(null)
  const [editingGame, setEditingGame] = useState({
    details: '',
    prize_fund_cents: '',
  })

  useEffect(() => {
    // Strict validation - don't proceed if id is missing or invalid
    if (!id || id === 'undefined' || typeof id !== 'string' || id.trim() === '') {
      return
    }

    let cancelled = false

    const loadTrip = async () => {
      // Re-check id before any async operations (capture it in closure)
      const currentId = id
      if (!currentId || currentId === 'undefined' || typeof currentId !== 'string' || currentId.trim() === '') {
        return
      }

      const { data: { session } } = await supabase.auth.getSession()
      if (!session || cancelled) {
        if (!session) navigate('/login')
        return
      }

      // Final check before API call
      if (cancelled || !currentId) {
        return
      }

      const { data, error } = await supabase
        .from('trips')
        .select('*')
        .eq('id', currentId)
        .eq('created_by', session.user.id)
        .single()

      if (cancelled) return

      if (error || !data) {
        // Suppress errors for invalid UUID format (22P02) - this happens in React Strict Mode
        if (error?.code === '22P02') {
          // Invalid UUID format - likely due to React Strict Mode double-render
          return
        }
        // Only log and navigate for other errors
        if (error) {
          console.error('Error loading trip:', error)
        }
            navigate('/trips')
        return
      }

      const tripData = data as any
      setTrip(tripData)
      setFormData({
        title: tripData.title || '',
        slug: tripData.slug || '',
        location_name: tripData.location_name || '',
        start_date: tripData.start_date ? tripData.start_date.split('T')[0] : '',
        end_date: tripData.end_date ? tripData.end_date.split('T')[0] : '',
        overview: tripData.overview || '',
        deposit_amount_cents: tripData.deposit_amount_cents ? (tripData.deposit_amount_cents / 100).toString() : '',
        full_cost_cents: tripData.full_cost_cents ? (tripData.full_cost_cents / 100).toFixed(2) : (tripData.deposit_amount_cents ? ((tripData.deposit_amount_cents * 3) / 100).toFixed(2) : ''),
        deposit_due_date: tripData.deposit_due_date ? tripData.deposit_due_date.split('T')[0] : '',
        venmo_handle: tripData.venmo_handle || '',
        zelle_recipient: tripData.zelle_recipient || '',
      })

      // Load members
      if (!cancelled) {
        await loadMembers(tripData.id, session.user.id)
        
        // Load games from itinerary
        if (tripData.itinerary) {
          try {
            const itinerary = Array.isArray(tripData.itinerary) ? tripData.itinerary : JSON.parse(tripData.itinerary as string)
            setGames(Array.isArray(itinerary) ? itinerary : [])
          } catch (e) {
            console.error('Error parsing itinerary:', e)
            setGames([])
          }
        } else {
          setGames([])
        }
        
        setLoading(false)
      }
    }

    loadTrip()

    return () => {
      cancelled = true
    }
  }, [id, navigate])

  const toggleSection = (section: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev)
      if (next.has(section)) {
        next.delete(section)
      } else {
        next.add(section)
      }
      return next
    })
  }

  const loadMembers = async (tripId: string, userId: string) => {
    const { data, error } = await supabase
      .from('memberships')
      .select('*')
      .eq('trip_id', tripId)
      .order('invited_at', { ascending: false })

    if (!error && data) {
      setMembers(data)
      // Check if creator is already a member
      const isMember = data.some((m: any) => m.user_id === userId)
      setAddMeAsMember(!isMember)
    }
  }

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

  const handleSaveTrip = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setSuccess(null)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        navigate('/login')
        return
      }

      const updateData: any = {
        title: formData.title,
        slug: formData.slug,
        location_name: formData.location_name || null,
        start_date: formData.start_date || null,
        end_date: formData.end_date || null,
        overview: formData.overview || null,
        deposit_amount_cents: formData.deposit_amount_cents ? Math.round(parseFloat(formData.deposit_amount_cents) * 100) : 0,
        deposit_due_date: formData.deposit_due_date || null,
        venmo_handle: formData.venmo_handle || null,
        zelle_recipient: formData.zelle_recipient || null,
        itinerary: games.length > 0 ? games : null,
      }
      
      // Calculate prize fund from sum of all game prize funds
      const calculatedPrizeFund = games.reduce((sum, game) => {
        return sum + (game.prize_fund_cents || 0)
      }, 0)
      
      // Always save the calculated prize fund (even if 0)
      updateData.prize_fund_cents = calculatedPrizeFund
      
      // Add full_cost_cents if provided
      // Note: This column may not exist until migration 003 is run
      if (formData.full_cost_cents && formData.full_cost_cents.trim() !== '') {
        // Parse as float and convert to cents, using proper rounding to avoid floating point errors
        const dollars = parseFloat(formData.full_cost_cents)
        // Round to nearest integer cent to avoid floating point precision issues
        // e.g., 250.00 * 100 should be exactly 25000, not 24999.999999
        updateData.full_cost_cents = Math.round(dollars * 100)
      }

      const { error: updateError } = await supabase
        .from('trips')
        .update(updateData as any)
        .eq('id', id)
        .eq('created_by', session.user.id)
        .select()

      if (updateError) {
        console.error('Update error details:', updateError)
        console.error('Update data attempted:', updateData)
        
        // Check if the error is about missing columns
        if (updateError.message && updateError.message.includes("Could not find the 'full_cost_cents'") || 
            updateError.message.includes("Could not find the 'prize_fund_cents'")) {
          // Remove the problematic fields and retry
          const { full_cost_cents, prize_fund_cents, ...safeUpdateData } = updateData
          if (!id) throw new Error('Trip ID is required')
          const { error: retryError } = await supabase
            .from('trips')
            .update(safeUpdateData as any)
            .eq('id', id)
            .eq('created_by', session.user.id)
            .select()
          
          if (retryError) {
            throw retryError
          }
          
          // Show a warning about the missing columns
          setError('Saved successfully, but full cost field is not available. Please run migration 003_add_cost_fields.sql in your Supabase database to enable this feature.')
          setTimeout(() => setError(null), 5000)
          setSuccess('Trip updated successfully! (Some fields not saved - see error message)')
          setTimeout(() => setSuccess(null), 5000)
          setSaving(false)
          return
        }
        
        throw updateError
      }

      setSuccess('Trip updated successfully!')
      setTimeout(() => setSuccess(null), 3000)
    } catch (err: any) {
      setError(err.message || 'Failed to update trip')
    } finally {
      setSaving(false)
    }
  }

  const handleAddMember = async () => {
    if (!newEmail.trim() && !addMeAsMember) return

    setAddingMember(true)
    setError(null)
    setSuccess(null)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        navigate('/login')
        return
      }

      const emailsToAdd: string[] = []
      
      // Add creator if checkbox is checked
      if (addMeAsMember) {
        emailsToAdd.push(session.user.email!)
      }

      // Add email from input
      if (newEmail.trim()) {
        emailsToAdd.push(newEmail.trim().toLowerCase())
      }

      if (!id) {
        setError('Trip ID is required')
        setAddingMember(false)
        return
      }

      // Create memberships for each email
      const memberships = emailsToAdd.map(email => ({
        trip_id: id,
        invited_email: email.toLowerCase(),
        user_id: email === session.user.email ? session.user.id : null,
        status: email === session.user.email ? 'accepted' : 'invited',
        invite_token: crypto.randomUUID(),
        accepted_at: email === session.user.email ? new Date().toISOString() : null,
      }))

      const { error: insertError } = await supabase
        .from('memberships')
        .insert(memberships as any)

      if (insertError) {
        throw insertError
      }

      setSuccess(`Added ${memberships.length} guest(s)`)
      setNewEmail('')
      setAddMeAsMember(false)
      await loadMembers(id!, session.user.id)
      setTimeout(() => setSuccess(null), 3000)
    } catch (err: any) {
      setError(err.message || 'Failed to add member')
    } finally {
      setAddingMember(false)
    }
  }

  const saveGamesToDatabase = async (gamesToSave: any[]) => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      navigate('/login')
      return
    }

    if (!id) {
      console.error('Trip ID is required')
      return
    }

    // Ensure we're sending valid JSON - Supabase jsonb expects proper JSON format
    const itineraryValue = gamesToSave.length > 0 ? gamesToSave : null
    
    const { error: updateError } = await supabase
      .from('trips')
      .update({ itinerary: itineraryValue } as any)
      .eq('id', id)
      .eq('created_by', session.user.id)

    if (updateError) {
      console.error('Error saving games:', updateError)
      throw updateError
    }
  }

  const handleAddGame = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newGame.details.trim()) {
      setError('Description is required')
      return
    }

    setAddingGame(true)
    setError(null)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        navigate('/login')
        return
      }

      const gameToAdd = {
        details: newGame.details,
        prize_fund_cents: newGame.prize_fund_cents ? Math.round(parseFloat(newGame.prize_fund_cents) * 100) : null,
      }

      const updatedGames = [...games, gameToAdd]
      setGames(updatedGames)
      
      // Save to database immediately
      await saveGamesToDatabase(updatedGames)
      
      setNewGame({ details: '', prize_fund_cents: '' })
      setSuccess('Game added!')
      setTimeout(() => setSuccess(null), 3000)
    } catch (err: any) {
      setError(err.message || 'Failed to add game')
    } finally {
      setAddingGame(false)
    }
  }

  const handleEditGame = (index: number) => {
    const game = games[index]
    setEditingGameIndex(index)
    setEditingGame({
      details: game.details || '',
      prize_fund_cents: game.prize_fund_cents ? (game.prize_fund_cents / 100).toFixed(2) : '',
    })
  }

  const handleCancelEdit = () => {
    setEditingGameIndex(null)
    setEditingGame({ details: '', prize_fund_cents: '' })
  }

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingGame.details.trim()) {
      setError('Description is required')
      return
    }

    if (editingGameIndex === null) return

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        navigate('/login')
        return
      }

      const updatedGame = {
        details: editingGame.details,
        prize_fund_cents: editingGame.prize_fund_cents ? Math.round(parseFloat(editingGame.prize_fund_cents) * 100) : null,
      }

      const updatedGames = [...games]
      updatedGames[editingGameIndex] = updatedGame
      setGames(updatedGames)
      
      // Save to database immediately
      await saveGamesToDatabase(updatedGames)
      
      setEditingGameIndex(null)
      setEditingGame({ details: '', prize_fund_cents: '' })
      setSuccess('Game updated!')
      setTimeout(() => setSuccess(null), 3000)
    } catch (err: any) {
      setError(err.message || 'Failed to update game')
    }
  }

  const handleDeleteGame = async (index: number) => {
    try {
      const updatedGames = games.filter((_, i) => i !== index)
      setGames(updatedGames)
      
      // Save to database immediately
      await saveGamesToDatabase(updatedGames)
      
      setSuccess('Game deleted!')
      setTimeout(() => setSuccess(null), 3000)
    } catch (err: any) {
      setError(err.message || 'Failed to delete game')
      // Revert state on error
      setGames(games)
    }
  }

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
        <button
          onClick={() => navigate('/trips')}
          className="mb-4 px-4 sm:px-6 pt-4 sm:pt-6 text-blue-600 hover:text-blue-800 text-sm sm:text-base"
        >
          ← Back to Trips
        </button>

        {/* Messages */}
        <div className="px-4 sm:px-6 pb-0">
          {error && (
            <div className="mb-4 p-3 bg-red-50 text-red-800 rounded-md text-sm">
              {error}
            </div>
          )}
          {success && (
            <div className="mb-4 p-3 bg-green-50 text-green-800 rounded-md text-sm">
              {success}
            </div>
          )}
        </div>

        {/* Collapsible Sections */}
        <div className="space-y-2 px-4 sm:px-6 pb-4 sm:pb-6">
          {/* Overview Section */}
          <div className="bg-white rounded-lg shadow border border-gray-200">
            <button
              onClick={() => toggleSection('overview')}
              className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
            >
              <span className="font-semibold text-sm sm:text-base">Overview</span>
              <span className="text-gray-400">
                {expandedSections.has('overview') ? '−' : '+'}
              </span>
            </button>
            {expandedSections.has('overview') && (
              <div className="px-4 pb-4 pt-2 border-t border-gray-200">
                <form onSubmit={handleSaveTrip} className="space-y-4">
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
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Trip Dates
                    </label>
                    <DatePicker
                      selected={formData.start_date ? new Date(formData.start_date) : null}
                      onChange={(dates: any) => {
                        const [start, end] = dates
                        setFormData({
                          ...formData,
                          start_date: start ? start.toISOString().split('T')[0] : '',
                          end_date: end ? end.toISOString().split('T')[0] : '',
                        })
                      }}
                      startDate={formData.start_date ? new Date(formData.start_date) : null}
                      endDate={formData.end_date ? new Date(formData.end_date) : null}
                      selectsRange
                      isClearable
                      placeholderText="Select date range"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      dateFormat="MMM d, yyyy"
                      minDate={new Date()}
                    />
                  </div>

                  <div>
                    <label htmlFor="overview" className="block text-sm font-medium text-gray-700 mb-2">
                      Overview
                    </label>
                    <div className="border border-gray-300 rounded-md" data-color-mode="light">
                      <MDEditor
                        value={formData.overview}
                        onChange={(value) => setFormData({ ...formData, overview: value || '' })}
                        preview="edit"
                        hideToolbar={false}
                        height={200}
                      />
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={saving}
                      className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50"
                    >
                      {saving ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>

          {/* Games Section */}
          <div className="bg-white rounded-lg shadow border border-gray-200">
            <button
              onClick={() => toggleSection('games')}
              className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
            >
              <span className="font-semibold text-sm sm:text-base">
                Games {games.length > 0 && `(${games.length})`}
              </span>
              <span className="text-gray-400">
                {expandedSections.has('games') ? '−' : '+'}
              </span>
            </button>
            {expandedSections.has('games') && (
              <div className="px-4 pb-4 pt-2 border-t border-gray-200 space-y-4">
                {/* Add Game Form */}
                <form onSubmit={handleAddGame} className="space-y-4 pb-4 border-b border-gray-200">
                  <div>
                    <label htmlFor="game_details" className="block text-sm font-medium text-gray-700 mb-2">
                      Description *
                    </label>
                    <div className="border border-gray-300 rounded-md" data-color-mode="light">
                      <MDEditor
                        value={newGame.details}
                        onChange={(value) => setNewGame({ ...newGame, details: value || '' })}
                        preview="edit"
                        hideToolbar={false}
                        height={200}
                      />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="game_prize_fund" className="block text-sm font-medium text-gray-700 mb-2">
                      Prize Fund ($)
                    </label>
                    <input
                      id="game_prize_fund"
                      type="number"
                      step="0.01"
                      min="0"
                      value={newGame.prize_fund_cents}
                      onChange={(e) => setNewGame({ ...newGame, prize_fund_cents: e.target.value })}
                      placeholder="0.00"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <p className="mt-1 text-xs text-gray-500">This will be used as the minimum deposit amount</p>
                  </div>
                  <button
                    type="submit"
                    disabled={addingGame || !newGame.details.trim()}
                    className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50"
                  >
                    {addingGame ? 'Adding...' : 'Add Game'}
                  </button>
                </form>

                {/* Games List */}
                {games.length > 0 ? (
                  <div className="space-y-3">
                    {games.map((game: any, index: number) => (
                      <div key={index} className="pb-3 border-b border-gray-100 last:border-0">
                        {editingGameIndex === index ? (
                          /* Edit Form */
                          <form onSubmit={handleSaveEdit} className="space-y-3">
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">
                                Description *
                              </label>
                              <div className="border border-gray-300 rounded-md" data-color-mode="light">
                                <MDEditor
                                  value={editingGame.details}
                                  onChange={(value) => setEditingGame({ ...editingGame, details: value || '' })}
                                  preview="edit"
                                  hideToolbar={false}
                                  height={200}
                                />
                              </div>
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">
                                Prize Fund ($)
                              </label>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={editingGame.prize_fund_cents}
                                onChange={(e) => setEditingGame({ ...editingGame, prize_fund_cents: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </div>
                            <div className="flex gap-2">
                              <button
                                type="submit"
                                className="px-3 py-1 bg-blue-500 text-white rounded-md hover:bg-blue-600 text-sm"
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={handleCancelEdit}
                                className="px-3 py-1 border border-gray-300 rounded-md hover:bg-gray-50 text-sm"
                              >
                                Cancel
                              </button>
                            </div>
                          </form>
                        ) : (
                          /* Display Mode */
                          <div className="flex justify-between items-start">
                            <div className="flex-1">
                              {game.details && (
                                <p className="text-sm text-gray-900">{game.details}</p>
                              )}
                              {game.prize_fund_cents && (
                                <p className="text-sm text-blue-600 font-medium mt-1">
                                  Prize Fund: ${(game.prize_fund_cents / 100).toFixed(2)}
                                </p>
                              )}
                            </div>
                            <div className="flex gap-2 ml-4">
                              <button
                                onClick={() => handleEditGame(index)}
                                className="px-2 py-1 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded text-sm"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => handleDeleteGame(index)}
                                className="px-2 py-1 text-red-600 hover:text-red-800 hover:bg-red-50 rounded text-sm"
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">No games scheduled yet. Add a game above.</p>
                )}
              </div>
            )}
          </div>

          {/* Payment Section */}
          <div className="bg-white rounded-lg shadow border border-gray-200">
            <button
              onClick={() => toggleSection('payment')}
              className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
            >
              <span className="font-semibold text-sm sm:text-base">Payment</span>
              <span className="text-gray-400">
                {expandedSections.has('payment') ? '−' : '+'}
              </span>
            </button>
            {expandedSections.has('payment') && (
              <div className="px-4 pb-4 pt-2 border-t border-gray-200">
                <form onSubmit={handleSaveTrip} className="space-y-4">
                  {/* Display calculated prize fund (read-only) */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Prize Fund ($) <span className="text-xs text-gray-500">(calculated from games)</span>
                    </label>
                    <div className="px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-gray-700">
                      ${(games.reduce((sum, game) => sum + (game.prize_fund_cents || 0), 0) / 100).toFixed(2)}
                    </div>
                    <p className="mt-1 text-xs text-gray-500">This is the sum of all game prize funds and will be used as the minimum deposit amount.</p>
                  </div>
                  
                  <div>
                    <label htmlFor="full_cost_cents" className="block text-sm font-medium text-gray-700 mb-2">
                      Total Cost ($)
                    </label>
                    <input
                      id="full_cost_cents"
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.full_cost_cents}
                      onChange={(e) => {
                        const val = e.target.value
                        // Preserve the exact value entered, don't do any conversion
                        setFormData({ ...formData, full_cost_cents: val })
                      }}
                      onBlur={(e) => {
                        // On blur, round to 2 decimal places to fix any floating point issues
                        const val = parseFloat(e.target.value)
                        if (!isNaN(val)) {
                          setFormData({ ...formData, full_cost_cents: val.toFixed(2) })
                        }
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label htmlFor="deposit_due_date" className="block text-sm font-medium text-gray-700 mb-2">
                      Due Date
                    </label>
                    <input
                      id="deposit_due_date"
                      type="date"
                      value={formData.deposit_due_date}
                      onChange={(e) => setFormData({ ...formData, deposit_due_date: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label htmlFor="venmo_handle" className="block text-sm font-medium text-gray-700 mb-2">
                      Venmo Handle
                    </label>
                    <input
                      id="venmo_handle"
                      type="text"
                      value={formData.venmo_handle}
                      onChange={(e) => setFormData({ ...formData, venmo_handle: e.target.value })}
                      placeholder="@username"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={saving}
                      className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50"
                    >
                      {saving ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>

          {/* Guests Section */}
          <div className="bg-white rounded-lg shadow border border-gray-200">
            <button
              onClick={() => toggleSection('guests')}
              className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
            >
              <span className="font-semibold text-sm sm:text-base">
                Guests ({members.length})
              </span>
              <span className="text-gray-400">
                {expandedSections.has('guests') ? '−' : '+'}
              </span>
            </button>
            {expandedSections.has('guests') && (
              <div className="px-4 pb-4 pt-2 border-t border-gray-200 space-y-4">
                {/* Add Creator as Guest */}
                {addMeAsMember && (
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      id="addCreator"
                      checked={addMeAsMember}
                      onChange={() => setAddMeAsMember(!addMeAsMember)}
                      className="h-4 w-4 text-blue-600 border-gray-300 rounded"
                    />
                    <label htmlFor="addCreator" className="ml-2 block text-sm text-gray-900">
                      Add me as a guest of this trip
                    </label>
                  </div>
                )}

                {/* Add by Email */}
                <div className="flex gap-2">
                  <input
                    type="email"
                    placeholder="Invite new guest by email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    className="flex-grow px-3 py-2 border border-gray-300 rounded-md"
                  />
                  <button
                    onClick={handleAddMember}
                    disabled={addingMember || (!newEmail.trim() && !addMeAsMember)}
                    className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50"
                  >
                    {addingMember ? 'Adding...' : 'Add Guest'}
                  </button>
                </div>

                {/* Guests Table */}
                {members.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Email
                          </th>
                          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Status
                          </th>
                          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Invited
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {members.map((member) => (
                          <tr key={member.id}>
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                              {member.invited_email}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                                member.status === 'accepted' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                              }`}>
                                {member.status}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {new Date(member.invited_at).toLocaleDateString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">No guests yet. Add yourself or invite others!</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
