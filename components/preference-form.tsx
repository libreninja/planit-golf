'use client'

import { useEffect, useEffectEvent, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { GripVertical, Shield, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { deleteEventPreference, saveDefaultPreferences, saveEventRegistrationOverride, saveRegistrationSettings } from '@/app/preference-actions'
import { AdminSectionCard } from '@/components/admin-section-card'
import { signOut } from '@/app/session-actions'
import { HelpModal } from '@/components/help-modal'
import type { EventDemandCounts } from '@/lib/member-demand'
import { createClient as createBrowserClient } from '@/lib/supabase/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'

interface Profile {
  id: string
  display_name: string | null
  is_admin?: boolean | null
  is_system_admin?: boolean | null
  registrations_paused?: boolean | null
  membership_revoked?: boolean | null
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
  skip_registration?: boolean | null
}

interface PreferenceFormProps {
  user: User
  profile: Profile | null
  events: Event[]
  defaultPrefs: DefaultPrefs | null
  eventPrefs: EventPref[]
  eventDemandCounts: EventDemandCounts
}

type EditorState =
  | { type: 'defaults' }
  | { type: 'event'; eventId: string }
  | null

type EventOverrideState = {
  times: string[]
  skipRegistration: boolean
}

function buildInitialEventOverrides(eventPrefs: EventPref[]): Record<string, EventOverrideState> {
  const overrides: Record<string, EventOverrideState> = {}
  for (const eventPref of eventPrefs) {
    overrides[eventPref.event_id] = {
      times: eventPref.tee_time_preferences,
      skipRegistration: eventPref.skip_registration === true,
    }
  }
  return overrides
}

function getEffectiveTimes(
  defaultTimes: string[],
  override: EventOverrideState | undefined,
): string[] {
  if (!override) {
    return defaultTimes
  }

  return override.skipRegistration ? [] : override.times
}

function sameTimes(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((time, index) => time === right[index])
}

function getAdjustedDemandCounts({
  baseCounts,
  events,
  initialDefaultTimes,
  initialEventOverrides,
  defaultTimes,
  eventOverrides,
}: {
  baseCounts: EventDemandCounts
  events: Event[]
  initialDefaultTimes: string[]
  initialEventOverrides: Record<string, EventOverrideState>
  defaultTimes: string[]
  eventOverrides: Record<string, EventOverrideState>
}): EventDemandCounts {
  const adjustedCounts: EventDemandCounts = { ...baseCounts }

  for (const event of events) {
    const initialOverride = initialEventOverrides[event.id]
    const currentOverride = eventOverrides[event.id]
    const initialTimes = getEffectiveTimes(initialDefaultTimes, initialOverride).slice(0, 3)
    const currentTimes = getEffectiveTimes(defaultTimes, currentOverride).slice(0, 3)

    if (
      initialOverride?.skipRegistration === currentOverride?.skipRegistration &&
      sameTimes(initialTimes, currentTimes)
    ) {
      continue
    }

    const availableSlots = new Set(event.event_time_slots.map((slot) => slot.time_slot))
    const nextCounts = { ...(baseCounts[event.id] || {}) }

    for (const time of initialTimes) {
      if (!availableSlots.has(time)) continue
      nextCounts[time] = Math.max(0, (nextCounts[time] || 0) - 1)
    }

    for (const time of currentTimes) {
      if (!availableSlots.has(time)) continue
      nextCounts[time] = (nextCounts[time] || 0) + 1
    }

    adjustedCounts[event.id] = nextCounts
  }

  return adjustedCounts
}

function formatDate(dateStr: string) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${dateStr}T00:00:00Z`))
}

function DemandCountInline({
  count,
  muted = false,
}: {
  count: number
  muted?: boolean
}) {
  return (
    <span
      className={`ml-1 inline-flex w-[1.75rem] justify-end tabular-nums ${muted ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}
      aria-hidden={count <= 0}
    >
      {count > 0 ? `· ${count}` : '\u00a0'}
    </span>
  )
}

const preferenceBadgeClassName =
  'border-emerald-700 bg-emerald-600 text-white hover:bg-emerald-600'

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
                className={`flex items-center gap-1 rounded-full border border-emerald-700 bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white ${draggedIndex === index ? 'opacity-50' : ''}`}
              >
                <GripVertical className="h-3 w-3 opacity-60" />
                <span className="mr-1 font-bold">#{index + 1}</span>
                <span>{time}</span>
                <DemandCountInline count={demandCounts?.[time] || 0} muted />
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
                <DemandCountInline count={demandCounts?.[time] || 0} />
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
  const initialDefaultTimes = defaultPrefs?.tee_time_preferences || []
  const initialEventOverrides = buildInitialEventOverrides(eventPrefs)
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

  const [baseDemandCounts, setBaseDemandCounts] = useState<EventDemandCounts>(eventDemandCounts)
  const [baselineDefaultTimes, setBaselineDefaultTimes] = useState<string[]>(initialDefaultTimes)
  const [baselineEventOverrides, setBaselineEventOverrides] = useState<Record<string, EventOverrideState>>(
    initialEventOverrides,
  )
  const [defaultTimes, setDefaultTimes] = useState<string[]>(initialDefaultTimes)
  const [eventOverrides, setEventOverrides] = useState<Record<string, EventOverrideState>>(() => initialEventOverrides)
  const [editor, setEditor] = useState<EditorState>(null)
  const [draftTimes, setDraftTimes] = useState<string[]>([])
  const [savingEditor, setSavingEditor] = useState(false)
  const [showChangedOnly, setShowChangedOnly] = useState(false)
  const [savingEventId, setSavingEventId] = useState<string | null>(null)
  const [registrationsPaused, setRegistrationsPaused] = useState(profile?.registrations_paused === true)
  const [membershipRevoked, setMembershipRevoked] = useState(profile?.membership_revoked === true)
  const [savingRegistrationSettings, setSavingRegistrationSettings] = useState(false)
  const [confirmingRevoke, setConfirmingRevoke] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    const nextInitialDefaultTimes = defaultPrefs?.tee_time_preferences || []
    const nextInitialEventOverrides = buildInitialEventOverrides(eventPrefs)
    setBaseDemandCounts(eventDemandCounts)
    setBaselineDefaultTimes(nextInitialDefaultTimes)
    setBaselineEventOverrides(nextInitialEventOverrides)
  }, [defaultPrefs, eventPrefs, eventDemandCounts])

  const refreshDemandCounts = useEffectEvent(async () => {
    if (events.length === 0) {
      setBaseDemandCounts({})
      setBaselineDefaultTimes(defaultTimes)
      setBaselineEventOverrides(eventOverrides)
      return
    }

    const eventIds = events.map((event) => event.id).join(',')
    const response = await fetch(`/api/member-demand?eventIds=${encodeURIComponent(eventIds)}`, {
      cache: 'no-store',
    })

    if (!response.ok) {
      throw new Error('Unable to load demand counts')
    }

    const payload = await response.json() as { eventDemandCounts?: EventDemandCounts }
    setBaseDemandCounts(payload.eventDemandCounts || {})
    setBaselineDefaultTimes(defaultTimes)
    setBaselineEventOverrides(eventOverrides)
  })

  useEffect(() => {
    if (!mounted) return

    const supabase = createBrowserClient()
    let refreshTimer: ReturnType<typeof setTimeout> | null = null

    const scheduleRefresh = () => {
      if (refreshTimer) {
        clearTimeout(refreshTimer)
      }

      refreshTimer = setTimeout(() => {
        void refreshDemandCounts().catch((error) => {
          console.error(error)
        })
      }, 150)
    }

    const channel = supabase
      .channel(`member-demand:${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'default_preferences' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_preferences' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'members' }, scheduleRefresh)
      .subscribe()

    return () => {
      if (refreshTimer) {
        clearTimeout(refreshTimer)
      }
      void supabase.removeChannel(channel)
    }
  }, [mounted, user.id, events, refreshDemandCounts])

  if (!mounted) {
    return null
  }

  const demandCounts = getAdjustedDemandCounts({
    baseCounts: baseDemandCounts,
    events,
    initialDefaultTimes: baselineDefaultTimes,
    initialEventOverrides: baselineEventOverrides,
    defaultTimes,
    eventOverrides,
  })

  const getEventPreferences = (eventId: string): EventOverrideState => eventOverrides[eventId] || { times: defaultTimes, skipRegistration: false }
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
      ? demandCounts[editor.eventId] || {}
      : demandCounts[events[0]?.id || ''] || {}

  const openDefaultsEditor = () => {
    setDraftTimes(defaultTimes)
    setEditor({ type: 'defaults' })
  }

  const openEventEditor = (eventId: string) => {
    const preferences = getEventPreferences(eventId)
    setDraftTimes(preferences.times)
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
        await saveEventRegistrationOverride(editor.eventId, draftTimes, false)
        setEventOverrides((current) => ({
          ...current,
          [editor.eventId]: { times: draftTimes, skipRegistration: false },
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

  const handleToggleRegistrationPause = async (nextPaused: boolean) => {
    setRegistrationsPaused(nextPaused)
    setSavingRegistrationSettings(true)
    try {
      await saveRegistrationSettings(nextPaused, membershipRevoked)
    } finally {
      setSavingRegistrationSettings(false)
    }
  }

  const handleConfirmRevoke = async () => {
    setMembershipRevoked(true)
    setRegistrationsPaused(true)
    setSavingRegistrationSettings(true)
    try {
      await saveRegistrationSettings(true, true)
      await signOut()
      router.push('/stay-tuned')
      router.refresh()
    } finally {
      setSavingRegistrationSettings(false)
      setConfirmingRevoke(false)
    }
  }

  const handleToggleEventSkip = async (eventId: string, nextSkipRegistration: boolean) => {
    const currentPreferences = getEventPreferences(eventId)

    setSavingEventId(eventId)
    try {
      await saveEventRegistrationOverride(
        eventId,
        nextSkipRegistration ? [] : currentPreferences.times,
        nextSkipRegistration,
      )
      setEventOverrides((current) => ({
        ...current,
        [eventId]: {
          times: nextSkipRegistration ? [] : currentPreferences.times,
          skipRegistration: nextSkipRegistration,
        },
      }))
    } finally {
      setSavingEventId(null)
    }
  }

  return (
    <main className="min-h-screen">
      <div className="sticky top-0 z-30 bg-foreground text-background">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="order-1 text-left">
            <p className="font-display text-2xl leading-none">Good to Go</p>
          </div>
          <div className="order-2 flex flex-wrap items-center gap-2 sm:justify-end">
            <span className="mr-auto text-xs text-background/70 sm:mr-0 sm:order-2">
              {profile?.display_name || user.email}
            </span>
            <div className="flex flex-wrap items-center gap-2 sm:order-3">
              <HelpModal mode="member" />
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
        <AdminSectionCard
          title={`Preferred tee times${registrationsPaused ? ' (Weekly registration paused)' : ''}`}
        >
            <div className="space-y-4">
              <label className="flex items-start gap-3 rounded-md">
                <input
                  type="checkbox"
                  checked={registrationsPaused}
                  onChange={(event) => {
                    void handleToggleRegistrationPause(event.target.checked || membershipRevoked)
                  }}
                  disabled={membershipRevoked}
                  className="mt-1 h-4 w-4 rounded border-border text-primary focus:ring-ring"
                />
                <div>
                  <p className="text-sm font-medium">Pause registrations indefinitely</p>
                  <p className="text-sm text-muted-foreground">Stay in Good to Go, but do not register me until I turn this back on.</p>
                </div>
              </label>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                {defaultTimes.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {defaultTimes.map((time, index) => (
                      <Badge key={time} variant="outline" className={preferenceBadgeClassName}>
                        #{index + 1} {time}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No preferred tee times set.</p>
                )}

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
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full border-border bg-background text-foreground hover:bg-secondary sm:w-auto"
                      onClick={openDefaultsEditor}
                    >
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
              </div>

              <div className="flex flex-col gap-4 rounded-xl border border-border bg-background/70 p-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Revoke Good to Go membership entirely</p>
                  <p className="text-sm text-muted-foreground">Stop all future registrations and remove me from Good to Go planning.</p>
                </div>
                <Dialog open={confirmingRevoke} onOpenChange={setConfirmingRevoke}>
                  <DialogTrigger asChild>
                    <Button size="sm" variant="destructive" className="w-full shrink-0 sm:w-auto" disabled={savingRegistrationSettings || membershipRevoked}>
                      {membershipRevoked ? 'Membership revoked' : 'Revoke membership'}
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-lg overflow-hidden p-0 [&>button]:text-primary-foreground [&>button]:opacity-100">
                    <DialogHeader className="bg-primary px-6 py-5 text-left text-primary-foreground">
                      <DialogTitle className="text-primary-foreground">Revoke Good to Go membership?</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3 px-6 py-6 text-sm text-muted-foreground">
                      <p>Your Good to Go membership will be revoked immediately.</p>
                      <p>You will no longer be able to log in or use this site, and no future registrations will be attempted for you.</p>
                    </div>
                    <DialogFooter className="px-6 pb-6">
                      <Button variant="outline" onClick={() => setConfirmingRevoke(false)} disabled={savingRegistrationSettings}>
                        Cancel
                      </Button>
                      <Button variant="destructive" onClick={() => { void handleConfirmRevoke() }} disabled={savingRegistrationSettings}>
                        {savingRegistrationSettings ? 'Revoking...' : 'Yes, revoke membership'}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </div>
        </AdminSectionCard>

        <AdminSectionCard
          title="Individual event overrides"
          headerRight={<Badge variant="outline" className="border-white/30 bg-white/10 text-primary-foreground">{visibleEvents.length} events</Badge>}
        >
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
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{formatDate(event.event_date)}</p>
                          {hasOverride ? <Badge variant="secondary">Override</Badge> : null}
                          {prefs.skipRegistration ? <Badge variant="destructive">Don&apos;t register</Badge> : null}
                        </div>
                        <p className="text-sm text-muted-foreground">{event.course_name}</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {prefs.skipRegistration ? (
                            <span className="text-sm text-muted-foreground">Not playing this week.</span>
                          ) : prefs.times.length > 0 ? (
                            prefs.times.map((time, index) => (
                              <Badge key={`${event.id}-${time}`} variant="outline" className={preferenceBadgeClassName}>
                                #{index + 1} {time}
                                <DemandCountInline count={demandCounts[event.id]?.[time] || 0} muted />
                              </Badge>
                            ))
                          ) : (
                            <span className="text-sm text-muted-foreground">No preferred tee times set. We will not register you for this week.</span>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                        <label className="inline-flex min-h-9 items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm">
                          <input
                            type="checkbox"
                            checked={prefs.skipRegistration}
                            disabled={savingEventId === event.id}
                            onChange={(eventChange) => {
                              void handleToggleEventSkip(event.id, eventChange.target.checked)
                            }}
                            className="h-4 w-4 rounded border-border text-primary focus:ring-ring"
                          />
                          <span>Can&apos;t play this week</span>
                        </label>
                        <Button variant="outline" size="sm" className="w-full border-border bg-background text-foreground hover:bg-secondary sm:w-auto" onClick={() => openEventEditor(event.id)}>
                          Update
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
              </div>
            </div>
        </AdminSectionCard>
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
