import { expect, test } from '@playwright/test'

/**
 * The guardian area requires a session. Verifying the form itself needs a
 * running Supabase project to sign in against, which belongs to the Phase 8
 * end-to-end suite; what is assertable here is that none of it is reachable
 * without authenticating.
 */
test.describe('guardian area requires a session', () => {
  for (const path of [
    '/moji-sportovci',
    '/moji-sportovci/novy',
    '/ucet',
    '/treninky',
    '/moje-treninky',
    '/trener',
    '/trener/novy',
    '/trener/serie',
    '/trener/serie/nova',
    // The roster is coach-only and names the guardian who made each booking
    // (BR-092), so possession of the session id must not be enough to see it.
    '/trener/00000000-0000-0000-0000-0000000e0001',
    '/trener/00000000-0000-0000-0000-0000000e0001/upravit',
  ]) {
    test(`${path} redirects to sign-in`, async ({ page }) => {
      await page.goto(path)
      await expect(page).toHaveURL(/\/prihlaseni$/)
      await expect(page.getByRole('heading', { name: 'Přihlášení' })).toBeVisible()
    })
  }

  test('the root sends an anonymous visitor to sign-in', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/prihlaseni$/)
  })
})
