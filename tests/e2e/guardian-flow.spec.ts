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
 * A coach moves a training the parent has already booked, through the real
 * domain function — which is what stamps the marker and records what it used
 * to be (D-11, migration 28).
 */
async function moveSession(
  coachEmail: string,
  sessionId: string,
  startTime: string,
  endTime: string,
) {
  const token = await tokenFor(coachEmail)
  const { workspaceId, profileId } = await grantCoach(coachEmail)

  const facilities = (await (
    await fetch(`${STACK}/rest/v1/facilities?select=id,code`, { headers: admin })
  ).json()) as { id: string; code: string }[]

  const result = (await (
    await fetch(`${STACK}/rest/v1/rpc/update_training_session`, {
      method: 'POST',
      headers: asUser(token),
      body: JSON.stringify({
        p_training_session_id: sessionId,
        p_local_date: dateInput(21),
        p_local_start_time: startTime,
        p_local_end_time: endTime,
        p_facility_id: facilities.find((f) => f.code === 'MH')?.id,
        p_capacity: 10,
        p_eligibility_mode: 'ALL',
        p_main_coach_profile_id: profileId,
      }),
    })
  ).json()) as { ok?: boolean; code?: string }

  expect(result.ok, `session update failed: ${result.code}`).toBe(true)
  void workspaceId
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

    // guardian/SPEC.md §G1/§G2 (AC-268): the card opens the sheet, and a family
    // with one eligible child finds them already selected — one tap to confirm.
    await card.getByRole('button', { name: 'Přihlásit' }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet).toContainText('Koho chcete přihlásit?')
    await expect(sheet).toContainText('Ivan Kotov')
    await sheet.getByRole('button', { name: 'Přihlásit' }).click()

    await expect(page.getByText('Přihlášeno', { exact: true })).toBeVisible()

    // The count comes from the projection, so it moving is the projection
    // having been maintained — not the client having decremented something.
    await expect(page.locator('li', { hasText: room }).first()).toContainText('1 / 10')

    // And the card now says who is in, without offering to book them twice.
    await expect(page.locator('li', { hasText: room }).first()).toContainText(
      'Přihlášen: Ivan Kotov',
    )
    await expect(
      page.locator('li', { hasText: room }).first().getByRole('button', { name: 'Přihlásit' }),
    ).toBeDisabled()

    await page.goto('/moje-treninky')
    await expect(page.getByText('Ivan Kotov')).toBeVisible()

    // Well outside the 12-hour deadline, so withdrawing is offered (AC-040).
    // §G4 confirms first: a parent with several bookings is one tap from
    // withdrawing the wrong child.
    await page.getByRole('button', { name: 'Odhlásit' }).click()
    const confirm = page.getByRole('alertdialog')
    await expect(confirm).toContainText('Odhlásit Ivan Kotov?')
    await confirm.getByRole('button', { name: 'Odhlásit' }).click()

    await expect(page.getByRole('status')).toContainText('Odhlášeno')

    // The booking is kept, not deleted (principle 9): it stays in
    // Nadcházející until the training ends, wearing the neutral badge, and
    // offers nothing more to withdraw from. See docs/DESIGN_DEVIATIONS.md.
    const cancelled = page.locator('main li').first()
    await expect(cancelled).toContainText('Odhlášeno')
    await expect(page.getByRole('button', { name: 'Odhlásit' })).toHaveCount(0)

    await page.goto('/moje-treninky?tab=minule')
    await expect(page.getByText('Zatím nemáte žádný absolvovaný trénink.')).toBeVisible()

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
    // §G1 (AC-266): the footer says the reason rather than offering a button
    // that fails.
    await expect(card.getByRole('button', { name: 'Obsazeno' })).toBeDisabled()
    await expect(card.getByRole('button', { name: 'Přihlásit' })).toHaveCount(0)
  })

  test("another family's athletes never appear (AC-091)", async ({ page }) => {
    const parent = uniqueEmail('cizinec')
    await signIn(page, parent)

    await page.goto('/moji-sportovci')
    await expect(page.getByText('Ivan Kotov')).toHaveCount(0)
    await expect(page.getByText('Anna Kotova')).toHaveCount(0)

    // D-01: and with no child anywhere, no workspace's sessions either. The
    // screen says the thing this parent can act on rather than "nothing is on".
    await page.goto('/treninky')
    await expect(
      page.getByText('Přidejte prvního sportovce a můžete začít rezervovat tréninky.'),
    ).toBeVisible()
    // Scoped to the page: the bottom navigation is a list of items too.
    await expect(page.locator('main li')).toHaveCount(0)
  })

  // The whole "Změněno" loop: the coach moves a training, the parent is told
  // what it used to be, and opening the booking is what stops telling them.
  test('a parent is told what the coach changed, once (AC-270)', async ({ page }) => {
    const parent = uniqueEmail('zmena')
    const coach = uniqueEmail('trener')
    const room = `Šatna ${Date.now()}`
    const sessionId = await openSession(coach, 10, room)

    await signIn(page, parent)
    await page.goto('/moji-sportovci/novy')
    await page.getByLabel('Jméno').fill('Petr')
    await page.getByLabel('Příjmení').fill('Kotov')
    await page.getByLabel('Datum narození').fill('2017-02-02')
    await page.getByLabel('Pozice').selectOption('CENTER')
    await page.getByLabel('Hůl').selectOption('LEFT')
    await page.getByRole('button', { name: 'Uložit' }).click()
    await expect(page.getByText('Petr Kotov')).toBeVisible()

    await page.goto('/treninky')
    await page
      .locator('li', { hasText: room })
      .first()
      .getByRole('button', { name: 'Přihlásit' })
      .click()
    await page.getByRole('dialog').getByRole('button', { name: 'Přihlásit' }).click()
    await expect(page.getByRole('status')).toContainText('Přihlášeno')

    // Booked at 09:00–10:00; the coach moves it an hour earlier.
    await moveSession(coach, sessionId, '08:00', '09:00')

    await page.goto('/moje-treninky')
    const card = page.locator('main li', { hasText: 'Petr Kotov' }).first()
    await expect(card).toContainText('Změněno')
    await expect(card).toContainText('08:00–09:00')
    // What it used to be, which is the part migration 28 exists for.
    await expect(card).toContainText('Původně 09:00–10:00')

    await card.getByRole('link').first().click()
    // Scoped to the page: the bottom navigation carries the same label.
    await expect(page.locator('main').getByRole('link', { name: 'Moje tréninky' })).toBeVisible()

    // §G6: the notice names the field and spells out both values.
    const notice = page.getByRole('status')
    await expect(notice).toContainText('Trenér změnil čas tréninku')
    await expect(notice).toContainText('Původně 09:00–10:00, nově 08:00–09:00.')

    // Opening it is what silences the badge — and only for this booking.
    await page.goto('/moje-treninky')
    await expect(page.locator('main li', { hasText: 'Petr Kotov' }).first()).not.toContainText(
      'Změněno',
    )
    // The training still says it moved; only the "new to you" flag is gone.
    await expect(page.locator('main li', { hasText: 'Petr Kotov' }).first()).toContainText(
      '08:00–09:00',
    )
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
