'use client'

export function LeaderboardClearFilters({
  active,
  onClear,
}: {
  active: boolean
  onClear: () => void
}) {
  return (
    <button
      type="button"
      disabled={!active}
      onClick={onClear}
      className="w-24 whitespace-nowrap py-1 text-right text-[10px] font-semibold tracking-wide text-muted-foreground hover:text-foreground disabled:cursor-default disabled:opacity-40"
    >
      CLEAR FILTERS
    </button>
  )
}
