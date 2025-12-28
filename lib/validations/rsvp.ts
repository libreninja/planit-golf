import { z } from 'zod'

export const rsvpSchema = z.object({
  status: z.enum(['yes', 'no', 'maybe']),
  arrival_at: z.string().nullable().optional(),
  departure_at: z.string().nullable().optional(),
  walking_pref: z.enum(['walk', 'ride', 'either']).nullable().optional(),
  notes: z.string().nullable().optional(),
})

export type RSVPFormData = z.infer<typeof rsvpSchema>

