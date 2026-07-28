'use client'

// Root loading boundary. It covers the one left-nav destination NOT under /igc:
// Home (/). (Every /igc destination has its own boundary at app/igc/loading.tsx.)
// It also sits at the root of the segment tree, so without care it would also
// flash on auth/hidden routes (login, signup, invite, events, leaderboard, …)
// which keep their own page chrome. This client boundary hides itself on those
// routes by reusing the shell's visibility rule, and shows the quiet skeleton
// only on shell-visible destinations (Home, and any other shell route that
// suspends without a closer loading boundary). The persistent app shell stays
// mounted and stable around it.
import { usePathname } from 'next/navigation'
import { isShellVisible } from '@/components/app-shell/app-shell'
import { LoadingSkeleton } from '@/components/app-shell/loading-skeleton'

export default function Loading() {
  const pathname = usePathname() || '/'
  if (!isShellVisible(pathname)) return null
  return <LoadingSkeleton />
}