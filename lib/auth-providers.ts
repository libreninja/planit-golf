export type OAuthProvider = 'google' | 'apple' | 'facebook'

const ALL_OAUTH_PROVIDERS: OAuthProvider[] = ['google', 'apple', 'facebook']

function parseConfiguredProviders(raw: string | undefined) {
  const configured = new Set(
    (raw || '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  )

  return ALL_OAUTH_PROVIDERS.filter((provider) => configured.has(provider))
}

export const ENABLED_OAUTH_PROVIDERS = parseConfiguredProviders(
  process.env.NEXT_PUBLIC_ENABLED_OAUTH_PROVIDERS,
)
