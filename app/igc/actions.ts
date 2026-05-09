'use server'

import { revalidatePath } from 'next/cache'

import { requireAdmin } from '@/lib/auth'
import { syncGolfGeniusEvent } from '@/lib/igc/golfgenius-sync'

export async function syncIgcEventFromGolfGenius(formData: FormData) {
  await requireAdmin()

  const eventSlug = String(formData.get('eventSlug') || '').trim()
  if (!eventSlug) {
    throw new Error('Event slug is required')
  }

  await syncGolfGeniusEvent(eventSlug)

  revalidatePath('/igc')
  revalidatePath('/igc/events')
  revalidatePath(`/igc/events/${eventSlug}`)

  return
}
