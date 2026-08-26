'use client'

// The shared authenticated application shell: a persistent left rail (global +
// context navigation), a top bar (location/breadcrumb + account actions +
// the activity inbox), and a mobile drawer. There is intentionally no context
// switcher in the top bar (the rail owns context) and no global help
// affordance — contextual help stays co-located with the surface that needs
// it. The activity inbox is Seattle Cup scouting activity only in V1, shown for
// users with the scouting entitlement (ActivityInbox).
//
// The shell is CAPABILITY-AWARE, not authenticated-only. An anonymous visitor
// on a CONTEXTUAL public route (/igc/mens-league, /igc/womens-league, …) sees
// the same application frame as a signed-in member — branding, public
// navigation, breadcrumb, and Sign in / Create account CTAs. The public
// Standings experience is identical for anonymous and authenticated viewers;
// only the chrome and access to private capabilities differ. The anonymous
// ROOT (/) is the one exception: it keeps its own simple landing (no app
// frame, no league nav) because a cold visitor has no league context yet.
// Private destinations never appear for an anonymous viewer: Tee Times gates
// on gtgAccess and Scouting gates on the scouting capability (both false for
// ANON), and admin is not a nav destination at all. The private routes
// themselves enforce their own server-side access guards, so a direct deep link
// redirects before any page body renders. The shell also hides itself on
// auth/invite/scan/event-browse routes, which keep their own page chrome.

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { Menu, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { signOut } from '@/app/session-actions'
import { ActivityInbox } from '@/components/app-shell/activity-inbox'
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

// Exported so the root loading boundary (app/loading.tsx) can hide itself on
// the same auth/hidden routes the shell hides itself on, without duplicating
// the prefix list.
export function isShellVisible(pathname: string): boolean {
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
    { type: 'link', label: 'Club Championship', href: '/igc/club-championship', level: 2 },
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
    items.push({ type: 'link', label: 'Opposition Intel', href: '/igc/seattle-cup/intel', level: 2 })
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

// Conventional sidebar menuing. Destinations are rectangular rows (modest
// corner radius), full sidebar width, with restrained vertical rhythm. The
// active row is marked by a subtle background PLUS a thin left-edge accent bar
// — it reads as a selected menu row, not a floating pill/capsule. Hover is a
// quiet row-level background, subordinate to active. A pending navigation is
// acknowledged immediately on click with a small leading pulsing dot, distinct
// from both hover and the completed active state; it settles to active once the
// route lands (pathname updates). Keyboard focus uses an inset ring (not
// background alone). Section headings are non-clickable labels grouped above
// their children with a hairline separator.
function NavList({ user, pathname, onNavigate }: { user: AppShellUser; pathname: string; onNavigate?: () => void }) {
  const items = buildNav(user)
  const activeHref = computeActiveHref(pathname, items)
  // The href of the destination most recently clicked, while its navigation is
  // still in flight. Set immediately on click (instant acknowledgement) and
  // cleared when the route lands (pathname changes). Adjusted during render
  // (vs. in an effect) to avoid a cascading re-render — same pattern HcpText
  // uses for its bound re-sync — and it also clears correctly on browser
  // back/forward, where a pathname change happens without a click.
  const [pendingHref, setPendingHref] = useState<string | null>(null)
  const [prevPath, setPrevPath] = useState(pathname)
  if (pathname !== prevPath) {
    setPrevPath(pathname)
    setPendingHref(null)
  }

  return (
    <nav className="flex flex-col gap-0.5" aria-label="Primary">
      {items.map((item, i) => {
        if (item.type === 'label') {
          // Section heading: a non-clickable label, separated from the group
          // above by a hairline. Headings are flush-left; their destination
          // children are indented beneath them.
          return (
            <p
              key={`label-${i}`}
              className="border-t border-border px-3 pt-5 pb-1 pl-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80"
            >
              {item.label}
            </p>
          )
        }
        const active = item.href === activeHref
        const pending = !active && pendingHref === item.href
        const pad = item.level === 2 ? 'pl-9' : 'pl-3'
        return (
          <Link
            key={item.href}
            href={item.href}
            // Acknowledge the click immediately: mark this row pending before
            // letting Next.js start the navigation. Skip for modifier-clicks
            // (open in new tab, etc.) and for the already-active destination.
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
              if (item.href !== activeHref) setPendingHref(item.href)
              onNavigate?.()
            }}
            aria-current={active ? 'page' : undefined}
            aria-busy={pending || undefined}
            className={
              'relative block rounded pr-3 py-2 text-sm transition-colors ' +
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ' +
              pad +
              (active
                ? ' bg-accent font-medium text-accent-foreground'
                : pending
                  ? ' bg-foreground/[0.06] text-foreground/80'
                  : ' text-muted-foreground hover:bg-muted/70 hover:text-foreground')
            }
          >
            {/* Left-edge accent: a thin bar for the active row, a small pulsing
                dot for a pending row. Both sit in the row's left gutter so they
                never displace the label. */}
            {active ? (
              <span aria-hidden className="absolute inset-y-1 left-0 w-[3px] rounded-full bg-foreground" />
            ) : pending ? (
              <span aria-hidden className="absolute inset-y-0 left-0 flex items-center pl-1.5">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-foreground/70" />
              </span>
            ) : null}
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
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
  if (pathname === '/igc/club-championship')
    return [{ label: 'Interbay', href: '/igc' }, { label: "Men's League", href: '/igc/mens-league' }, { label: 'Club Championship' }]
  if (pathname === '/igc/womens-league')
    return [{ label: 'Interbay', href: '/igc' }, { label: "Women's League" }, { label: 'Standings' }]
  if (pathname === '/igc/seattle-cup/scouting')
    return [{ label: 'Interbay', href: '/igc' }, { label: 'Seattle Cup' }, { label: 'Scouting' }]
  if (pathname === '/igc/seattle-cup/intel')
    return [{ label: 'Interbay', href: '/igc' }, { label: 'Seattle Cup' }, { label: 'Opposition Intel' }]
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

// Compact current-context label for the mobile second header row. Drops the
// leading club crumb (already implied by the rail) and joins the rest with " · ",
// e.g. [Interbay, Seattle Cup, Scouting] -> "Seattle Cup · Scouting". This is a
// presentation-only reduction of the desktop breadcrumb; it is not navigation
// (no links) so existing nav behavior is unchanged.
function compactContext(crumbs: Crumb[]): string {
  if (crumbs.length === 0) return ''
  if (crumbs.length === 1) return crumbs[0].label
  return crumbs.slice(1).map((c) => c.label).join(' · ')
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

  // The shell renders for every shell-visible route, anonymous or not. An
  // anonymous viewer on a CONTEXTUAL public route (/igc/mens-league, …) gets
  // the public frame (branding + league nav + Sign in / Create account CTAs);
  // a signed-in viewer gets the full frame with account controls and any
  // private nav their capabilities unlock. Auth/invite/scan/event-browse routes
  // keep their own page chrome via isShellVisible.
  if (!isShellVisible(pathname)) {
    return <>{children}</>
  }

  const anon = !user.signedIn
  // Anonymous `/` is a no-context landing, not an app frame: a visitor who
  // arrives at the root knows nothing about the leagues in the rail, so
  // rendering the sidebar/nav here reads as an empty authenticated app. The
  // root keeps its own simple landing page (SignInPrompt) with one coherent
  // auth area. Authenticated `/` is the dashboard and keeps the shell, so
  // this exception is anonymous-only. Contextual public routes still get the
  // shell above — this only short-circuits the anonymous root.
  if (anon && pathname === '/') {
    return <>{children}</>
  }
  // Return-path sign-in: /login?next=<current> → /auth/callback?next=<current>
  // → back to the public page the visitor was viewing. The auth callback and
  // the login page both honor `next`, so a sign-in from the standings returns
  // to the standings rather than dumping the viewer on Home.
  const signInHref = `/login?next=${encodeURIComponent(pathname)}`
  const crumbs = buildBreadcrumb(pathname)

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop rail */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-border bg-card md:flex">
        <div className="px-4 py-4">
          <Brand />
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-4">
          <NavList user={user} pathname={pathname} />
        </div>
        {/* No auth CTAs in the desktop rail — the top-right header carries the
            single desktop auth area for anonymous viewers. The mobile drawer
            carries the single mobile auth area. Avoids duplicate CTAs. */}
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
              <NavList user={user} pathname={pathname} onNavigate={() => setDrawerOpen(false)} />
            </div>
            {anon ? (
              <div className="space-y-2 border-t border-border px-3 py-3">
                <Button asChild size="sm" className="w-full">
                  <Link href={signInHref} onClick={() => setDrawerOpen(false)}>
                    Sign in
                  </Link>
                </Button>
                <Button asChild size="sm" variant="outline" className="w-full">
                  <Link href="/signup" onClick={() => setDrawerOpen(false)}>
                    Create account
                  </Link>
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Main column */}
      <div className="md:pl-60">
        {/* Sticky header block: a clean primary row (hamburger / brand / avatar)
            that stays stable at phone widths, plus a mobile-only compact context
            row beneath it. The full desktop breadcrumb is preserved at md+ where
            it fits naturally; on mobile only the useful current context is shown. */}
        <div className="sticky top-0 z-20 border-b border-border bg-card/95 backdrop-blur">
          <header className="flex h-14 items-center justify-between gap-3 px-4">
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
              {user.signedIn && user.scouting && user.userId ? (
                <ActivityInbox userId={user.userId} />
              ) : null}
              {user.signedIn ? (
                <AccountMenu user={user} />
              ) : (
                <>
                  {/* Anonymous desktop auth area (single, top-right). Hidden on
                      mobile (<md), where the drawer carries the single auth area
                      instead — no duplicate CTAs across surfaces. Create account
                      is invite-gated (/signup); Sign in returns via `next`. */}
                  <Button asChild size="sm" variant="ghost" className="hidden md:inline-flex">
                    <Link href="/signup">Create account</Link>
                  </Button>
                  <Button asChild size="sm" className="hidden md:inline-flex">
                    <Link href={signInHref}>Sign in</Link>
                  </Button>
                </>
              )}
            </div>
          </header>
          {/* Mobile-only compact context row. No links — presentation only. */}
          {crumbs.length > 0 ? (
            <div className="flex items-center px-4 pb-2 md:hidden">
              <span className="text-xs font-medium text-foreground/80">{compactContext(crumbs)}</span>
            </div>
          ) : null}
        </div>

        <main className="mx-auto w-full max-w-5xl px-4 pb-10 pt-8">{children}</main>
      </div>
    </div>
  )
}