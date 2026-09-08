'use client'

import Link, { useLinkStatus } from 'next/link'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils/cn'

type LinkProps = ComponentProps<typeof Link>

function PendingLinkBody({
  children,
  pendingLabel,
  contentClassName,
  pendingClassName,
}: {
  children: ReactNode
  pendingLabel: string
  contentClassName?: string
  pendingClassName?: string
}) {
  const { pending } = useLinkStatus()
  return (
    <span
      className={cn(contentClassName, pending && 'opacity-70', pending && pendingClassName)}
      aria-busy={pending || undefined}
    >
      {children}
      {pending ? (
        <span role="status" className="ml-1.5 text-[10px] font-medium text-primary animate-pulse">
          {pendingLabel}
        </span>
      ) : null}
    </span>
  )
}

export function PendingLink({
  children,
  pendingLabel = 'Loading…',
  contentClassName,
  pendingClassName,
  prefetch = true,
  ...props
}: LinkProps & {
  pendingLabel?: string
  contentClassName?: string
  pendingClassName?: string
}) {
  return (
    <Link {...props} prefetch={prefetch}>
      <PendingLinkBody
        pendingLabel={pendingLabel}
        contentClassName={contentClassName}
        pendingClassName={pendingClassName}
      >
        {children}
      </PendingLinkBody>
    </Link>
  )
}
