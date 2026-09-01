import assert from 'node:assert/strict'
import test from 'node:test'
import { buildBreadcrumb, buildNav } from '../lib/app-shell/navigation.ts'
import type { AppShellUser } from '../lib/app-shell/user.ts'

const base: AppShellUser = { signedIn: true, userId: 'u', email: 'u@example.com', displayName: 'User', league: null, gtgAccess: false, scouting: false, harvest: false, harvestReview: false, isAdmin: false }
const labels = (user: AppShellUser) => buildNav(user).filter((item) => item.type === 'link').map((item) => item.label)

test('existing league member plus harvest keeps league and tee-time navigation and gains contribution', () => {
  const nav = labels({ ...base, league: 'mens', gtgAccess: true, harvest: true })
  assert.ok(nav.includes('Standings'))
  assert.ok(nav.includes('Tee Times'))
  assert.ok(nav.includes('Share What You Learned'))
})

test('scouting reviewer plus harvest retains scouting and gains contribution and review', () => {
  const nav = labels({ ...base, league: 'mens', gtgAccess: true, scouting: true, harvest: true, harvestReview: true })
  assert.ok(nav.includes('Scouting'))
  assert.ok(nav.includes('Opposition Intel'))
  assert.ok(nav.includes('Share What You Learned'))
  assert.ok(nav.includes('Review Reports'))
})

test('new contributor-only and observer-only accounts get a focused return destination', () => {
  const nav = labels({ ...base, harvest: true })
  assert.deepEqual(nav, ['Home', 'Share What You Learned'])
  assert.equal(nav.includes('Scouting'), false)
  assert.equal(nav.includes('Tee Times'), false)
  assert.equal(nav.includes('Standings'), false)
})

test('uninvited league member navigation is unchanged by harvest feature', () => {
  const nav = labels({ ...base, league: 'mens', gtgAccess: true })
  assert.ok(nav.includes('Standings'))
  assert.ok(nav.includes('Tee Times'))
  assert.equal(nav.includes('Share What You Learned'), false)
  assert.equal(nav.includes('Review Reports'), false)
})

test('harvest and review breadcrumbs are explicit and mobile-compatible', () => {
  assert.deepEqual(buildBreadcrumb('/igc/seattle-cup/harvest/2026').map((crumb) => crumb.label), ['Interbay', 'Seattle Cup', 'Share What You Learned'])
  assert.deepEqual(buildBreadcrumb('/igc/seattle-cup/harvest/2026/review').map((crumb) => crumb.label), ['Interbay', 'Seattle Cup', 'Review Reports'])
})
