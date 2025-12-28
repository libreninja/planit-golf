'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function AuthCallback() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const handleCallback = async () => {
      const supabase = createClient()
      const code = searchParams.get('code')
      const token = searchParams.get('token')
      const type = searchParams.get('type')
      const next = searchParams.get('next') || '/trips'

      console.log('Callback params:', { code: !!code, token: !!token, type, next })

      // Handle PKCE flow with code
      if (code) {
        console.log('Exchanging code for session...')
        const { data, error: verifyError } = await supabase.auth.exchangeCodeForSession(code)
        
        if (verifyError) {
          console.error('Auth error:', verifyError)
          setError(verifyError.message)
          setTimeout(() => router.push(`/login?error=${encodeURIComponent(verifyError.message)}`), 2000)
          return
        }

        if (data.session) {
          console.log('Session created, redirecting...')
          await new Promise(resolve => setTimeout(resolve, 200))
          window.location.href = next
        } else {
          console.error('No session in response')
          setError('No session created')
          setTimeout(() => router.push('/login'), 2000)
        }
        return
      }

      // Handle token-based magic link
      if (token && type) {
        console.log('Verifying token...', { type })
        const { data, error: verifyError } = await supabase.auth.verifyOtp({
          token_hash: token,
          type: type as 'magiclink' | 'email',
        })
        
        if (verifyError) {
          console.error('Token verification error:', verifyError)
          setError(verifyError.message)
          setTimeout(() => router.push(`/login?error=${encodeURIComponent(verifyError.message)}`), 2000)
          return
        }

        if (data.session) {
          console.log('Session created from token, redirecting...')
          await new Promise(resolve => setTimeout(resolve, 200))
          window.location.href = next
        } else {
          console.error('No session in token response')
          setError('No session created')
          setTimeout(() => router.push('/login'), 2000)
        }
        return
      }

      // No code or token found - show what we got
      console.error('Missing params:', { code: !!code, token: !!token, type, allParams: Object.fromEntries(searchParams.entries()) })
      setError('No verification code or token provided')
      setTimeout(() => router.push('/login'), 2000)
    }

    handleCallback()
  }, [router, searchParams])

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error}</p>
          <p className="text-sm text-muted-foreground">Redirecting to login...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <p>Completing sign in...</p>
      </div>
    </div>
  )
}

