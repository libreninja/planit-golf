'use client'

import { Search, X } from 'lucide-react'

export function PlayerSearch({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="relative w-full sm:max-w-md">
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
      />
      <input
        type="text"
        inputMode="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label="Search players"
        placeholder="Search players"
        autoComplete="off"
        className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-9 text-sm shadow-sm outline-none placeholder:text-muted-foreground/70 focus:border-ring focus:ring-2 focus:ring-ring/25"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear player search"
          className="absolute right-1.5 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  )
}

export function NoPlayersMatch({ onClear }: { onClear: () => void }) {
  return (
    <div className="rounded-md border border-dashed border-border px-3 py-4 text-sm">
      <p className="font-medium">No players match</p>
      <button
        type="button"
        onClick={onClear}
        className="mt-1 font-semibold text-primary underline-offset-4 hover:underline"
      >
        Clear search
      </button>
    </div>
  )
}
