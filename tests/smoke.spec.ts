import { expect, test, type Page } from '@playwright/test'

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign In' }).click()
}

test.describe('public smoke', () => {
  test('login page loads', async ({ page }) => {
    await page.goto('/login')

    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    await expect(page.getByLabel('Email')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Reset password' })).toBeVisible()
  })

  test('home redirects anonymous users to login', async ({ page }) => {
    await page.goto('/')

    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  })

  test('admin redirects anonymous users to login', async ({ page }) => {
    await page.goto('/admin')

    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  })

  test('waitlist page loads', async ({ page }) => {
    await page.goto('/stay-tuned')

    await expect(page.getByRole('heading', { name: 'Waitlist' })).toBeVisible()
    await expect(page.getByText("We'll reach out if access becomes available.")).toBeVisible()
  })
})

const memberEmail = process.env.SMOKE_MEMBER_EMAIL
const memberPassword = process.env.SMOKE_MEMBER_PASSWORD
const adminEmail = process.env.SMOKE_ADMIN_EMAIL
const adminPassword = process.env.SMOKE_ADMIN_PASSWORD

test.describe('authenticated smoke', () => {
  test.skip(!memberEmail || !memberPassword, 'Set SMOKE_MEMBER_EMAIL and SMOKE_MEMBER_PASSWORD to run member smoke tests.')
  test.skip(!adminEmail || !adminPassword, 'Set SMOKE_ADMIN_EMAIL and SMOKE_ADMIN_PASSWORD to run admin smoke tests.')

  test('member home loads for an invited user', async ({ page }) => {
    test.skip(!memberEmail || !memberPassword)

    await signIn(page, memberEmail!, memberPassword!)

    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByText('Preferred tee times')).toBeVisible()
    await expect(page.getByText('Individual event overrides')).toBeVisible()
    await expect(page.getByRole('button', { name: /update|set defaults/i })).toBeVisible()
    await expect(page.getByText(/can't play this week/i).first()).toBeVisible()
  })

  test('admin dashboard loads for an admin user', async ({ page }) => {
    test.skip(!adminEmail || !adminPassword)

    await signIn(page, adminEmail!, adminPassword!)
    await page.goto('/admin')

    await expect(page).toHaveURL(/\/admin$/)
    await expect(page.getByText('Good to Go Admin')).toBeVisible()
    await expect(page.getByText('System tools')).toBeVisible()
    await expect(page.getByText(/Men's next registration run/i)).toBeVisible()
    await expect(page.getByText(/Women's next registration run/i)).toBeVisible()
  })
})
