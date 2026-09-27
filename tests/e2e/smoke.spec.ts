import { expect, test } from '@playwright/test'

test('the application renders', async ({ page }) => {
  // The root routes by session: an anonymous visitor lands on sign-in.
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Přihlášení' })).toBeVisible()
})
