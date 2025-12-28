import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const { email, code } = await request.json()
  const url = new URL(request.url)
  const next = url.searchParams.get('next') || '/trips'

  if (!email || !code) {
    return NextResponse.json({ error: 'Email and code required' }, { status: 400 })
  }

  const cookieStore = await cookies()
  const redirectUrl = new URL(next, url.origin)
  
  // Create Supabase client with proper cookie handling
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: any }>) {
          // This WILL be called when we use setSession
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options)
          })
        },
      },
    }
  )
  
  // Verify OTP
  let result = await supabase.auth.verifyOtp({
    email,
    token: code.trim(),
    type: 'email',
  })
  
  if (result.error) {
    result = await supabase.auth.verifyOtp({
      email,
      token: code.trim(),
      type: 'magiclink',
    })
  }

  if (result.error) {
    return NextResponse.json({ error: result.error.message }, { status: 400 })
  }

  if (!result.data.session) {
    return NextResponse.json({ error: 'No session created' }, { status: 400 })
  }

  // Set session - this should trigger setAll callback
  await supabase.auth.setSession({
    access_token: result.data.session.access_token,
    refresh_token: result.data.session.refresh_token,
  })

  // Create redirect response
  const response = NextResponse.redirect(redirectUrl)
  
  // Copy cookies from cookieStore to response
  const allCookies = cookieStore.getAll()
  allCookies.forEach((cookie) => {
    response.cookies.set(cookie.name, cookie.value, {
      path: '/',
      sameSite: 'lax',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
    })
  })
  
  return response
}
