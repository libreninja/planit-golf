import { z } from 'zod'

export const paymentSchema = z.object({
  amount_cents: z.number().int().positive(),
  method: z.enum(['venmo', 'zelle', 'cashapp', 'other']),
  identifier: z.string().nullable().optional(),
  memo: z.string().nullable().optional(),
})

export type PaymentFormData = z.infer<typeof paymentSchema>

