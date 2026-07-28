'use client'

// Signup form for a Seattle Cup capability invite. Mirrors the GTG SignUpForm
// pattern but is entirely separate: it validates against capability_invites
// (not the members-anchored invites table) and stores capability_invite_token
// in user_metadata so the post-confirmation redirect back to
// /scouting-invite/[token] can claim. Does NOT modify the GTG signup flow.

import Link from 'next/link'
import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { validateScoutingInviteForSignUp } from '@/app/scouting-invite-actions'
import { PasswordRequirements } from '@/components/auth/PasswordRequirements'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getPasswordValidationMessage, PASSWORD_MIN_LENGTH } from '@/lib/password-policy'

export function ScoutingSignUpForm({
  inviteToken,
  email: inviteEmail,
  displayName,
}: {
  inviteToken: string
  email: string
  displayName: string | null
}) {
  const [email, setEmail] = useState(inviteEmail)
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState(displayName ?? '')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const nextTarget = `/scouting-invite/${inviteToken}`
  const loginHref = `/login?next=${encodeURIComponent(nextTarget)}`

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

    const inviteCheck = await validateScoutingInviteForSignUp(email, inviteToken)
    if (!inviteCheck.valid) {
      setError('This invite is invalid or tied to a different email address.')
      setLoading(false)
      return
    }

    if (inviteCheck.authStatus === 'confirmed') {
      router.push(
        `/login?next=${encodeURIComponent(nextTarget)}&email=${encodeURIComponent(
          email
        )}&notice=${encodeURIComponent('You already have an account. Sign in to continue.')}`
      )
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
        setNotice(
          "You already started sign up. We resent the confirmation email. Check your spam or junk folder if it doesn't arrive — submit again to resend it."
        )
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
          capability_invite_token: inviteToken,
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

  return (
    <Card className="w-full max-w-md border-white/70 bg-white/90 shadow-xl shadow-primary/10 backdrop-blur">
      <CardHeader className="text-center">
        <CardTitle className="text-3xl">Seattle Cup scouting</CardTitle>
        <CardDescription>Create your planit.golf account to accept the invitation.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form onSubmit={handleSignUp} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="fullName">Full name</Label>
            <Input
              id="fullName"
              placeholder="Your full name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">Use the email the invitation was sent to.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="Create a password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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

        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link href={loginHref} className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  )
}