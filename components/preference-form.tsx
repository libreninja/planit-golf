'use client'

import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { GripVertical, Shield, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { deleteEventPreference, saveDefaultPreferences, saveEventPreference, signOut } from '@/app/actions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'

interface Profile {
  id: string
  display_name: string | null
  is_admin?: boolean | null
  is_system_admin?: boolean | null
}

interface EventTimeSlot {
  id: string
  time_slot: string
  display_order: number
}

interface Event {
  id: string
  event_date: string
  course_name: string
  event_time_slots: EventTimeSlot[]
}

interface DefaultPrefs {
  tee_time_preferences: string[]
}

interface EventPref {
  event_id: string
  tee_time_preferences: string[]
}

interface PreferenceFormProps {
  user: User
  profile: Profile | null
  events: Event[]
  defaultPrefs: DefaultPrefs | null
  eventPrefs: EventPref[]
  eventDemandCounts: Record<string, Record<string, number>>
}

type EditorState =
  | { type: 'defaults' }
  | { type: 'event'; eventId: string }
  | null

function formatDate(dateStr: string) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${dateStr}T00:00:00Z`))
}

function getDemandLabel(count: number) {
  if (count <= 0) return null
  return `${count} request${count === 1 ? '' : 's'}`
}

function TimeChipSelector({
  selectedTimes,
  availableTimes,
  demandCounts,
  onAdd,
  onRemove,
  onReorder,
}: {
  selectedTimes: string[]
  availableTimes: string[]
  demandCounts?: Record<string, number>
  onAdd: (time: string) => void
  onRemove: (time: string) => void
  onReorder: (fromIndex: number, toIndex: number) => void
}) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const unselectedTimes = availableTimes.filter((time) => !selectedTimes.includes(time))

  return (
    <div className="space-y-3">
      {selectedTimes.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Your ranked preferences:</p>
          <div className="flex flex-wrap gap-2">
            {selectedTimes.map((time, index) => (
              <div
                key={time}
                draggable
                onDragStart={() => setDraggedIndex(index)}
                onDragOver={(event) => {
                  event.preventDefault()
                  if (draggedIndex !== null && draggedIndex !== index) {
                    onReorder(draggedIndex, index)
                    setDraggedIndex(index)
                  }
                }}
                onDragEnd={() => setDraggedIndex(null)}
                className={`flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground ${draggedIndex === index ? 'opacity-50' : ''}`}
              >
                <GripVertical className="h-3 w-3 opacity-60" />
                <span className="mr-1 font-bold">#{index + 1}</span>
                <span>{time}</span>
                {getDemandLabel(demandCounts?.[time] || 0) ? (
                  <span className="text-[11px] text-primary-foreground/80">{getDemandLabel(demandCounts?.[time] || 0)}</span>
                ) : null}
                <button
                  type="button"
                  onClick={() => onRemove(time)}
                  className="ml-1 rounded-full p-0.5 hover:bg-primary-foreground/20"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {selectedTimes.length < 3 && unselectedTimes.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            {selectedTimes.length === 0 ? 'Pick up to three preferred times:' : 'Add another preference:'}
          </p>
          <div className="flex flex-wrap gap-2">
            {unselectedTimes.map((time) => (
              <button
                key={time}
                type="button"
                onClick={() => onAdd(time)}
                className="rounded-full border border-border bg-background px-3 py-1.5 text-sm transition hover:border-primary hover:bg-secondary"
              >
                <span>{time}</span>
                {getDemandLabel(demandCounts?.[time] || 0) ? (
                  <span className="ml-1 text-xs text-muted-foreground">{getDemandLabel(demandCounts?.[time] || 0)}</span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function PreferenceForm({
  user,
  profile,
  events,
  defaultPrefs,
  eventPrefs,
  eventDemandCounts,
}: PreferenceFormProps) {
  const router = useRouter()
  const allTeeTimes = Array.from(
    new Set(
      events.flatMap((event) =>
        event.event_time_slots
          .slice()
          .sort((a, b) => a.display_order - b.display_order)
          .map((slot) => slot.time_slot),
      ),
    ),
  )

  const [defaultTimes, setDefaultTimes] = useState<string[]>(defaultPrefs?.tee_time_preferences || [])
  const [eventOverrides, setEventOverrides] = useState<Record<string, { times: string[] }>>(() => {
    const overrides: Record<string, { times: string[] }> = {}
    for (const eventPref of eventPrefs) {
      overrides[eventPref.event_id] = { times: eventPref.tee_time_preferences }
    }
    return overrides
  })
  const [editor, setEditor] = useState<EditorState>(null)
  const [draftTimes, setDraftTimes] = useState<string[]>([])
  const [savingEditor, setSavingEditor] = useState(false)
  const [showChangedOnly, setShowChangedOnly] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return null
  }

  const getEventPreferences = (eventId: string) => eventOverrides[eventId] || { times: defaultTimes }
  const visibleEvents = showChangedOnly
    ? events.filter((event) => Boolean(eventOverrides[event.id]))
    : events
  const editorEvent = editor?.type === 'event' ? events.find((event) => event.id === editor.eventId) || null : null
  const editorAvailableTimes =
    editor?.type === 'event'
      ? (editorEvent?.event_time_slots || [])
          .slice()
          .sort((a, b) => a.display_order - b.display_order)
          .map((slot) => slot.time_slot)
      : allTeeTimes
  const editorDemandCounts =
    editor?.type === 'event'
      ? eventDemandCounts[editor.eventId] || {}
      : eventDemandCounts[events[0]?.id || ''] || {}

  const openDefaultsEditor = () => {
    setDraftTimes(defaultTimes)
    setEditor({ type: 'defaults' })
  }

  const openEventEditor = (eventId: string) => {
    setDraftTimes(getEventPreferences(eventId).times)
    setEditor({ type: 'event', eventId })
  }

  const closeEditor = () => {
    setEditor(null)
    setDraftTimes([])
  }

  const handleSaveEditor = async () => {
    if (!editor) return

    setSavingEditor(true)
    try {
      if (editor.type === 'defaults') {
        await saveDefaultPreferences(draftTimes)
        setDefaultTimes(draftTimes)
      } else {
        await saveEventPreference(editor.eventId, draftTimes)
        setEventOverrides((current) => ({
          ...current,
          [editor.eventId]: { times: draftTimes },
        }))
      }

      closeEditor()
    } finally {
      setSavingEditor(false)
    }
  }

  const handleUseDefaultsForEvent = async () => {
    if (!editor || editor.type !== 'event') return

    setSavingEditor(true)
    try {
      await deleteEventPreference(editor.eventId)
      setEventOverrides((current) => {
        const next = { ...current }
        delete next[editor.eventId]
        return next
      })
      closeEditor()
    } finally {
      setSavingEditor(false)
    }
  }

  return (
    <main className="min-h-screen">
      <div className="sticky top-0 z-30 bg-foreground text-background">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="order-1 text-left">
            <p className="font-display text-2xl leading-none">Big Deal</p>
          </div>
          <div className="order-2 flex flex-wrap items-center gap-2 sm:justify-end">
            <span className="mr-auto text-xs text-background/70 sm:mr-0 sm:order-2">
              {profile?.display_name || user.email}
            </span>
            <div className="flex flex-wrap items-center gap-2 sm:order-3">
              {profile?.is_admin || profile?.is_system_admin ? (
                <Button variant="outline" size="sm" className="border-white/30 bg-transparent text-background hover:bg-white/10 hover:text-background" onClick={() => router.push('/admin')}>
                  <Shield className="mr-2 h-4 w-4" />
                  Admin
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                className="text-background hover:bg-white/10 hover:text-background"
                onClick={async () => {
                  await signOut()
                  router.push('/login')
                }}
              >
                Sign Out
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl space-y-4 px-4 py-4 pb-28 sm:py-6 sm:pb-32">

        <Card className="border-white/70 bg-white/85">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-lg">Preferred tee times</CardTitle>
            <Dialog
              open={editor?.type === 'defaults'}
              onOpenChange={(open) => {
                if (open) {
                  openDefaultsEditor()
                } else {
                  closeEditor()
                }
              }}
            >
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" onClick={openDefaultsEditor}>
                  {defaultTimes.length > 0 ? 'Update' : 'Set defaults'}
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Preferred tee times</DialogTitle>
                </DialogHeader>
                <TimeChipSelector
                  selectedTimes={draftTimes}
                  availableTimes={editorAvailableTimes}
                  demandCounts={editorDemandCounts}
                  onAdd={(time) => {
                    if (draftTimes.length < 3) setDraftTimes([...draftTimes, time])
                  }}
                  onRemove={(time) => setDraftTimes(draftTimes.filter((selectedTime) => selectedTime !== time))}
                  onReorder={(fromIndex, toIndex) => {
                    const reordered = [...draftTimes]
                    const [removed] = reordered.splice(fromIndex, 1)
                    reordered.splice(toIndex, 0, removed)
                    setDraftTimes(reordered)
                  }}
                />
                <DialogFooter>
                  <Button onClick={handleSaveEditor} disabled={savingEditor}>
                    {savingEditor ? 'Saving...' : 'Save'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent>
            {defaultTimes.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {defaultTimes.map((time, index) => (
                  <Badge key={time} variant="outline">
                    #{index + 1} {time}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No preferred tee times set.</p>
            )}
          </CardContent>
        </Card>

        <Card className="border-white/70 bg-white/85">
          <CardHeader>
            <CardTitle className="text-lg">Upcoming events</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="mb-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={showChangedOnly}
                  onChange={(event) => setShowChangedOnly(event.target.checked)}
                  className="h-4 w-4 rounded border-border text-primary focus:ring-ring"
                />
                <span>Only show events with overrides</span>
              </label>
              <Badge variant="outline">{visibleEvents.length} events</Badge>
            </div>
            <div className="max-h-[min(52vh,34rem)] overflow-y-auto pr-1 sm:pr-2">
              <div className="space-y-3">
            {visibleEvents.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                {showChangedOnly ? 'No events have overrides yet.' : 'No upcoming events are configured yet.'}
              </p>
            ) : (
              visibleEvents.map((event) => {
                const hasOverride = Boolean(eventOverrides[event.id])
                const prefs = getEventPreferences(event.id)

                return (
                  <div key={event.id} className="rounded-xl border border-border bg-background/80 p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{formatDate(event.event_date)}</p>
                          {hasOverride ? <Badge variant="secondary">Override</Badge> : null}
                        </div>
                        <p className="text-sm text-muted-foreground">{event.course_name}</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {prefs.times.length > 0 ? (
                            prefs.times.map((time, index) => (
                              <Badge key={`${event.id}-${time}`} variant="outline">
                                #{index + 1} {time}
                                {eventDemandCounts[event.id]?.[time] ? ` · ${eventDemandCounts[event.id][time]}` : ''}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-sm text-muted-foreground">Using preferred tee times</span>
                          )}
                        </div>
                      </div>

                      <Button variant="outline" size="sm" onClick={() => openEventEditor(event.id)}>
                        Update
                      </Button>
                    </div>
                  </div>
                )
              })
            )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={editor?.type === 'event'}
        onOpenChange={(open) => {
          if (!open) {
            closeEditor()
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editorEvent ? formatDate(editorEvent.event_date) : 'Event override'}</DialogTitle>
          </DialogHeader>
          <TimeChipSelector
            selectedTimes={draftTimes}
            availableTimes={editorAvailableTimes}
            demandCounts={editorDemandCounts}
            onAdd={(time) => {
              if (draftTimes.length < 3) setDraftTimes([...draftTimes, time])
            }}
            onRemove={(time) => setDraftTimes(draftTimes.filter((selectedTime) => selectedTime !== time))}
            onReorder={(fromIndex, toIndex) => {
              const reordered = [...draftTimes]
              const [removed] = reordered.splice(fromIndex, 1)
              reordered.splice(toIndex, 0, removed)
              setDraftTimes(reordered)
            }}
          />
          <DialogFooter>
            {editor?.type === 'event' ? (
              <Button variant="ghost" onClick={handleUseDefaultsForEvent} disabled={savingEditor}>
                Use defaults
              </Button>
            ) : null}
            <Button onClick={handleSaveEditor} disabled={savingEditor}>
              {savingEditor ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}
