'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { validateInviteForSignUp } from '@/app/actions'
import { ENABLED_OAUTH_PROVIDERS, type OAuthProvider } from '@/lib/auth-providers'
import { PasswordRequirements } from '@/components/auth/PasswordRequirements'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getPasswordValidationMessage, PASSWORD_MIN_LENGTH } from '@/lib/password-policy'

export function SignUpForm({ inviteToken = '' }: { inviteToken?: string }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const nextTarget = inviteToken ? `/invite/${inviteToken}` : '/'
  const loginHref = inviteToken ? `/login?next=${encodeURIComponent(nextTarget)}` : '/login'

  const handleSignUp = async (event: React.FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError(null)
    setNotice(null)

    const passwordError = getPasswordValidationMessage(password)
    if (passwordError) {
      setError(passwordError)
      setLoading(false)
      return
    }

    const inviteCheck = await validateInviteForSignUp(email, inviteToken)
    if (!inviteCheck.valid) {
      setError('This invite is invalid or tied to a different email address.')
      setLoading(false)
      return
    }

    if (inviteCheck.authStatus === 'confirmed') {
      router.push(`/login?next=${encodeURIComponent(nextTarget)}&email=${encodeURIComponent(email)}&notice=${encodeURIComponent('You already have an account. Sign in to continue.')}`)
      return
    }

    if (inviteCheck.authStatus === 'unconfirmed') {
      const supabase = createClient()
      const { error: resendError } = await supabase.auth.resend({
        type: 'signup',
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextTarget)}`,
        },
      })

      if (resendError) {
        setError(resendError.message)
      } else {
        setNotice('You already started sign up. We resent the confirmation email.')
      }
      setLoading(false)
      return
    }

    const supabase = createClient()
    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextTarget)}`,
        data: {
          display_name: fullName,
          invite_token: inviteToken,
        },
      },
    })

    if (signUpError) {
      setError(signUpError.message)
      setLoading(false)
      return
    }

    router.push('/auth/sign-up-success')
  }

  const handleOAuthLogin = async (provider: OAuthProvider) => {
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextTarget)}`
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo },
    })

    if (oauthError) {
      setError(oauthError.message)
      setLoading(false)
    }
  }

  return (
    <Card className="w-full max-w-md border-white/70 bg-white/90 shadow-xl shadow-primary/10 backdrop-blur">
      <CardHeader className="text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-lg">
          <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeWidth="2" d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </div>
        <CardTitle className="text-3xl">Create account</CardTitle>
        <CardDescription>
          Create one shared planit.golf account to continue.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form onSubmit={handleSignUp} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="fullName">Full name</Label>
            <Input
              id="fullName"
              placeholder="Your full name"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="name@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="Create a password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={PASSWORD_MIN_LENGTH}
            />
          </div>

          <PasswordRequirements password={password} />

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {notice ? <p className="text-sm text-primary">{notice}</p> : null}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Create account
          </Button>
        </form>

        {ENABLED_OAUTH_PROVIDERS.length > 0 ? (
          <>
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase tracking-[0.2em]">
                <span className="bg-card px-3 text-muted-foreground">Or continue with</span>
              </div>
            </div>

            <div className={`grid gap-3 ${ENABLED_OAUTH_PROVIDERS.length === 1 ? 'grid-cols-1' : ENABLED_OAUTH_PROVIDERS.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
              {ENABLED_OAUTH_PROVIDERS.map((provider) => (
                <Button key={provider} variant="outline" disabled={loading} onClick={() => handleOAuthLogin(provider)}>
                  {provider === 'google' ? 'Google' : provider === 'apple' ? 'Apple' : 'Facebook'}
                </Button>
              ))}
            </div>
          </>
        ) : null}

        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href={loginHref} className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  )
}
