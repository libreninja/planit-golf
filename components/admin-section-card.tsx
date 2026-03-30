'use client'

import { ReactNode, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils/cn'

interface AdminSectionCardProps {
  title: string
  children: ReactNode
  defaultOpen?: boolean
  headerRight?: ReactNode
  contentClassName?: string
}

export function AdminSectionCard({
  title,
  children,
  defaultOpen = true,
  headerRight,
  contentClassName,
}: AdminSectionCardProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="overflow-hidden border-white/70 bg-white/85 shadow-lg shadow-primary/10">
        <CardHeader className="bg-primary px-4 py-3 text-primary-foreground">
          <CollapsibleTrigger className="group flex w-full items-center gap-3 rounded-sm text-left outline-none ring-offset-background transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-0">
            <CardTitle className="min-w-0 flex-1 text-base font-semibold text-primary-foreground">{title}</CardTitle>
            {headerRight ? <div className="shrink-0 text-xs text-primary-foreground/85">{headerRight}</div> : null}
            <ChevronDown
              className={cn(
                'h-4 w-4 shrink-0 text-primary-foreground transition-transform duration-200',
                open ? 'rotate-180' : 'rotate-0'
              )}
            />
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className={cn('pt-4', contentClassName)}>{children}</CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  )
}
