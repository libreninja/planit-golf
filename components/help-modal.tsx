'use client'

import { HelpCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'

type HelpMode = 'member' | 'admin'

const memberSections = [
  {
    title: 'How preferences work',
    items: [
      'Pick up to three tee times and rank them in order.',
      'Preferred tee times are your defaults for future weeks.',
      'Use an event override only when a specific week should differ.',
    ],
  },
  {
    title: 'How runs are resolved',
    items: [
      'The bot attempts your first choice, then second, then third.',
      'Each player is registered individually.',
      'Crowded times show request counts so you can see demand before the run.',
    ],
  },
]

const adminSections = [
  {
    title: 'Invites',
    items: [
      'Search the roster and send invites only when needed.',
      'Invited members sign in with the same planit.golf account system.',
      'Only accepted members with valid preferences appear in the next run table.',
    ],
  },
  {
    title: 'Next run',
    items: [
      'The table shows the actual ranked preferences the runner will use.',
      'Demand counts reveal where multiple players want the same tee time.',
      'Contested runs are ordered with a stable event-specific shuffle rather than alphabetically.',
    ],
  },
]

export function HelpModal({ mode }: { mode: HelpMode }) {
  const title = mode === 'admin' ? 'Admin help' : 'How Good to Go works'
  const sections = mode === 'admin' ? adminSections : memberSections

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-background hover:bg-white/10 hover:text-background">
          <HelpCircle className="mr-2 h-4 w-4" />
          Help
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-5 text-sm">
          {sections.map((section) => (
            <section key={section.title} className="space-y-2">
              <h3 className="font-medium">{section.title}</h3>
              <ul className="space-y-2 text-muted-foreground">
                {section.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
