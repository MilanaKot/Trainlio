import { expect, test } from '@playwright/test'
import {
  asUser,
  dateInput,
  grantCoach,
  signIn,
  tokenFor,
  uniqueEmail,
  SERVICE,
  STACK,
} from './helpers'

/**
 * The guardian's whole path, through the interface a parent actually uses:
 * sign in with a code, register a child, book, see the count, withdraw.
 *
 * Everything below the interface is already proven by the SQL suites and the
 * integration suite. What only a browser can prove is that the pages, the
 * server actions and the session cookies compose into something a parent can
 * complete — and that the Czech they meet is the Czech the specification asks
 * for.
 */

const admin = {
  apikey: SERVICE,
  authorization: `Bearer ${SERVICE}`,
  'content-type': 'application/json',
}

/**
 * A session for these athletes to book into, opened by a real coach call.
 *
 * `changingRoom` is the test's handle on its own session. Every run shares one
 * database and the projects run in parallel, so locating a card by "Šatna 4" or
 * by "1 / 1" finds another run's training — which is how these first failed.
 */
async function openSession(
  coachEmail: string,
  capacity: number,
  changingRoom: string,
): Promise<string> {
  const token = await tokenFor(coachEmail)
  const { workspaceId, profileId } = await grantCoach(coachEmail)

  const facilities = (await (
    await fetch(`${STACK}/rest/v1/facilities?select=id,code`, { headers: admin })
  ).json()) as { id: string; code: string }[]

  const response = await fetch(`${STACK}/rest/v1/rpc/create_training_session`, {
    method: 'POST',
    headers: asUser(token),
    body: JSON.stringify({
      p_workspace_id: workspaceId,
      p_local_date: dateInput(21),
      p_local_start_time: '09:00',
      p_local_end_time: '10:00',
      p_facility_id: facilities.find((f) => f.code === 'MH')?.id,
      p_capacity: capacity,
      p_eligibility_mode: 'ALL',
      p_changing_room: changingRoom,
      p_main_coach_profile_id: profileId,
    }),
  })

  const result = (await response.json()) as {
    ok?: boolean
    code?: string
    data?: { training_session_id?: string }
  }
  expect(result.ok, `session creation failed: ${result.code}`).toBe(true)
  return result.data?.training_session_id ?? ''
}

/**
 * Fills a session from another family, so the parent under test meets it
 * already full rather than filling it themselves.
 */
async function fillSession(sessionId: string): Promise<void> {
  const other = uniqueEmail('jina.rodina')
  const token = await tokenFor(other)

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
        p_first_name: 'Petr',
        p_last_name: 'Jiný',
        p_date_of_birth: '2017-01-15',
        p_workspace_id: workspaces[0]?.id,
        p_sport_code: 'HOCKEY',
        p_attributes: { position: 'DEFENSE', stick_side: 'LEFT' },
      }),
    })
  ).json()) as { ok?: boolean; data?: { athlete_id?: string } }
  expect(created.ok, 'the other family could not register').toBe(true)

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
  expect(booked.ok, `the other family could not book: ${booked.code}`).toBe(true)
}

test.describe('a guardian, from first sign-in to a withdrawn booking', () => {
  // The whole path is one test on purpose. Split into four it would need four
  // sign-ins and four registrations, and it would stop proving the one thing
  // worth proving: that a parent can get from the start to the end.
  test('registers a child, books, sees the count, and withdraws', async ({ page }) => {
    const parent = uniqueEmail('rodic')
    const coach = uniqueEmail('trener')
    const room = `Šatna ${Date.now()}`
    await openSession(coach, 10, room)

    // AC-001, AC-002: a code arrives and authenticates without a password.
    await signIn(page, parent)

    // D-10 is stated before the child is registered, not after.
    await page.goto('/moji-sportovci')
    await expect(page.getByText('Zatím nemáte žádného sportovce.')).toBeVisible()
    await page.getByRole('link', { name: 'Přidat sportovce' }).first().click()

    await page.getByLabel('Jméno').fill('Ivan')
    await page.getByLabel('Příjmení').fill('Kotov')
    await page.getByLabel('Datum narození').fill('2017-10-23')
    await page.getByLabel('Pozice').selectOption('CENTER')
    await page.getByLabel('Hůl').selectOption('LEFT')
    await page.getByRole('button', { name: 'Uložit' }).click()

    await expect(page.getByText('Ivan Kotov')).toBeVisible()

    // D-01: the workspace only becomes visible once a child belongs to it.
    await page.goto('/treninky')
    const card = page.locator('li', { hasText: room }).first()
    await expect(card).toBeVisible()
    await expect(card).toContainText('0 / 10')

    await card.getByRole('checkbox').check()
    await card.getByRole('button', { name: 'Přihlásit' }).click()

    // The count comes from the projection, so it moving is the projection
    // having been maintained — not the client having decremented something.
    await expect(page.locator('li', { hasText: room }).first()).toContainText('1 / 10')

    await page.goto('/moje-treninky')
    await expect(page.getByText('Ivan Kotov')).toBeVisible()

    // Well outside the 12-hour deadline, so withdrawing is offered (AC-040).
    await page.getByRole('button', { name: 'Odhlásit' }).click()
    await expect(page.getByRole('button', { name: 'Odhlásit' })).toHaveCount(0)

    await page.goto('/treninky')
    await expect(page.locator('li', { hasText: room }).first()).toContainText('0 / 10')
  })

  test('a full session offers no booking (AC-021)', async ({ page }) => {
    const parent = uniqueEmail('plny')
    const coach = uniqueEmail('trener')
    const room = `Šatna ${Date.now()}`
    const sessionId = await openSession(coach, 1, room)
    await fillSession(sessionId)

    await signIn(page, parent)
    await page.goto('/moji-sportovci/novy')
    await page.getByLabel('Jméno').fill('Anna')
    await page.getByLabel('Příjmení').fill('Kotova')
    await page.getByLabel('Datum narození').fill('2018-03-04')
    await page.getByLabel('Pozice').selectOption('GOALIE')
    await page.getByLabel('Hůl').selectOption('RIGHT')
    await page.getByRole('button', { name: 'Uložit' }).click()
    await expect(page.getByText('Anna Kotova')).toBeVisible()

    await page.goto('/treninky')
    const card = page.locator('li', { hasText: room }).first()
    await expect(card).toContainText('1 / 1')

    // Booked to capacity by another family before this parent ever looked.
    await expect(card).toContainText('Trénink je plný.')
    await expect(card.getByRole('button', { name: 'Přihlásit' })).toHaveCount(0)
  })

  test("another family's athletes never appear (AC-091)", async ({ page }) => {
    const parent = uniqueEmail('cizinec')
    await signIn(page, parent)

    await page.goto('/moji-sportovci')
    await expect(page.getByText('Ivan Kotov')).toHaveCount(0)
    await expect(page.getByText('Anna Kotova')).toHaveCount(0)

    // D-01: and with no child anywhere, no workspace's sessions either.
    await page.goto('/treninky')
    await expect(page.getByText('Zatím nejsou vypsané žádné tréninky.')).toBeVisible()
  })

  test('signing out ends the session (AC-002)', async ({ page }) => {
    await signIn(page, uniqueEmail('odhlaseni'))
    await page.goto('/ucet')
    await page.getByRole('button', { name: 'Odhlásit se' }).click()
    await page.waitForURL(/\/prihlaseni$/)

    // Not merely redirected: the protected page is gone too.
    await page.goto('/moji-sportovci')
    await expect(page).toHaveURL(/\/prihlaseni$/)
  })
})
