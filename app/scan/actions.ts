'use server'

import { headers } from 'next/headers'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import {
  getActivePaceEvent,
  getCheckpointByToken,
  startPaceTimingRun,
} from '@/lib/public-pace'

function normalizeGgid(value: FormDataEntryValue | null) {
  if (typeof value !== 'string') return ''
  return value.trim().toUpperCase().replace(/\s+/g, '')
}

const paceRunCookieName = 'public_pace_run'

export async function confirmPaceScan(token: string, formData: FormData) {
  const groupGgid = normalizeGgid(formData.get('groupGgid'))
  const checkpoint = await getCheckpointByToken(token)

  if (!checkpoint || !groupGgid) {
    redirect(`/scan/${token}?status=invalid`)
  }

  const event = await getActivePaceEvent(checkpoint)
  if (!event) {
    redirect(`/scan/${token}?status=no-event`)
  }

  const headerStore = await headers()
  const timingRun = await startPaceTimingRun({
    checkpoint,
    event,
    groupGgid,
    userAgent: headerStore.get('user-agent'),
  })

  if (!timingRun?.continuation_token) {
    redirect(`/scan/${token}?status=invalid`)
  }

  const cookieStore = await cookies()
  cookieStore.set(paceRunCookieName, timingRun.continuation_token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/scan',
    maxAge: 60 * 60 * 6,
  })

  redirect(`/scan/${token}?status=started`)
}
