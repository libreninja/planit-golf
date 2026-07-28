'use client'

// Single-form availability editor (item 6). The four Seattle Cup sessions are
// fields of one availability record, not four independently saved forms. One
// "Save availability" button saves every changed session in a single submit.
// It is disabled when the form matches persisted state, enabled on any change,
// and returns to disabled after a successful save.
//
// Unset/unknown is a real, distinct option ("Not asked yet") — the domain has no
// "unknown" status, so unset is the absence of a row. Selecting "Not asked yet"
// for a session that previously had a status clears that session's row on save.

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { setAvailabilityBatchAction } from '../../actions'

const AVAIL_OPTIONS: { value: string; label: string }[] = [
  { value: 'fully_available', label: 'Fully available' },
  { value: 'partially_available', label: 'Partially available' },
  { value: 'unavailable', label: 'Unavailable' },
  { value: 'response_pending', label: 'Response pending' },
  { value: 'no_response', label: 'No response' },
]

interface SessionField {
  sessionId: string
  format: string | null
  date: string | null
  course: string | null
}

export function AvailabilityEditor({
  playerId,
  playerName,
  sessions,
  persisted,
}: {
  playerId: string
  playerName: string
  sessions: SessionField[]
  persisted: Record<string, string | null>
}) {
  // '' represents unset/unknown (no availability row). persisted null -> ''.
  const initial: Record<string, string> = {}
  for (const s of sessions) initial[s.sessionId] = persisted[s.sessionId] ?? ''

  const [values, setValues] = useState<Record<string, string>>(initial)
  const [saved, setSaved] = useState<Record<string, string>>(initial)
  const [pending, startTransition] = useTransition()

  const dirty = sessions.some((s) => values[s.sessionId] !== saved[s.sessionId])

  function onChange(sid: string, v: string) {
    setValues((prev) => ({ ...prev, [sid]: v }))
  }

  function onSave(e: React.FormEvent) {
    e.preventDefault()
    const changes = sessions
      .filter((s) => values[s.sessionId] !== saved[s.sessionId])
      .map((s) => ({ sessionId: s.sessionId, status: values[s.sessionId] }))
    if (changes.length === 0) return
    // Display hints for the activity line: the player name + a sessionId -> label
    // map (the session format, e.g. "Fourball"). Denormalized into activity
    // metadata by the action; not authoritative domain data.
    const sessionLabels: Record<string, string> = {}
    for (const s of sessions) sessionLabels[s.sessionId] = s.format ?? 'Session'
    startTransition(async () => {
      await setAvailabilityBatchAction(playerId, changes, playerName, sessionLabels)
      setSaved({ ...values })
    })
  }

  return (
    <form onSubmit={onSave} className="space-y-2">
      {sessions.map((s) => (
        <div key={s.sessionId} className="flex flex-wrap items-center gap-3">
          <div className="min-w-[220px]">
            <div className="text-sm">
              {s.format ?? 'Session'} <span className="text-xs text-muted-foreground">{s.date ?? ''}</span>
            </div>
            <div className="text-xs text-muted-foreground">{s.course ?? ''}</div>
          </div>
          <select
            value={values[s.sessionId]}
            onChange={(e) => onChange(s.sessionId, e.target.value)}
            className="rounded-md border border-border px-2 py-1 text-sm"
          >
            <option value="">Not asked yet</option>
            {AVAIL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      ))}
      <div className="pt-1">
        <Button type="submit" size="sm" disabled={!dirty || pending}>
          {pending ? 'Saving…' : 'Save availability'}
        </Button>
      </div>
    </form>
  )
}