import { expect, test } from '@playwright/test'
import {
  expectAccessible,
  grantCoach,
  pickRoom,
  profileFor,
  signIn,
  uniqueEmail,
  SERVICE,
  STACK,
} from './helpers'

/**
 * A season of trainings (coach/SPEC.md §K11, acceptance test 8).
 *
 * The preview is the whole point of the screen: a coach approves a list of
 * dates, not a rule. So what is asserted here is that the list matches the
 * pattern, that unchecking a date changes what the button promises, and that
 * what is created is what was checked.
 */

/**
 * The trainings a coach's newest series made, read with the service key.
 * Every run shares one database, so the cards are found by these ids, never
 * by their room or time.
 */
async function newestSeries(coachEmail: string): Promise<{ id: string; sessionIds: string[] }> {
  const headers = { apikey: SERVICE, authorization: `Bearer ${SERVICE}` }
  const series = (await (
    await fetch(
      `${STACK}/rest/v1/session_series?select=id&created_by=eq.${await profileFor(coachEmail)}&order=created_at.desc&limit=1`,
      { headers },
    )
  ).json()) as { id: string }[]
  const id = series[0]?.id ?? ''
  const sessions = (await (
    await fetch(`${STACK}/rest/v1/training_sessions?select=id&series_id=eq.${id}`, { headers })
  ).json()) as { id: string }[]
  return { id, sessionIds: sessions.map((one) => one.id) }
}

function cardsOf(sessionIds: string[]): string {
  return sessionIds.map((id) => `li[data-session-id="${id}"]`).join(', ')
}

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

  const room = `Šatna ${pickRoom()}`
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
  const made = await newestSeries(coach)
  expect(made.sessionIds).toHaveLength(8)
  await page.goto('/trener')
  await expect(page.locator(cardsOf(made.sessionIds))).toHaveCount(8)
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
  const room = `Šatna ${pickRoom()}`
  await page.getByLabel('Šatna').fill(room)
  await page.getByRole('button', { name: 'Vytvořit 3 tréninky' }).click()
  await expect(page).toHaveURL(/\/trener\/serie$/)

  // §A0: planning is every coach's section, not the administrator's.
  await page.goto('/trener/vice')
  await page.getByRole('link', { name: /Série tréninků/ }).click()
  await expect(page).toHaveURL(/\/trener\/serie$/)
  await expect(page.getByRole('heading', { name: 'Série', level: 1 })).toBeVisible()
  await expectAccessible(page, '§K15 the series list') // AC-292

  const made = await newestSeries(coach)
  const card = page.locator('main li', { has: page.locator(`a[href="/trener/serie/${made.id}"]`) })
  await expect(card).toContainText('3 tréninků, zbývá 3')
  await card.getByRole('link').click()

  // §K16: the trainings of this series, and the sentence that says why there is
  // no button to change them all at once.
  await expect(page.getByRole('tab', { name: 'Nadcházející · 3' })).toBeVisible()
  await expect(page.locator(cardsOf(made.sessionIds))).toHaveCount(3)
  await expect(
    page.getByText('Celou sérii nelze upravit ani zrušit najednou.', { exact: false }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: /Upravit/ })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Upravit/ })).toHaveCount(0)
  await expectAccessible(page, '§K16 the trainings of a series') // AC-292

  // One training edited on its own says so, and the others do not.
  const seriesUrl = page.url()
  const first = page.locator(cardsOf(made.sessionIds)).first()
  await first.getByRole('link').click()
  await page.getByRole('link', { name: 'Upravit trénink' }).click()
  let other = `Šatna ${pickRoom()}`
  while (other === room) other = `Šatna ${pickRoom()}`
  await page.getByLabel('Šatna').fill(other)
  await page.getByRole('button', { name: 'Uložit změny' }).click()
  await expect(page.getByText(other).first()).toBeVisible()

  await page.goto(seriesUrl)
  await expect(page.locator('main li', { hasText: 'Upraveno mimo sérii' })).toHaveCount(1)
})
