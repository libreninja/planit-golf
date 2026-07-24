import Link from 'next/link'
import { Button } from '@/components/ui/button'

// Rendered when the scouting backend could not be reached (PLANIT_AI_API_URL
// unset/unreachable). Shown only AFTER requireScoutingAccess() has run, so the
// viewer is an authorized scout — the access gate is never bypassed. The notice
// is intentionally non-technical; real backend defects are not routed here
// (see lib/planit-ai/client isBackendUnavailable).
export function ScoutingUnavailable() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-md border border-border bg-white/80 p-6 text-center">
        <h1 className="text-xl font-semibold">Scouting data is temporarily unavailable</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          We can&apos;t reach the scouting service right now. Your access is fine — please try again in a few minutes. If the
          problem persists, contact your Seattle Cup captain.
        </p>
        <div className="mt-4">
          <Button asChild variant="outline" size="sm">
            <Link href="/">Back to planit.golf</Link>
          </Button>
        </div>
      </div>
    </main>
  )
}