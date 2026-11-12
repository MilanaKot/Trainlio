import { expect, test } from '@playwright/test'
import { readCode, uniqueEmail } from './helpers'

/**
 * Phase 1 delivers the OTP sign-in flow (PRD §7). These assert the form a
 * parent actually meets; verifying a real code needs a running Supabase
 * project and belongs to the Phase 8 end-to-end suite.
 */
test.describe('sign-in', () => {
  test('the root sends an anonymous visitor to email sign-in', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/prihlaseni$/)
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

  // §6.26: a refused code leaves the field empty and ready, so the right one
  // can be typed straight after. It used to keep the six wrong digits, and a
  // field that holds six takes no seventh — the next code went nowhere.
  test('a wrong code can be followed by the right one', async ({ page }) => {
    const email = uniqueEmail('spatny.kod')
    await page.goto('/prihlaseni')
    await page.getByLabel('E-mail').fill(email)
    await page.getByRole('button', { name: 'Poslat kód' }).click()

    const code = page.getByLabel('Kód')
    await code.waitFor()
    const right = await readCode(email)
    const wrong = right === '000000' ? '111111' : '000000'
    await code.pressSequentially(wrong)
    await expect(page.getByText('Kód je neplatný nebo vypršel. Zkuste to znovu.')).toBeVisible()
    await expect(code).toHaveValue('')
    await expect(code).toHaveAttribute('aria-invalid', 'true')
    await expect(code).toBeFocused()

    await page.keyboard.type(right)
    await page.waitForURL((url) => !url.pathname.includes('/prihlaseni'))
  })
})
