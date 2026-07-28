// A quiet, intentional loading treatment for the content area while a
// destination route is still rendering server-side. Used by the route-level
// loading.tsx boundaries so a navigation is acknowledged immediately instead of
// freezing on the previous page until the new one is ready.
//
// PlanIt-like: a small conventional indeterminate spinner + "Loading…" label
// paired with a few muted shimmer bars (no giant centered spinner, no modal, no
// full-page blank, no fake progress percentages). Presentational only — no
// hooks — so it can be rendered from both server and client loading boundaries.
export function LoadingSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading" className="pt-2">
      {/* Small spinner + label: a quiet, conventional indeterminate indicator
          that makes "work is in progress" obvious without dominating the area. */}
      <div className="flex items-center gap-2 text-muted-foreground/70">
        <span
          aria-hidden
          className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-foreground/60"
        />
        <span className="text-xs">Loading…</span>
      </div>
      <div className="mt-5 animate-pulse space-y-2">
        <div className="h-6 w-44 rounded bg-muted" />
        <div className="h-3.5 w-64 rounded bg-muted/70" />
      </div>
      <div className="mt-8 animate-pulse space-y-2.5">
        <div className="h-3 w-full rounded bg-muted/60" />
        <div className="h-3 w-full rounded bg-muted/60" />
        <div className="h-3 w-2/3 rounded bg-muted/60" />
      </div>
    </div>
  )
}