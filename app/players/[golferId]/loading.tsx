import { Skeleton } from '@/components/ui/skeleton'

export default function PlayerLoading() {
  return (
    <article className="mx-auto max-w-2xl space-y-5" aria-label="Loading player data">
      <Skeleton className="h-5 w-36" />
      <Skeleton className="h-9 w-64 max-w-full" />
      <Skeleton className="h-40 w-full" />
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <Skeleton className="h-32 w-full" />
    </article>
  )
}
