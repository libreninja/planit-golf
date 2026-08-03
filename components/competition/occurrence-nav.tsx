'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'

interface Occ { id: string; label: string }

export function OccurrenceNav({
  occurrences, selectedId, queryParam,
}: { occurrences: Occ[]; selectedId: string | null; queryParam: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const idx = occurrences.findIndex((o) => o.id === selectedId)
  const prev = idx > 0 ? occurrences[idx - 1] : null
  const next = idx >= 0 && idx < occurrences.length - 1 ? occurrences[idx + 1] : null

  const navigate = (id: string) => {
    const nextParams = new URLSearchParams(params.toString())
    nextParams.set(queryParam, id)
    router.replace(`${pathname}?${nextParams.toString()}`, { scroll: false })
  }

  return (
    <div className="flex items-center gap-2">
      <button type="button" disabled={!prev} onClick={() => prev && navigate(prev.id)}
        className="rounded-md border border-border px-2 py-1 text-sm disabled:opacity-40" aria-label="Previous">‹</button>
      <select
        value={selectedId ?? ''}
        onChange={(e) => navigate(e.target.value)}
        className="rounded-md border border-border bg-background px-2 py-1 text-sm"
      >
        {occurrences.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      <button type="button" disabled={!next} onClick={() => next && navigate(next.id)}
        className="rounded-md border border-border px-2 py-1 text-sm disabled:opacity-40" aria-label="Next">›</button>
    </div>
  )
}
