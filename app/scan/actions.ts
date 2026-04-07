'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import {
  fetchLiveFoursomes,
  getActivePaceEvent,
  getCheckpointByToken,
  recordPaceScan,
} from '@/lib/public-pace'

export async function confirmPaceScan(token: string, formData: FormData) {
  const foursomeKey = String(formData.get('foursomeKey') || '')
  const checkpoint = await getCheckpointByToken(token)

  if (!checkpoint || !foursomeKey) {
    redirect(`/scan/${token}?status=invalid`)
  }

  const event = await getActivePaceEvent(checkpoint)
  if (!event) {
    redirect(`/scan/${token}?status=no-event`)
  }

  let foursomes
  try {
    foursomes = await fetchLiveFoursomes(event, checkpoint)
  } catch {
    redirect(`/scan/${token}?status=lookup-error`)
  }
  const foursome = foursomes.find((candidate) => candidate.key === foursomeKey)

  if (!foursome) {
    redirect(`/scan/${token}?status=stale`)
  }

  const headerStore = await headers()
  await recordPaceScan({
    checkpoint,
    event,
    foursome,
    userAgent: headerStore.get('user-agent'),
  })

  redirect(`/scan/${token}?status=recorded`)
}
