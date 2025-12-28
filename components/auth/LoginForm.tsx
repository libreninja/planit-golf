'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export function LoginForm() {
  // Start with email step (server and client match)
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const router = useRouter()
  const searchParams = useSearchParams()

  // Load from localStorage only on client after mount (prevents hydration mismatch)
  useEffect(() => {
    const savedStep = localStorage.getItem('loginStep')
    const savedEmail = localStorage.getItem('loginEmail')
    if (savedStep === 'code' && savedEmail) {
      setStep('code')
      setEmail(savedEmail)
    }
  }, [])

  // Update localStorage when step changes
  const updateStep = (newStep: 'email' | 'code') => {
    setStep(newStep)
    if (typeof window !== 'undefined') {
      localStorage.setItem('loginStep', newStep)
      if (newStep === 'email') {
        localStorage.removeItem('loginEmail')
      } else {
        localStorage.setItem('loginEmail', email)
      }
    }
  }

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)

    try {
      const supabase = createClient()
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true,
        },
      })
      
      if (error) {
        setMessage({ type: 'error', text: error.message || 'Failed to send email. Please try again.' })
        setLoading(false)
        return
      }
      
      setMessage({ type: 'success', text: 'Check your email for the verification code!' })
      updateStep('code')
      setLoading(false)
    } catch (err) {
      setMessage({ type: 'error', text: 'An unexpected error occurred. Please try again.' })
      setLoading(false)
    }
  }

  const handleCodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)

    try {
      const supabase = createClient()
      const next = searchParams.get('next') || '/trips'
      
      // Verify OTP - Supabase handles session storage automatically
      let result = await supabase.auth.verifyOtp({
        email,
        token: code.trim(),
        type: 'email',
      })

      if (result.error) {
        // Try magiclink as fallback
        result = await supabase.auth.verifyOtp({
          email,
          token: code.trim(),
          type: 'magiclink',
        })
        
        if (result.error) {
          setMessage({ type: 'error', text: result.error.message || 'Invalid code. Please try again.' })
          setLoading(false)
          return
        }
      }

      if (!result.data?.session) {
        setMessage({ type: 'error', text: 'No session created. Please try again.' })
        setLoading(false)
        return
      }

      // Clear form state
      localStorage.removeItem('loginStep')
      localStorage.removeItem('loginEmail')
      
      // Redirect - session is stored by Supabase client
      window.location.href = next
    } catch (error) {
      setMessage({ type: 'error', text: 'An error occurred. Please try again.' })
      setLoading(false)
    }
  }

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle>Sign in to Trip HQ</CardTitle>
        <CardDescription>
          {step === 'email' 
            ? 'Enter your email to receive a verification code'
            : 'Enter the code from your email'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {step === 'email' ? (
          <form onSubmit={handleEmailSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
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
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Sending...' : 'Send code'}
            </Button>
          </form>
        ) : (
          <form onSubmit={handleCodeSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="code">Verification Code</Label>
              <Input
                id="code"
                type="text"
                placeholder="Enter code from email"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                disabled={loading}
                className="text-center text-lg font-mono"
                autoComplete="one-time-code"
              />
              <p className="text-xs text-muted-foreground">
                Code sent to {email}
              </p>
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
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => {
                  updateStep('email')
                  setCode('')
                  setMessage(null)
                }}
                disabled={loading}
              >
                Back
              </Button>
              <Button type="submit" className="flex-1" disabled={loading || !code.trim()}>
                {loading ? 'Verifying...' : 'Verify'}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  )
}

