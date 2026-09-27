import { expect, test } from '@playwright/test'
import { asUser, dateInput, grantCoach, signIn, tokenFor, uniqueEmail, STACK } from './helpers'

/**
 * The coach's path: publish a training, read the roster, add a child by hand,
 * override a full session, remove someone.
 *
 * The roster is where the privacy model is most visible — a coach sees who
 * booked each child, and a guardian sees none of it — so these assertions are
 * as much about what is on the page as about what is not.
 */

/**
 * A family with one registered child, optionally booked into the session.
 *
 * Registered-but-not-booked is what gives the coach's picker something to
 * offer: the picker lists workspace athletes who hold no place yet.
 */
async function family(firstName: string, options: { bookInto?: string } = {}): Promise<void> {
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
        p_date_of_birth: '2017-04-02',
        p_workspace_id: workspaces[0]?.id,
        p_sport_code: 'HOCKEY',
        p_attributes: { position: 'CENTER', stick_side: 'LEFT' },
      }),
    })
  ).json()) as { ok?: boolean; data?: { athlete_id?: string } }
  expect(created.ok).toBe(true)

  if (!options.bookInto) return

  const booked = (await (
    await fetch(`${STACK}/rest/v1/rpc/book_athletes_as_guardian`, {
      method: 'POST',
      headers: asUser(token),
      body: JSON.stringify({
        p_training_session_id: options.bookInto,
        p_athlete_ids: [created.data?.athlete_id],
      }),
    })
  ).json()) as { ok?: boolean; code?: string }
  expect(booked.ok, `booking failed: ${booked.code}`).toBe(true)
}

test.describe('a coach publishes a training and runs its roster', () => {
  test('creates a session, sees who booked, adds and removes by hand', async ({ page }) => {
    // Signed in through the interface first, then granted the role. Two OTP
    // requests for one address inside a minute is what GoTrue rate-limits, and
    // a test that tripped it would look like a broken sign-in form.
    const coach = uniqueEmail('trener')
    await signIn(page, coach)
    await grantCoach(coach)

    // A guardian reaching a coach URL is not a coach; the same predicate the
    // policies use decides, so there is nothing to get wrong here.
    await page.goto('/trener')
    await expect(page.getByRole('heading', { name: 'Tréninky' })).toBeVisible()

    await page.getByRole('link', { name: '+ Trénink' }).click()
    await page.getByLabel('Datum').fill(dateInput(14))
    await page.getByLabel('Začátek').fill('17:00')
    await page.getByLabel('Konec').fill('18:00')
    await page.getByLabel('Kapacita').fill('2')
    // Unique per run: the projects run in parallel against one database, so a
    // fixed room name finds the other run's training.
    const room = `Šatna ${Date.now()}`
    await page.getByLabel('Šatna').fill(room)
    await page.getByRole('button', { name: 'Uložit' }).click()

    await expect(page.getByText(room)).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Přihlášení sportovci (0 / 2)' })).toBeVisible()

    const sessionUrl = page.url()
    const sessionId = sessionUrl.split('/trener/')[1]?.split('/')[0] ?? ''
    expect(sessionId).not.toBe('')

    // Two families book, which is what makes the roster worth reading. A third
    // registers without booking, so the coach's picker has someone to offer.
    await family('Adam', { bookInto: sessionId })
    await family('Bohdan', { bookInto: sessionId })
    await family('Cyril')

    await page.reload()
    await expect(page.getByRole('heading', { name: 'Přihlášení sportovci (2 / 2)' })).toBeVisible()
    await expect(page.getByText('Adam Hráč', { exact: true })).toBeVisible()
    await expect(page.getByText('Bohdan Hráč', { exact: true })).toBeVisible()
    // BR-092: who booked each child, which no row policy would let a coach read.
    await expect(page.getByText(/Přihlásil\(a\)/).first()).toBeVisible()

    // AC-050: the session is full, so adding by hand must be refused until the
    // coach confirms, and the dialog quotes the server's own numbers.
    await page.getByLabel('Přidat sportovce').selectOption({ label: 'Cyril Hráč (2017)' })
    await page.getByRole('button', { name: 'Přidat', exact: true }).click()
    await expect(page.getByText('Trénink je již plný (2 / 2).')).toBeVisible()
    await expect(page.getByText('Chcete sportovce přidat nad stanovenou kapacitu?')).toBeVisible()

    await page.getByRole('button', { name: 'Přidat', exact: true }).last().click()
    await expect(page.getByRole('heading', { name: 'Přihlášení sportovci (3 / 2)' })).toBeVisible()
    await expect(page.getByText('Cyril Hráč', { exact: true })).toBeVisible()
    await expect(page.getByText('Nad kapacitu')).toBeVisible()

    // D-06: the removal warning says plainly that the parent cannot undo it.
    await page.getByRole('button', { name: 'Odebrat' }).first().click()
    await expect(page.getByText(/Rodič ho na tento trénink nemůže přihlásit zpět/)).toBeVisible()
    await page.getByLabel('Důvod (nepovinné)').fill('Zranění')
    await page.getByRole('button', { name: 'Odebrat', exact: true }).last().click()

    await expect(page.getByRole('heading', { name: 'Přihlášení sportovci (2 / 2)' })).toBeVisible()
    // BR-044: nothing is deleted, so the removal stays readable.
    await page.getByText(/Odebraní a odhlášení/).click()
    await expect(page.getByText('Zranění')).toBeVisible()
  })

  test('a guardian cannot reach the coach area by URL', async ({ page }) => {
    await signIn(page, uniqueEmail('rodic'))

    // Not sent to sign-in — they are signed in. They are simply not staff, and
    // possession of the URL is not authorization, so the layout sends them back
    // to their own area before the page renders.
    for (const path of ['/trener', '/trener/novy', '/trener/serie']) {
      await page.goto(path)
      await expect(page).toHaveURL(/\/moji-sportovci$/)
    }

    // And nothing of the coach area came with them.
    await expect(page.getByRole('link', { name: '+ Trénink' })).toHaveCount(0)
    await expect(page.getByText('Přihlášení sportovci')).toHaveCount(0)
  })

  test('closing booking holds guardians off but not the coach (BR-030)', async ({ page }) => {
    const coach = uniqueEmail('trener')
    await signIn(page, coach)
    await grantCoach(coach)

    await page.goto('/trener/novy')
    await page.getByLabel('Datum').fill(dateInput(15))
    await page.getByLabel('Začátek').fill('18:00')
    await page.getByLabel('Konec').fill('19:00')
    await page.getByLabel('Kapacita').fill('10')
    const room = `Šatna ${Date.now()}`
    await page.getByLabel('Šatna').fill(room)
    await page.getByRole('button', { name: 'Uložit' }).click()
    await expect(page.getByText(room)).toBeVisible()

    await page.getByRole('button', { name: 'Zavřít přihlašování' }).click()
    await expect(page.getByRole('button', { name: 'Otevřít přihlašování' })).toBeVisible()

    // The roster controls stay: a closed session is what a coach closes in
    // order to finish the list themselves.
    await expect(page.getByLabel('Přidat sportovce')).toBeVisible()
  })
})
