import type { AppShellUser } from './user.ts'

export type NavLink = { type: 'link'; label: string; href: string; level: number }
export type NavLabel = { type: 'label'; label: string; level: number }
export type NavItem = NavLink | NavLabel
export type Crumb = { label: string; href?: string }

export function buildNav(user: AppShellUser): NavItem[] {
  const items: NavItem[] = [{ type: 'link', label: 'Home', href: '/', level: 0 }]
  const contributorOnly = user.signedIn && user.harvest
    && !user.league && !user.gtgAccess && !user.scouting && !user.isAdmin

  // Preserve the existing public/member league navigation for every existing
  // persona. Only a brand-new contributor-only account gets the focused rail.
  if (!contributorOnly) {
    items.push({ type: 'link', label: 'Interbay Golf Club', href: '/igc', level: 0 })
    items.push({ type: 'label', label: "Men's League", level: 1 })
    items.push({ type: 'link', label: 'Standings', href: '/igc/mens-league', level: 2 })
    items.push({ type: 'link', label: 'Club Championship', href: '/igc/club-championship', level: 2 })
    if (user.gtgAccess) items.push({ type: 'link', label: 'Tee Times', href: '/igc/mens-league/tee-times', level: 2 })
    items.push({ type: 'label', label: "Women's League", level: 1 })
    items.push({ type: 'link', label: 'Standings', href: '/igc/womens-league', level: 2 })
  }

  if (user.harvest || user.scouting || user.harvestReview) {
    items.push({ type: 'label', label: 'Seattle Cup', level: 1 })
    if (user.harvest) items.push({ type: 'link', label: 'Share What You Learned', href: '/igc/seattle-cup/harvest/2026', level: 2 })
    if (user.harvestReview) items.push({ type: 'link', label: 'Review Reports', href: '/igc/seattle-cup/harvest/2026/review', level: 2 })
    if (user.scouting) {
      items.push({ type: 'link', label: 'Scouting', href: '/igc/seattle-cup/scouting', level: 2 })
      items.push({ type: 'link', label: 'Opposition Intel', href: '/igc/seattle-cup/intel', level: 2 })
    }
  }
  return items
}

export function buildBreadcrumb(pathname: string): Crumb[] {
  if (pathname === '/') return [{ label: 'Home' }]
  if (pathname === '/igc') return [{ label: 'Interbay Golf Club' }]
  if (pathname === '/igc/league') return [{ label: 'Interbay', href: '/igc' }, { label: 'Leagues' }]
  if (pathname === '/igc/mens-league') return [{ label: 'Interbay', href: '/igc' }, { label: "Men's League" }, { label: 'Standings' }]
  if (/^\/players\/[^/]+\/performance$/.test(pathname)) {
    const golferId = pathname.split('/')[2]
    return [{ label: 'Interbay', href: '/igc' }, { label: "Men's League", href: '/igc/mens-league' }, { label: 'Player detail', href: `/players/${golferId}` }, { label: 'Performance' }]
  }
  if (pathname.startsWith('/players/')) return [{ label: 'Interbay', href: '/igc' }, { label: "Men's League", href: '/igc/mens-league' }, { label: 'Player detail' }]
  if (pathname === '/igc/mens-league/tee-times') return [{ label: 'Interbay', href: '/igc' }, { label: "Men's League", href: '/igc/mens-league' }, { label: 'Tee Times' }]
  if (pathname === '/igc/club-championship') return [{ label: 'Interbay', href: '/igc' }, { label: "Men's League", href: '/igc/mens-league' }, { label: 'Club Championship' }]
  if (pathname === '/igc/womens-league') return [{ label: 'Interbay', href: '/igc' }, { label: "Women's League" }, { label: 'Standings' }]
  if (pathname === '/igc/seattle-cup/harvest/2026/review') return [{ label: 'Interbay', href: '/igc' }, { label: 'Seattle Cup', href: '/igc/seattle-cup/harvest/2026' }, { label: 'Review Reports' }]
  if (pathname === '/igc/seattle-cup/harvest/2026') return [{ label: 'Interbay', href: '/igc' }, { label: 'Seattle Cup' }, { label: 'Share What You Learned' }]
  if (pathname === '/igc/seattle-cup/scouting') return [{ label: 'Interbay', href: '/igc' }, { label: 'Seattle Cup' }, { label: 'Scouting' }]
  if (pathname === '/igc/seattle-cup/intel') return [{ label: 'Interbay', href: '/igc' }, { label: 'Seattle Cup' }, { label: 'Opposition Intel' }]
  if (pathname.startsWith('/igc/seattle-cup/scouting/players')) return [{ label: 'Interbay', href: '/igc' }, { label: 'Seattle Cup', href: '/igc/seattle-cup/scouting' }, { label: 'Scouting' }]
  if (pathname === '/admin') return [{ label: 'Interbay', href: '/igc' }, { label: 'Registration admin' }]
  if (pathname === '/admin/scouting') return [{ label: 'Interbay', href: '/igc' }, { label: 'Seattle Cup' }, { label: 'Manage access' }]
  return []
}
