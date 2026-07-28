// Loading boundary for the /igc segment. Covers every left-nav destination
// under Interbay (Men's/Women's Standings, Tee Times, Seattle Cup Scouting, the
// club index) — not Scouting-specific. Shows a quiet skeleton in the content
// area the instant a navigation into /igc begins, so the previous page never
// freezes while a force-dynamic destination renders server-side. The persistent
// app shell (root layout) stays mounted and stable around it.
import { LoadingSkeleton } from '@/components/app-shell/loading-skeleton'

export default function Loading() {
  return <LoadingSkeleton />
}