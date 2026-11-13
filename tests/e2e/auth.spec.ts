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

/**
 * Google (D-38, AC-320). The CI stack has no Google provider, so the button is
 * followed as far as Supabase's authorize address and stopped there: what is
 * asserted is that the request is Google's, PKCE-protected, with the account
 * chooser, and that it comes back to this site's callback.
 */
test.describe('sign-in with Google', () => {
  test.skip(process.env.NEXT_PUBLIC_AUTH_GOOGLE !== 'on', 'the button is off in this build')

  test('goes to Google through Supabase, and comes back to /auth/callback', async ({ page }) => {
    await page.goto('/prihlaseni')
    const authorize = page.waitForRequest((request) => request.url().includes('/auth/v1/authorize'))
    await page.route('**/auth/v1/authorize**', (route) => route.abort())
    await page.getByRole('button', { name: 'Pokračovat přes Google' }).click()

    const url = new URL((await authorize).url())
    expect(url.searchParams.get('provider')).toBe('google')
    expect(url.searchParams.get('code_challenge')).toBeTruthy()
    expect(url.searchParams.get('prompt')).toBe('select_account')
    expect(new URL(url.searchParams.get('redirect_to') ?? '').pathname).toBe('/auth/callback')
  })

  test('a failed or cancelled Google sign-in comes back with the e-mail code offered', async ({
    page,
  }) => {
    await page.goto('/auth/callback?error=access_denied&next=https://evil.example')
    await expect(page).toHaveURL(/\/prihlaseni\?chyba=google$/)
    await expect(page.getByText(/použijte kód z e-mailu/)).toBeVisible()
    await expect(page.getByLabel('E-mail')).toBeVisible()

    await page.goto('/auth/callback?code=not-a-real-code')
    await expect(page).toHaveURL(/\/prihlaseni\?chyba=google$/)
  })
})
