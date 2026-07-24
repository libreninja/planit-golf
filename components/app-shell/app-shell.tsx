'use client'

// The shared authenticated application shell: a persistent left rail (global +
// context navigation), a top bar (location/breadcrumb + account actions),
// and a mobile drawer. There is intentionally no context switcher in the top
// bar (the rail owns context), no notification bell, and no global help affordance
// — contextual help stays co-located with the surface that needs it.
//
// The shell is AUTHENTICATED-ONLY. It must not render until authentication has
// resolved to a real signed-in viewer — an anonymous visitor on / sees a
// deliberately minimal public landing (no rail, no top bar, no breadcrumb, no
// account controls), not an empty app frame. It also hides itself on
// auth/invite/public/event-browse routes, which keep their own page chrome.

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { Menu, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { signOut } from '@/app/session-actions'
import type { AppShellUser } from '@/lib/app-shell/user'

// Routes that do NOT get the shell. Matched by exact path or path-prefix.
const HIDDEN_PREFIXES = [
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/invite/',
  '/scouting-invite/',
  '/stay-tuned',
  '/auth/',
  '/scan/',
  '/clubs',
  '/events',
  '/igc/events',
  '/leaderboard',
]

function isShellVisible(pathname: string): boolean {
  return !HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/') || (p.endsWith('/') ? false : pathname.startsWith(p)))
}

type NavLink = { type: 'link'; label: string; href: string; level: number }
type NavLabel = { type: 'label'; label: string; level: number }
type NavItem = NavLink | NavLabel

// Navigation mirrors the actual domain model, in user/domain language:
//
//   Home
//   Interbay Golf Club
//   MEN'S LEAGUE
//     Standings
//     Tee Times                    (users with the Men's League tee-time capability)
//   WOMEN'S LEAGUE
//     Standings
//   SEATTLE CUP
//     Scouting                     (entitled scouts)
//
// Men's League and Women's League are peer domain entities — neither is the
// default, there is no Men's/Women's toggle, and each has its own direct route.
// The recurring play day (Tuesday/Wednesday) is a schedule property of each
// league, not its identity, so it does not appear in the navigation taxonomy.
//
// Registration admin and Scouting Access are NOT sidebar destinations: admin
// functionality lives inside the workflow it administers (Men's League → Tee
// Times shows the registration admin controls for admins; Scouting shows a
// "Manage access" action for admins). The /admin and /admin/scouting routes
// remain reachable directly and keep their own authorization boundaries.
function buildNav(user: AppShellUser): NavItem[] {
  const items: NavItem[] = [
    { type: 'link', label: 'Home', href: '/', level: 0 },
    { type: 'link', label: 'Interbay Golf Club', href: '/igc', level: 0 },
    { type: 'label', label: "Men's League", level: 1 },
    { type: 'link', label: 'Standings', href: '/igc/mens-league', level: 2 },
  ]
  // Tee Times is currently a Men's League capability only. Gated by the same
  // gtgAccess flag the Tee Times page enforces, so it only appears for users
  // who can actually use the workflow. The architecture allows a future
  // Women's League tee-times capability to appear under Women's League without
  // restructuring — it is not hardcoded as Men's-only at the framework level.
  if (user.gtgAccess) {
    items.push({ type: 'link', label: 'Tee Times', href: '/igc/mens-league/tee-times', level: 2 })
  }
  items.push({ type: 'label', label: "Women's League", level: 1 })
  items.push({ type: 'link', label: 'Standings', href: '/igc/womens-league', level: 2 })
  if (user.scouting) {
    items.push({ type: 'label', label: 'Seattle Cup', level: 1 })
    items.push({ type: 'link', label: 'Scouting', href: '/igc/seattle-cup/scouting', level: 2 })
  }
  return items
}

// Exactly ONE destination may be active at a time. Parents are never given the
// active style — hierarchy is conveyed only by indentation/typography. The
// active item is the single link whose href is the longest prefix of the
// current pathname (exact match, or pathname starts with href + '/'), so a
// nested route highlights its own leaf, not its ancestors.
function computeActiveHref(pathname: string, items: NavItem[]): string | null {
  let best: string | null = null
  for (const item of items) {
    if (item.type !== 'link') continue
    const matches =
      pathname === item.href ||
      (item.href !== '/' && pathname.startsWith(item.href + '/'))
    if (matches && (best === null || item.href.length > best.length)) {
      best = item.href
    }
  }
  return best
}

type Crumb = { label: string; href?: string }

function buildBreadcrumb(pathname: string): Crumb[] {
  if (pathname === '/') return [{ label: 'Home' }]
  if (pathname === '/igc') return [{ label: 'Interbay Golf Club' }]
  if (pathname === '/igc/league')
    return [{ label: 'Interbay', href: '/igc' }, { label: 'Leagues' }]
  if (pathname === '/igc/mens-league')
    return [{ label: 'Interbay', href: '/igc' }, { label: "Men's League" }, { label: 'Standings' }]
  if (pathname === '/igc/mens-league/tee-times')
    return [{ label: 'Interbay', href: '/igc' }, { label: "Men's League", href: '/igc/mens-league' }, { label: 'Tee Times' }]
  if (pathname === '/igc/womens-league')
    return [{ label: 'Interbay', href: '/igc' }, { label: "Women's League" }, { label: 'Standings' }]
  if (pathname === '/igc/seattle-cup/scouting')
    return [{ label: 'Interbay', href: '/igc' }, { label: 'Seattle Cup' }, { label: 'Scouting' }]
  if (pathname.startsWith('/igc/seattle-cup/scouting/players'))
    return [
      { label: 'Interbay', href: '/igc' },
      { label: 'Seattle Cup', href: '/igc/seattle-cup/scouting' },
      { label: 'Scouting' },
    ]
  if (pathname === '/admin')
    return [{ label: 'Interbay', href: '/igc' }, { label: 'Registration admin' }]
  if (pathname === '/admin/scouting')
    return [{ label: 'Interbay', href: '/igc' }, { label: 'Seattle Cup' }, { label: 'Manage access' }]
  return []
}

function NavList({ user, pathname, onNavigate }: { user: AppShellUser; pathname: string; onNavigate?: () => void }) {
  const items = buildNav(user)
  const activeHref = computeActiveHref(pathname, items)
  return (
    <nav className="flex flex-col gap-0.5">
      {items.map((item, i) => {
        if (item.type === 'label') {
          return (
            <p
              key={`label-${i}`}
              className={
                'px-3 pt-5 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground ' +
                (item.level === 1 ? 'pl-6' : '')
              }
            >
              {item.label}
            </p>
          )
        }
        const active = item.href === activeHref
        const indent = item.level === 2 ? 'pl-9' : item.level === 1 ? 'pl-6' : ''
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={
              'block rounded-md px-3 py-2 text-sm transition-colors ' +
              indent +
              (active
                ? ' bg-accent font-medium text-foreground'
                : ' text-muted-foreground hover:bg-muted hover:text-foreground')
            }
            aria-current={active ? 'page' : undefined}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}

function Breadcrumb({ pathname }: { pathname: string }) {
  const crumbs = buildBreadcrumb(pathname)
  if (crumbs.length === 0) return null
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm">
      {crumbs.map((c, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <span className="text-muted-foreground/50">/</span>}
          {c.href ? (
            <Link href={c.href} className="text-muted-foreground hover:text-foreground">
              {c.label}
            </Link>
          ) : (
            <span className="font-medium text-foreground">{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  )
}

function AccountMenu({ user }: { user: AppShellUser }) {
  const [open, setOpen] = useState(false)
  const router = useRouter()
  const name = user.displayName?.trim() || user.email || 'Account'
  const initial = name.slice(0, 1).toUpperCase()

  const handleSignOut = async () => {
    await signOut()
    router.push('/login')
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-full border border-border bg-card px-2 py-1 text-sm hover:bg-muted"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
          {initial}
        </span>
        <span className="hidden max-w-[10rem] truncate sm:inline">{name}</span>
      </button>
      {open ? (
        <>
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            className="absolute right-0 top-full z-50 mt-1 w-60 rounded-md border border-border bg-card p-1 shadow-md"
          >
            <div className="border-b border-border px-3 py-2">
              <p className="truncate text-sm font-medium">{user.displayName ?? 'Account'}</p>
              <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            </div>
            <div className="py-1">
              <button
                type="button"
                role="menuitem"
                onClick={handleSignOut}
                className="block w-full rounded-sm px-3 py-2 text-left text-sm hover:bg-muted"
              >
                Sign out
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}

function Brand({ light = false }: { light?: boolean }) {
  return (
    <Link
      href="/"
      className={
        'font-display text-2xl leading-none ' +
        (light ? 'text-background' : 'text-foreground')
      }
    >
      planit.golf
    </Link>
  )
}

export function AppShell({ user, children }: { user: AppShellUser; children: React.ReactNode }) {
  const pathname = usePathname() || '/'
  const [drawerOpen, setDrawerOpen] = useState(false)

  // The shell is authenticated-only. An anonymous visitor never gets the app
  // frame — / renders its own minimal public landing. Public/invite/event-browse
  // routes are also hidden so they keep their own page chrome.
  if (!user.signedIn || !isShellVisible(pathname)) {
    return <>{children}</>
  }

  const crumbs = buildBreadcrumb(pathname)

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop rail */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-border bg-card md:flex">
        <div className="px-4 py-4">
          <Brand />
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {user.signedIn ? (
            <NavList user={user} pathname={pathname} />
          ) : (
            <div className="px-3 py-2 text-sm text-muted-foreground">
              <Button asChild size="sm" className="w-full">
                <Link href="/login">Sign in</Link>
              </Button>
            </div>
          )}
        </div>
      </aside>

      {/* Mobile drawer */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-foreground/40"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[80%] flex-col border-r border-border bg-card">
            <div className="flex items-center justify-between px-4 py-4">
              <Brand />
              <button
                type="button"
                aria-label="Close menu"
                className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                onClick={() => setDrawerOpen(false)}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-2 pb-4">
              {user.signedIn ? (
                <NavList user={user} pathname={pathname} onNavigate={() => setDrawerOpen(false)} />
              ) : (
                <div className="px-3 py-2">
                  <Button asChild size="sm" className="w-full">
                    <Link href="/login" onClick={() => setDrawerOpen(false)}>
                      Sign in
                    </Link>
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* Main column */}
      <div className="md:pl-60">
        {/* Top bar */}
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-border bg-card/95 px-4 backdrop-blur">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              aria-label="Open menu"
              className="rounded-md p-1 text-muted-foreground hover:bg-muted md:hidden"
              onClick={() => setDrawerOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </button>
            {/* On mobile the rail (and its brand) is hidden, so the top bar
                carries the brand here; on desktop the breadcrumb takes over. */}
            <span className="md:hidden">
              <Brand />
            </span>
            <span className="hidden md:block">
              <Breadcrumb pathname={pathname} />
            </span>
          </div>
          <div className="flex items-center gap-2">
            {crumbs.length > 0 ? (
              <span className="md:hidden">
                <Breadcrumb pathname={pathname} />
              </span>
            ) : null}
            {user.signedIn ? (
              <AccountMenu user={user} />
            ) : (
              <Button asChild size="sm" variant="outline">
                <Link href="/login">Sign in</Link>
              </Button>
            )}
          </div>
        </header>

        <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:py-8">{children}</main>
      </div>
    </div>
  )
}