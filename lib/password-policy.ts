export const PASSWORD_MIN_LENGTH = 10

export const PASSWORD_RULES = [
  {
    id: 'length',
    label: `At least ${PASSWORD_MIN_LENGTH} characters`,
    test: (password: string) => password.length >= PASSWORD_MIN_LENGTH,
  },
  {
    id: 'lowercase',
    label: 'One lowercase letter',
    test: (password: string) => /[a-z]/.test(password),
  },
  {
    id: 'uppercase',
    label: 'One uppercase letter',
    test: (password: string) => /[A-Z]/.test(password),
  },
  {
    id: 'number',
    label: 'One number',
    test: (password: string) => /\d/.test(password),
  },
] as const

export function getPasswordRuleResults(password: string) {
  return PASSWORD_RULES.map((rule) => ({
    ...rule,
    passed: rule.test(password),
  }))
}

export function isPasswordValid(password: string) {
  return getPasswordRuleResults(password).every((rule) => rule.passed)
}

export function getPasswordValidationMessage(password: string) {
  const failedRule = getPasswordRuleResults(password).find((rule) => !rule.passed)
  return failedRule ? `Password must include ${failedRule.label.toLowerCase()}.` : null
}
