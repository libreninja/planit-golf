import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getSupabaseClient } from '../lib/supabase'
import { format } from 'date-fns'
import { ArrowLeft } from 'lucide-react'
import MDEditor from '@uiw/react-md-editor'

const supabase = getSupabaseClient()

export default function TripDetailPage() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const [trip, setTrip] = useState<any>(null)
  const [members, setMembers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['overview', 'guests']))
  const [paymentAmount, setPaymentAmount] = useState<number>(0)

  useEffect(() => {
    const loadTrip = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        navigate('/login')
        return
      }

      if (!slug) {
        navigate('/trips')
        return
      }

      const { data, error } = await supabase
        .from('trips')
        .select('*')
        .eq('slug', slug)
        .single()

      if (error || !data) {
        console.error('Error loading trip:', error)
        navigate('/trips')
        return
      }

      setTrip(data as any)
      
      // Parse games to calculate prize fund
      let initialGames: any[] = []
      const tripData = data as any
      if (tripData.itinerary && typeof tripData.itinerary === 'object') {
        try {
          const itinerary = Array.isArray(tripData.itinerary) ? tripData.itinerary : JSON.parse(tripData.itinerary as string)
          initialGames = Array.isArray(itinerary) ? itinerary : []
        } catch (e) {
          console.error('Error parsing itinerary:', e)
        }
      }
      
      // Calculate prize fund from games
      const calculatedPrizeFund = initialGames.reduce((sum, game) => {
        return sum + (game.prize_fund_cents || 0)
      }, 0)
      
      // Set initial payment amount to prize fund (minimum deposit)
      // Use calculated prize fund from games, or fallback to trip.prize_fund_cents, or deposit_amount_cents
      const prizeFundCents = calculatedPrizeFund > 0 ? calculatedPrizeFund : (tripData.prize_fund_cents ?? null)
      const minDeposit = (prizeFundCents !== null && prizeFundCents > 0) ? prizeFundCents : (tripData.deposit_amount_cents || 0)
      
      // Debug logging
      console.log('Trip data loaded:', {
        games_prize_fund_sum: calculatedPrizeFund,
        trip_prize_fund_cents: tripData.prize_fund_cents,
        deposit_amount_cents: tripData.deposit_amount_cents,
        calculated_min_deposit: minDeposit
      })
      
      setPaymentAmount(minDeposit)

      // Load memberships
      const { data: membersData, error: membersError } = await supabase
        .from('memberships')
        .select('*')
        .eq('trip_id', tripData.id)
        .order('invited_at', { ascending: false })

      if (!membersError && membersData) {
        setMembers(membersData)
      }

      setLoading(false)
    }

    loadTrip()
  }, [slug, navigate])

  // Update payment amount when trip data changes (especially when games/prize fund changes)
  useEffect(() => {
    if (trip) {
      // Parse games
      let currentGames: any[] = []
      if (trip.itinerary && typeof trip.itinerary === 'object') {
        try {
          const itinerary = Array.isArray(trip.itinerary) ? trip.itinerary : JSON.parse(trip.itinerary as string)
          currentGames = Array.isArray(itinerary) ? itinerary : []
        } catch (e) {
          // Ignore parse errors
        }
      }
      
      // Calculate prize fund from games
      const calculatedPrizeFund = currentGames.reduce((sum, game) => {
        return sum + (game.prize_fund_cents || 0)
      }, 0)
      
      const prizeFundCents = calculatedPrizeFund > 0 ? calculatedPrizeFund : (trip.prize_fund_cents ?? null)
      const minDeposit = (prizeFundCents !== null && prizeFundCents > 0) ? prizeFundCents : (trip.deposit_amount_cents || 0)
      
      // Only update payment amount if it's below the minimum (don't reset if user has set it higher)
      if (paymentAmount < minDeposit) {
        setPaymentAmount(minDeposit)
      }
    }
  }, [trip]) // Only depend on trip, not paymentAmount, to avoid resetting user's selection

  const formatDate = (dateString: string | null) => {
    if (!dateString) return null
    return format(new Date(dateString), 'MMM d, yyyy')
  }

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

  const getVenmoUrl = (handle: string, amount: number | null, note: string) => {
    const cleanHandle = handle.replace(/^@/, '')
    const amountParam = amount ? `&amount=${(amount / 100).toFixed(2)}` : ''
    const noteParam = note ? `&note=${encodeURIComponent(note)}` : ''
    return `venmo://paycharge?txn=pay&recipients=${cleanHandle}${amountParam}${noteParam}`
  }

  const getVenmoWebUrl = (handle: string, amount: number | null, note: string) => {
    const cleanHandle = handle.replace(/^@/, '')
    const amountParam = amount ? `&amount=${(amount / 100).toFixed(2)}` : ''
    const noteParam = note ? `&note=${encodeURIComponent(note)}` : ''
    return `https://venmo.com/${cleanHandle}?txn=pay${amountParam}${noteParam}`
  }

  const getQRCodeUrl = (text: string) => {
    return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(text)}`
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

  if (!trip) return null

  const tripData = trip as any

  // Parse itinerary for games
  let games: any[] = []
  if (tripData.itinerary && typeof tripData.itinerary === 'object') {
    try {
      const itinerary = Array.isArray(tripData.itinerary) ? tripData.itinerary : JSON.parse(tripData.itinerary as string)
      games = Array.isArray(itinerary) ? itinerary : []
    } catch (e) {
      console.error('Error parsing itinerary:', e)
    }
  }

  // Calculate prize fund from sum of all game prize funds
  const calculatedPrizeFundCents = games.reduce((sum, game) => {
    return sum + (game.prize_fund_cents || 0)
  }, 0)

  // Minimum deposit is the prize fund (paying the prize fund reserves your spot)
  // Use calculated prize fund from games, or fallback to trip.prize_fund_cents (for backwards compatibility), or deposit_amount_cents
  const prizeFundCents = calculatedPrizeFundCents > 0 ? calculatedPrizeFundCents : (tripData.prize_fund_cents ?? null)
  const depositAmount = (prizeFundCents !== null && prizeFundCents > 0) ? prizeFundCents : (tripData.deposit_amount_cents || 0)
  
  // Debug logging
  console.log('Calculating deposit amount:', {
    games_prize_fund_sum: calculatedPrizeFundCents,
    trip_prize_fund_cents: tripData.prize_fund_cents,
    deposit_amount_cents: tripData.deposit_amount_cents,
    calculated_deposit: depositAmount
  })
  const fullCostAmount = tripData.full_cost_cents || depositAmount * 3 // Use full_cost_cents if available, otherwise 3x deposit
  const maxPaymentAmount = fullCostAmount
  const venmoHandle = tripData.venmo_handle
  const paymentNote = `Payment for ${tripData.title}`
  const venmoUrl = venmoHandle && paymentAmount > 0 ? getVenmoUrl(venmoHandle, paymentAmount, paymentNote) : ''
  const venmoWebUrl = venmoHandle && paymentAmount > 0 ? getVenmoWebUrl(venmoHandle, paymentAmount, paymentNote) : ''

  return (
    <div className="min-h-screen bg-gray-50 w-full">
      <div className="w-full">
        <div className="bg-white p-4 sm:p-6">
          {/* Back arrow and header */}
          <div className="mb-4 sm:mb-6">
            <div className="flex gap-3">
              <button
                onClick={() => navigate('/trips')}
                className="text-gray-600 hover:text-gray-900 transition-colors flex-shrink-0 self-center"
                aria-label="Back to trips"
                style={{ marginTop: '0.5rem' }}
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div className="flex-1 min-w-0">
            {/* Trip title */}
            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold break-words mb-1">
              {tripData.title}
            </h1>
                {/* Condensed location and date - centered below headline */}
                <div className="flex flex-wrap items-center justify-center gap-1.5 text-xs text-gray-500">
                  {tripData.location_name && (
                    <span className="flex items-center whitespace-nowrap">
                      <span className="mr-1">📍</span>
                      {tripData.location_name}
                    </span>
                  )}
                  {(tripData.start_date || tripData.end_date) && (
                    <span className="flex items-center whitespace-nowrap">
                      {tripData.location_name && <span className="mx-1">•</span>}
                      <span className="mr-1">📅</span>
                      {formatDate(tripData.start_date)}
                      {tripData.end_date && ` - ${formatDate(tripData.end_date)}`}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Expandable Sections */}
          <div className="space-y-2">
            {/* Overview Section */}
            {tripData.overview && (
              <div className="border border-gray-200 rounded-lg">
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
                      <div className="px-4 pb-4 pt-2 border-t border-gray-200" data-color-mode="light">
                        <MDEditor.Markdown source={tripData.overview || ''} />
                      </div>
                    )}
              </div>
            )}

            {/* Guests Section */}
            <div className="border border-gray-200 rounded-lg">
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
                <div className="px-4 pb-4 pt-2 border-t border-gray-200">
                  {members.length > 0 ? (
                    <div className="space-y-2">
                      {members.map((member) => (
                        <div key={member.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                          <div>
                            <p className="text-sm font-medium text-gray-900">{member.invited_email}</p>
                            <p className="text-xs text-gray-500">
                              {member.status === 'accepted' ? 'Accepted' : member.status === 'invited' ? 'Invited' : 'Declined'}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">No guests yet.</p>
                  )}
                </div>
              )}
            </div>

            {/* Games Section */}
            <div className="border border-gray-200 rounded-lg">
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
                <div className="px-4 pb-4 pt-2 border-t border-gray-200">
                  {games.length > 0 ? (
                    <div className="space-y-3">
                      {games.map((game: any, index: number) => (
                        <div key={index} className="pb-3 border-b border-gray-100 last:border-0" data-color-mode="light">
                          {game.details && (
                            <MDEditor.Markdown source={game.details} />
                          )}
                          {game.prize_fund_cents && (
                            <p className="text-sm text-blue-600 font-medium mt-1">
                              Prize Fund: ${(game.prize_fund_cents / 100).toFixed(2)}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">No games scheduled yet.</p>
                  )}
                </div>
              )}
            </div>

            {/* Deposit / Payments Section - Always Expanded */}
            {depositAmount > 0 && (
              <div className="border border-gray-200 rounded-lg">
                <div className="px-4 py-3 border-b border-gray-200">
                  <span className="font-semibold text-sm sm:text-base">Deposit / Payments</span>
                </div>
                <div className="px-4 pb-4 pt-4 space-y-4">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-sm text-gray-600">Payment Amount</p>
                        <p className="text-lg font-bold text-gray-900">
                          ${(paymentAmount / 100).toFixed(2)}
                        </p>
                      </div>
                      <div className="mb-2">
                        <input
                          type="range"
                          min={depositAmount}
                          max={maxPaymentAmount}
                          step={100}
                          value={paymentAmount}
                          onChange={(e) => setPaymentAmount(parseInt(e.target.value))}
                          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                        />
                        <div className="flex justify-between text-xs text-gray-500 mt-1">
                          <span>Min: ${(depositAmount / 100).toFixed(2)}</span>
                          <span>Max: ${(maxPaymentAmount / 100).toFixed(2)}</span>
                        </div>
                      </div>
                      <div className="mb-2">
                        <input
                          type="number"
                          min={depositAmount / 100}
                          max={maxPaymentAmount / 100}
                          step="0.01"
                          value={(paymentAmount / 100).toFixed(2)}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value)
                            if (!isNaN(val)) {
                              const cents = Math.round(val * 100)
                              setPaymentAmount(Math.max(depositAmount, Math.min(maxPaymentAmount, cents)))
                            }
                          }}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                        />
                      </div>
                      {tripData.deposit_due_date && (
                        <p className="text-xs text-gray-500">
                          Deposit due: {formatDate(tripData.deposit_due_date)}
                        </p>
                      )}
                    </div>

                    {venmoHandle && paymentAmount > 0 && (
                      <div className="space-y-4 pt-4 border-t">
                        <div>
                          <p className="text-sm text-gray-600 mb-2">Pay via Venmo</p>
                          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                            {/* QR Code */}
                            <div className="flex-shrink-0">
                              <img
                                src={getQRCodeUrl(venmoWebUrl)}
                                alt="Venmo QR Code"
                                className="w-32 h-32 sm:w-40 sm:h-40 border border-gray-200 rounded-lg p-2 bg-white"
                              />
                            </div>
                            
                            {/* Venmo Link */}
                            <div className="flex-1 space-y-2">
                              <p className="text-sm font-medium text-gray-700">
                                {venmoHandle.startsWith('@') ? venmoHandle : `@${venmoHandle}`}
                              </p>
                              <a
                                href={venmoWebUrl}
                                onClick={(e) => {
                                  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
                                  if (isMobile) {
                                    // Try deep link, but catch errors silently
                                    try {
                                      window.location.href = venmoUrl
                                      setTimeout(() => {
                                        window.location.href = venmoWebUrl
                                      }, 1000)
                                    } catch (err) {
                                      // Deep link failed, use web URL
                                      window.location.href = venmoWebUrl
                                    }
                                  } else {
                                    // Desktop: just open web link
                                    window.open(venmoWebUrl, '_blank')
                                  }
                                  e.preventDefault()
                                }}
                                className="inline-block px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors text-sm sm:text-base"
                              >
                                Open in Venmo App
                              </a>
                              <a
                                href={venmoWebUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block text-sm text-blue-600 hover:text-blue-800 underline"
                              >
                                Or pay on venmo.com
                              </a>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                      {tripData.zelle_recipient && (
                        <div className="pt-4 border-t">
                          <p className="text-sm text-gray-600 mb-1">Zelle</p>
                          <p className="text-base font-medium text-gray-900">{tripData.zelle_recipient}</p>
                        </div>
                      )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
