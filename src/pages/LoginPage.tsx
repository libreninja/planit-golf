import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { getSupabaseClient } from '../lib/supabase'

const supabase = getSupabaseClient()

export default function LoginPage() {
  const [loading, setLoading] = useState(false)
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  // Check URL params for magic link callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token_hash = params.get('token_hash')
    const type = params.get('type')

    if (token_hash) {
      setLoading(true)
      supabase.auth.verifyOtp({
        token_hash,
        type: (type as any) || 'email',
      }).then(({ error }) => {
        if (error) {
          setMessage({ type: 'error', text: error.message })
        } else {
          const next = searchParams.get('next') || '/trips'
          navigate(next)
        }
        setLoading(false)
      })
    }
  }, [navigate, searchParams])

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)

    try {
      // Use production URL for magic links, fallback to current origin for local dev
      const redirectUrl = import.meta.env.VITE_APP_URL || window.location.origin
      
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true,
          emailRedirectTo: `${redirectUrl}/login`,
        },
      })

      if (error) {
        setMessage({ type: 'error', text: error.message || 'Failed to send email' })
      } else {
        setMessage({ 
          type: 'success', 
          text: 'Check your email! We sent you a magic link to sign in.' 
        })
      }
      setLoading(false)
    } catch (err) {
      setMessage({ type: 'error', text: 'An unexpected error occurred' })
      setLoading(false)
    }
  }


  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md bg-white rounded-lg shadow-lg p-8">
        <h1 className="text-3xl font-bold mb-2 text-center">Sign in to planit.golf</h1>
        <p className="text-gray-600 text-center mb-6">
          Enter your email and we'll send you a magic link to sign in
        </p>

        <form onSubmit={handleEmailSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
              Email
            </label>
            <input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={loading}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {message && (
            <div
              className={`p-3 rounded-md text-sm ${
                message.type === 'success'
                  ? 'bg-green-50 text-green-800'
                  : 'bg-red-50 text-red-800'
              }`}
            >
              {message.text}
            </div>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50"
          >
            {loading ? 'Sending...' : 'Send magic link'}
          </button>
        </form>
      </div>
    </div>
  )
}

