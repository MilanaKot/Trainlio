import { expect, test, type Page } from '@playwright/test'
import { asUser, dateInput, grantCoach, signIn, tokenFor, uniqueEmail, STACK } from './helpers'

/**
 * Editing a training that people are already coming to
 * (coach/SPEC.md §K3, acceptance tests 2, 3 and 4).
 *
 * Everything here is about what the coach is told before they commit: who will
 * get an e-mail, who is already booked into the places being taken away, and
 * which children a narrower year range would exclude. The refusals themselves
 * belong to the database and are asserted in supabase/tests; these are about
 * whether the coach can see what they are about to do.
 */

/** A child of a given birth year, booked into the session. */
async function bookedAthlete(
  firstName: string,
  birthYear: number,
  sessionId: string,
): Promise<void> {
  const token = await tokenFor(uniqueEmail(`rodina.${firstName.toLowerCase()}`))

  const workspaces = (await (
    await fetch(`${STACK}/rest/v1/rpc/joinable_workspaces`, {
      method: 'POST',
      headers: asUser(token),
      body: '{}',
    })
  ).json()) as { id: string }[]

  const created = (await (
    await fetch(`${STACK}/rest/v1/rpc/create_athlete_with_guardian`, {
      method: 'POST',
      headers: asUser(token),
      body: JSON.stringify({
        p_first_name: firstName,
        p_last_name: 'Hráč',
        p_date_of_birth: `${birthYear}-04-02`,
        p_workspace_id: workspaces[0]?.id,
        p_sport_code: 'HOCKEY',
        p_attributes: { position: 'CENTER', stick_side: 'LEFT' },
      }),
    })
  ).json()) as { ok?: boolean; data?: { athlete_id?: string } }
  expect(created.ok).toBe(true)

  const booked = (await (
    await fetch(`${STACK}/rest/v1/rpc/book_athletes_as_guardian`, {
      method: 'POST',
      headers: asUser(token),
      body: JSON.stringify({
        p_training_session_id: sessionId,
        p_athlete_ids: [created.data?.athlete_id],
      }),
    })
  ).json()) as { ok?: boolean; code?: string }
  expect(booked.ok, `booking failed: ${booked.code}`).toBe(true)
}

/** A training created through the form, returning its id. */
async function createTraining(page: Page, room: string, capacity: number): Promise<string> {
  await page.goto('/trener/novy')
  await page.getByLabel('Datum').fill(dateInput(20))
  await page.getByLabel('Začátek').fill('17:00')
  await page.getByLabel('Konec').fill('18:00')
  await page.getByLabel('Kapacita', { exact: true }).fill(String(capacity))
  await page.getByLabel('Šatna').fill(room)
  await page.getByRole('button', { name: 'Vytvořit trénink' }).click()

  await expect(page.getByText(room)).toBeVisible()
  return page.url().split('/trener/')[1]?.split('/')[0] ?? ''
}

test.describe('a coach edits a training people are coming to', () => {
  test('says who will be e-mailed before the change is saved (§K3, test 2)', async ({ page }) => {
    const coach = uniqueEmail('trener')
    await signIn(page, coach)
    await grantCoach(coach)

    const room = `Šatna ${Date.now()}`
    const sessionId = await createTraining(page, room, 10)
    await bookedAthlete('Adam', 2017, sessionId)
    await bookedAthlete('Bohdan', 2017, sessionId)

    await page.goto(`/trener/${sessionId}/upravit`)

    // Nothing has changed yet, so there is nothing to warn about.
    await expect(page.getByText('Změnil se čas.')).toHaveCount(0)

    await page.getByLabel('Začátek').fill('18:30')

    // The notice names what changed and how many families it reaches, before
    // the coach commits to it (§4: the consequence is stated first).
    await expect(page.getByText('Změnil se čas.')).toBeVisible()
    await expect(page.getByText(/Rodiče 2 přihlášených sportovců dostanou e-mail/)).toBeVisible()

    // A change that is not significant says nothing at all (D-11).
    await page.getByLabel('Začátek').fill('17:00')
    await expect(page.getByText('Změnil se čas.')).toHaveCount(0)
    await page.getByLabel('Šatna').fill('Šatna 9')
    await expect(page.getByText(/dostanou e-mail/)).toHaveCount(0)

    await page.getByRole('button', { name: 'Uložit změny' }).click()
    await expect(page.getByText('Šatna 9')).toBeVisible()
  })

  test('asks before taking away places people hold (§K8, test 3)', async ({ page }) => {
    const coach = uniqueEmail('trener')
    await signIn(page, coach)
    await grantCoach(coach)

    const room = `Šatna ${Date.now()}`
    const sessionId = await createTraining(page, room, 10)
    await bookedAthlete('Cyril', 2017, sessionId)
    await bookedAthlete('Dalibor', 2017, sessionId)

    await page.goto(`/trener/${sessionId}/upravit`)
    await page.getByLabel('Kapacita', { exact: true }).fill('1')
    await page.getByRole('button', { name: 'Uložit změny' }).click()

    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toContainText('Na tento trénink jsou již přihlášeni 2 sportovci.')
    await expect(dialog).toContainText('Nová kapacita je 1.')
    await expect(dialog).toContainText('Stávající přihlášky zůstanou zachovány.')

    await dialog.getByRole('button', { name: 'Přesto uložit' }).click()

    // Over capacity is a supported state, not an error (BR-033).
    await expect(page.getByText('2 / 1')).toBeVisible()
  })

  test('names the children a narrower year range would exclude (§K9, test 4)', async ({ page }) => {
    const coach = uniqueEmail('trener')
    await signIn(page, coach)
    await grantCoach(coach)

    const room = `Šatna ${Date.now()}`
    const sessionId = await createTraining(page, room, 10)
    await bookedAthlete('Emil', 2016, sessionId)
    await bookedAthlete('Filip', 2017, sessionId)

    await page.goto(`/trener/${sessionId}/upravit`)
    await page.getByRole('radio', { name: 'Ročníky' }).click()
    await page.getByLabel('Od', { exact: true }).selectOption('2017')
    await page.getByLabel('Do', { exact: true }).selectOption('2017')
    await page.getByRole('button', { name: 'Uložit změny' }).click()

    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toContainText('1 přihlášený sportovec nesplňuje novou věkovou podmínku.')
    // Exactly the one who falls outside it, by name and by year — a count
    // alone is not something a coach can check.
    await expect(dialog).toContainText('Emil Hráč · 2016')
    await expect(dialog).not.toContainText('Filip')
    await expect(dialog).toContainText('Jejich přihlášky zůstanou zachovány.')

    await dialog.getByRole('button', { name: 'Přesto uložit' }).click()

    // D-08: narrowing never cancels anybody. Both children are still on the
    // roster afterwards, the one outside the range included.
    await expect(page.getByRole('heading', { name: 'Sportovci 2' })).toBeVisible()
    await expect(page.getByText('Emil Hráč')).toBeVisible()
  })

  test('asks before throwing away edits, and only when there are some', async ({ page }) => {
    const coach = uniqueEmail('trener')
    await signIn(page, coach)
    await grantCoach(coach)

    const room = `Šatna ${Date.now()}`
    const sessionId = await createTraining(page, room, 10)

    await page.goto(`/trener/${sessionId}/upravit`)

    // Untouched: leaving is just leaving.
    await page.getByRole('button', { name: 'Zrušit' }).click()
    await expect(page).toHaveURL(new RegExp(`/trener/${sessionId}$`))

    await page.goto(`/trener/${sessionId}/upravit`)
    await page.getByLabel('Šatna').fill('Šatna 12')
    await page.getByRole('button', { name: 'Zrušit' }).click()

    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toContainText('Zahodit změny?')
    await dialog.getByRole('button', { name: 'Pokračovat v úpravách' }).click()
    await expect(page.getByLabel('Šatna')).toHaveValue('Šatna 12')

    await page.getByRole('button', { name: 'Zrušit' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Zahodit' }).click()
    await expect(page).toHaveURL(new RegExp(`/trener/${sessionId}$`))
    await expect(page.getByText('Šatna 12')).toHaveCount(0)
  })
})
