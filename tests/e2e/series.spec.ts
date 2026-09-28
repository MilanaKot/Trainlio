import { expect, test } from '@playwright/test'
import { grantCoach, signIn, uniqueEmail } from './helpers'

/**
 * A season of trainings (coach/SPEC.md §K11, acceptance test 8).
 *
 * The preview is the whole point of the screen: a coach approves a list of
 * dates, not a rule. So what is asserted here is that the list matches the
 * pattern, that unchecking a date changes what the button promises, and that
 * what is created is what was checked.
 */

/** The `YYYY-MM-DD` of the n-th Sunday from today, in the local calendar. */
function sunday(weeksAhead: number): string {
  const at = new Date()
  at.setDate(at.getDate() + ((7 - at.getDay()) % 7 || 7) + weeksAhead * 7)
  return at.toISOString().slice(0, 10)
}

test('creates one training per checked date (§K11, test 8)', async ({ page }) => {
  const coach = uniqueEmail('trener')
  await signIn(page, coach)
  await grantCoach(coach)

  await page.goto('/trener/serie/nova')
  await expect(page.getByRole('heading', { name: 'Série tréninků' })).toBeVisible()

  // Nine Sundays: the first one and eight more. The asterisk is part of the
  // label's text — Playwright matches that, not the accessible name — and the
  // match has to be exact, because `Od` as a substring is also inside
  // `Pondělí` and `rodiče`.
  await page.getByLabel('Od *', { exact: true }).fill(sunday(0))
  await page.getByLabel('Do *', { exact: true }).fill(sunday(8))
  await page.getByLabel('Začátek').fill('16:00')
  await page.getByLabel('Konec').fill('17:00')

  const room = `Šatna ${Date.now()}`
  await page.getByLabel('Šatna').fill(room)

  await expect(page.getByText('Vytvoří se 9 tréninků')).toBeVisible()
  const create = page.getByRole('button', { name: 'Vytvořit 9 tréninků' })
  await expect(create).toBeVisible()

  // Unchecking a date is how a coach says "not that week". It changes the
  // promise on the button, because that is what will be created.
  await page.locator('main li label').first().click()
  await expect(page.getByRole('button', { name: 'Vytvořit 8 tréninků' })).toBeVisible()

  await page.getByRole('button', { name: 'Vytvořit 8 tréninků' }).click()

  await expect(page).toHaveURL(/\/trener\/serie$/)
  await expect(page.getByText('8 tréninků').first()).toBeVisible()

  // And they are real trainings, on the list a coach works from.
  await page.goto('/trener')
  await expect(page.locator('li', { hasText: room })).toHaveCount(8)
})
