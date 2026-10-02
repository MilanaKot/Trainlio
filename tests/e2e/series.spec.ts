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
  await expect(page.getByText(/8 tréninků/).first()).toBeVisible()

  // And they are real trainings, on the list a coach works from.
  await page.goto('/trener')
  await expect(page.locator('li', { hasText: room })).toHaveCount(8)
})

/**
 * §K15, §K16 (coach test 13). The series list is reached from `Více`, a series
 * opens the trainings it made, and nothing anywhere edits a series: the
 * occurrences are independent the moment they are created.
 */
test('a series opens its trainings and never an edit form (AC-288)', async ({ page }) => {
  const coach = uniqueEmail('trener.serie')
  await signIn(page, coach)
  await grantCoach(coach)

  await page.goto('/trener/serie/nova')
  await page.getByLabel('Od *', { exact: true }).fill(sunday(0))
  await page.getByLabel('Do *', { exact: true }).fill(sunday(2))
  await page.getByLabel('Začátek').fill('07:00')
  await page.getByLabel('Konec').fill('08:00')
  const room = `Šatna ${Date.now()}`
  await page.getByLabel('Šatna').fill(room)
  await page.getByRole('button', { name: 'Vytvořit 3 tréninky' }).click()
  await expect(page).toHaveURL(/\/trener\/serie$/)

  // §A0: planning is every coach's section, not the administrator's.
  await page.goto('/trener/vice')
  await page.getByRole('link', { name: /Série tréninků/ }).click()
  await expect(page).toHaveURL(/\/trener\/serie$/)
  await expect(page.getByRole('heading', { name: 'Série', level: 1 })).toBeVisible()

  const card = page.locator('main li', { hasText: '07:00–08:00' }).first()
  await expect(card).toContainText('3 tréninků, zbývá 3')
  await card.getByRole('link').click()

  // §K16: the trainings of this series, and the sentence that says why there is
  // no button to change them all at once.
  await expect(page.getByRole('tab', { name: 'Nadcházející · 3' })).toBeVisible()
  await expect(page.locator('main li', { hasText: room })).toHaveCount(3)
  await expect(
    page.getByText('Celou sérii nelze upravit ani zrušit najednou.', { exact: false }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: /Upravit/ })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Upravit/ })).toHaveCount(0)

  // One training edited on its own says so, and the others do not.
  const seriesUrl = page.url()
  const first = page.locator('main li', { hasText: room }).first()
  await first.getByRole('link').click()
  await page.getByRole('link', { name: 'Upravit trénink' }).click()
  await page.getByLabel('Šatna').fill(`${room} B`)
  await page.getByRole('button', { name: 'Uložit změny' }).click()
  await expect(page.getByText(`${room} B`).first()).toBeVisible()

  await page.goto(seriesUrl)
  await expect(page.locator('main li', { hasText: 'Upraveno mimo sérii' })).toHaveCount(1)
})
