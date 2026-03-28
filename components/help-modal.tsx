'use client'

import { HelpCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'

type HelpMode = 'member' | 'admin'

const memberSections = [
  {
    title: 'Welcome',
    items: [
      "Welcome to the IGC Good to Go system. The first rule is we don't talk about Good to Go.",
      'YOU ARE RESPONSIBLE FOR CANCELLING RESERVATIONS IF YOU CAN’T PLAY.',
    ],
  },
  {
    title: 'How it works',
    items: [
      'Preferred tee times are your weekly defaults.',
      'Use Individual event overrides to skip or change preferences for a specific week.',
      'We will attempt to register your first preference, then second or third as needed.',
      'We cannot guarantee playing partners will be on the same tee time.',
      'Pause registrations if you want to stay in Good to Go but stop getting entered until you turn it back on.',
      'Revoking Good to Go membership removes your access to the site and stops all future registrations.',
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
      <DialogContent className="max-w-2xl overflow-hidden p-0 [&>button]:text-primary-foreground [&>button]:opacity-100">
        <DialogHeader className="bg-primary px-6 py-5 text-left text-primary-foreground">
          <DialogTitle className="text-primary-foreground">{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-5 px-6 py-6 text-sm">
          {sections.map((section) => (
            <section key={section.title} className="space-y-2">
              <h3 className="font-medium">{section.title}</h3>
              <ul className="space-y-2 text-muted-foreground">
                {section.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              {mode === 'member' && section.title === 'How it works' ? (
                <div className="rounded-xl border border-border bg-muted/40 p-4">
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                    Example demand chip
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <div className="inline-flex items-center rounded-full border border-emerald-700 bg-emerald-600 px-2.5 py-0.5 text-xs font-semibold text-white">
                      #1 7:22 · 4
                    </div>
                    <p className="text-sm text-muted-foreground">
                      `7:22` is the tee time. `4` means four Good to Go members are currently trying for it.
                    </p>
                  </div>
                </div>
              ) : null}
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
