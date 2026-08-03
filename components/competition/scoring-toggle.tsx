'use client'

import { cn } from '@/lib/utils/cn'

export function ScoringToggle({
  modes, selected, onSelect,
}: { modes: { key: string; label: string }[]; selected: string; onSelect: (m: string) => void }) {
  if (modes.length <= 1) return null
  return (
    <div className="inline-flex rounded-md border border-border p-0.5">
      {modes.map((m) => (
        <button key={m.key} type="button" onClick={() => onSelect(m.key)}
          className={cn('rounded px-2.5 py-1 text-sm capitalize', selected === m.key ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground')}>
          {m.label}
        </button>
      ))}
    </div>
  )
}
