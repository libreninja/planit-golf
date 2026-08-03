'use client'

export function LoadingSkeleton() {
  return (
    <div className="space-y-2" role="status" aria-label="Loading results">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="h-10 animate-pulse rounded-md bg-muted/40" />
      ))}
    </div>
  )
}

export function EmptyState({ message }: { message: string }) {
  return <p className="text-sm text-muted-foreground">{message}</p>
}

export function UnavailableState({
  message, onRetry, retrying,
}: {
  message: string
  onRetry?: () => void
  retrying?: boolean
}) {
  return (
    <div className="rounded-md border border-dashed border-border bg-muted/20 p-4 text-sm">
      <p className="text-muted-foreground">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="mt-2 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
        >
          {retrying ? 'Refreshing…' : 'Refresh now'}
        </button>
      )}
    </div>
  )
}

export function TeamEventState({ label }: { label: string }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-muted/20 p-4 text-sm">
      <p className="font-medium">Team event</p>
      <p className="mt-1 text-muted-foreground">{label} is a team/scramble format. Individual scorecards aren&apos;t available for this round.</p>
    </div>
  )
}

export function RefreshingIndicator({ refreshing }: { refreshing: boolean }) {
  if (!refreshing) return null
  return <span className="text-xs text-muted-foreground/70">Refreshing…</span>
}
