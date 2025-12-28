'use client'

import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return document.cookie.split('; ').map(cookie => {
            const [name, ...rest] = cookie.split('=')
            return { name, value: decodeURIComponent(rest.join('=')) }
          })
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: { path?: string; maxAge?: number; sameSite?: 'lax' | 'strict' | 'none'; secure?: boolean; httpOnly?: boolean } }>) {
          cookiesToSet.forEach(({ name, value, options }) => {
            // Build cookie string - httpOnly can't be set from JavaScript, so we skip it
            const cookieParts = [
              `${name}=${encodeURIComponent(value)}`,
              `path=${options?.path || '/'}`,
              `samesite=${options?.sameSite || 'lax'}`, // Always set SameSite
            ]
            if (options?.maxAge) cookieParts.push(`max-age=${options.maxAge}`)
            if (options?.secure) cookieParts.push('secure')
            document.cookie = cookieParts.join('; ')
          })
        },
      },
    }
  )
}
