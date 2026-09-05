'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { Star } from 'lucide-react'
import { setGolferFollow } from '@/app/players/actions'
import { cn } from '@/lib/utils/cn'

const FOLLOW_STATE_EVENT = 'planit:golfer-follow-state'

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
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const consumedIntent = useRef(false)

  const setSharedFollowing = (next: boolean) => {
    setFollowing(next)
    window.dispatchEvent(new CustomEvent(FOLLOW_STATE_EVENT, { detail: { golferId, following: next } }))
  }

  const update = (next: boolean) => {
    if (!signedIn) {
      const destination = new URL(window.location.href)
      destination.searchParams.set('follow', golferId)
      window.location.assign(`/login?next=${encodeURIComponent(`${destination.pathname}${destination.search}`)}`)
      return
    }

    const previous = following
    setSharedFollowing(next)
    setError(null)
    startTransition(async () => {
      const result = await setGolferFollow(golferId, next)
      if (!result.ok) {
        setSharedFollowing(previous)
        setError(result.reason === 'self_follow' ? 'This is your player page.' : 'Follow could not be updated.')
      }
    })
  }

  useEffect(() => {
    const url = new URL(window.location.href)
    const matchesInlineIntent = url.searchParams.get('follow') === golferId
    if ((!followIntent && !matchesInlineIntent) || !signedIn || consumedIntent.current) return
    consumedIntent.current = true
    url.searchParams.delete('intent')
    url.searchParams.delete('follow')
    window.history.replaceState(null, '', `${url.pathname}${url.search}`)
    if (isSelf || initialFollowing) return
    update(true)
    // This is a one-time continuation of the user's pre-auth Follow click.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followIntent, golferId, signedIn, isSelf, initialFollowing])

  useEffect(() => {
    const sync = (event: Event) => {
      const detail = (event as CustomEvent<{ golferId: string; following: boolean }>).detail
      if (detail?.golferId === golferId) setFollowing(detail.following)
    }
    window.addEventListener(FOLLOW_STATE_EVENT, sync)
    return () => window.removeEventListener(FOLLOW_STATE_EVENT, sync)
  }, [golferId])

  if (isSelf) return null

  return (
    <span className="inline-flex shrink-0 items-center">
      <button
        type="button"
        aria-pressed={following}
        aria-label={following ? 'Unfollow player' : 'Follow player'}
        title={following ? 'Unfollow' : 'Follow'}
        disabled={pending}
        onClick={() => update(!following)}
        className={cn(
          'inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50',
          following ? 'text-primary hover:bg-primary/10' : 'text-muted-foreground hover:bg-muted hover:text-primary',
        )}
      >
        <Star className={cn('h-[18px] w-[18px]', following && 'fill-current')} aria-hidden />
      </button>
      {error ? <span className="sr-only" role="alert">{error}</span> : null}
    </span>
  )
}
