'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { Check, Plus } from 'lucide-react'
import { setGolferFollow } from '@/app/players/actions'
import { Button } from '@/components/ui/button'

export function FollowControl({
  golferId,
  signedIn,
  isSelf,
  initialFollowing,
  followIntent = false,
}: {
  golferId: string
  signedIn: boolean
  isSelf: boolean
  initialFollowing: boolean
  followIntent?: boolean
}) {
  const [following, setFollowing] = useState(initialFollowing)
  const [showUndo, setShowUndo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const consumedIntent = useRef(false)

  const update = (next: boolean) => {
    if (!signedIn) {
      const destination = new URL(window.location.href)
      destination.searchParams.set('intent', 'follow')
      window.location.assign(`/login?next=${encodeURIComponent(`${destination.pathname}${destination.search}`)}`)
      return
    }

    const previous = following
    setFollowing(next)
    setShowUndo(previous && !next)
    setError(null)
    startTransition(async () => {
      const result = await setGolferFollow(golferId, next)
      if (!result.ok) {
        setFollowing(previous)
        setShowUndo(false)
        setError(result.reason === 'self_follow' ? 'This is your player page.' : 'Follow could not be updated.')
      }
    })
  }

  useEffect(() => {
    if (!followIntent || !signedIn || isSelf || initialFollowing || consumedIntent.current) return
    consumedIntent.current = true
    const url = new URL(window.location.href)
    url.searchParams.delete('intent')
    window.history.replaceState(null, '', `${url.pathname}${url.search}`)
    update(true)
    // This is a one-time continuation of the user's pre-auth Follow click.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followIntent, signedIn, isSelf, initialFollowing])

  if (isSelf) {
    return <span className="rounded-md bg-muted px-3 py-2 text-sm font-medium text-muted-foreground">You</span>
  }

  if (showUndo && !following) {
    return (
      <div className="flex items-center gap-2" aria-live="polite">
        <span className="text-sm text-muted-foreground">Unfollowed</span>
        <button
          type="button"
          onClick={() => update(true)}
          disabled={pending}
          className="text-sm font-semibold text-primary underline-offset-4 hover:underline disabled:opacity-50"
        >
          Undo
        </button>
      </div>
    )
  }

  return (
    <div className="text-right">
      <Button
        type="button"
        size="sm"
        variant={following ? 'outline' : 'default'}
        aria-pressed={following}
        disabled={pending}
        onClick={() => update(!following)}
      >
        {following ? <Check className="mr-1.5 h-4 w-4" aria-hidden /> : <Plus className="mr-1.5 h-4 w-4" aria-hidden />}
        {following ? 'Following' : 'Follow'}
      </Button>
      {error ? <p className="mt-1 text-xs text-destructive" role="alert">{error}</p> : null}
    </div>
  )
}
