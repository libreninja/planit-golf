'use client'

import { Check, Dot } from 'lucide-react'
import { getPasswordRuleResults } from '@/lib/password-policy'

export function PasswordRequirements({ password }: { password: string }) {
  const rules = getPasswordRuleResults(password)

  return (
    <div className="rounded-lg border border-border/70 bg-muted/40 px-3 py-3">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
        Password requirements
      </p>
      <div className="mt-2 space-y-1.5">
        {rules.map((rule) => (
          <div
            key={rule.id}
            className={`flex items-center gap-2 text-sm ${
              rule.passed ? 'text-foreground' : 'text-muted-foreground'
            }`}
          >
            {rule.passed ? (
              <Check className="h-4 w-4 text-primary" />
            ) : (
              <Dot className="h-4 w-4 text-muted-foreground" />
            )}
            <span>{rule.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
