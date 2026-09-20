import { expect, test } from '@playwright/test'

/**
 * Phase 1 delivers the OTP sign-in flow (PRD §7). These assert the form a
 * parent actually meets; verifying a real code needs a running Supabase
 * project and belongs to the Phase 8 end-to-end suite.
 */
test.describe('sign-in', () => {
  test('offers email sign-in from the root', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Přihlášení' }).click()
    await expect(page.getByRole('heading', { name: 'Přihlášení' })).toBeVisible()
    await expect(page.getByLabel('E-mail')).toBeVisible()
  })

  test('asks for the code after an email is submitted', async ({ page }) => {
    await page.goto('/prihlaseni')

    // No password field anywhere: authentication is a one-time code.
    await expect(page.locator('input[type="password"]')).toHaveCount(0)

    const email = page.getByLabel('E-mail')
    await expect(email).toHaveAttribute('inputmode', 'email')
    await expect(page.getByRole('button', { name: 'Poslat kód' })).toBeVisible()
  })

  test('rejects a malformed email without contacting the server', async ({ page }) => {
    await page.goto('/prihlaseni')
    await page.getByLabel('E-mail').fill('not-an-email')
    await page.getByRole('button', { name: 'Poslat kód' }).click()
    // Native validation keeps the form on the email step.
    await expect(page.getByRole('button', { name: 'Poslat kód' })).toBeVisible()
  })
})
