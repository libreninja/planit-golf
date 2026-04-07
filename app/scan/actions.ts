'use server'

import { headers } from 'next/headers'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import {
  finishPaceTimingRun,
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

export async function finishPaceScan(token: string) {
  const checkpoint = await getCheckpointByToken(token)
  const cookieStore = await cookies()
  const finishToken = cookieStore.get(paceRunCookieName)?.value

  if (!checkpoint || !finishToken) {
    redirect(`/scan/${token}?status=invalid`)
  }

  const timingRun = await finishPaceTimingRun({
    checkpoint,
    finishToken,
  })

  if (!timingRun) {
    redirect(`/scan/${token}?status=invalid-finish`)
  }

  cookieStore.delete(paceRunCookieName)
  redirect(`/scan/${token}?status=finished`)
}
