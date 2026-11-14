import { expect, test } from '@playwright/test'
import {
  asUser,
  fillAthleteForm,
  freshAthlete,
  pickRoom,
  sessionCard,
  dateInput,
  expectAccessible,
  grantCoach,
  signIn,
  tokenFor,
  uniqueEmail,
  SERVICE,
  STACK,
  joinClub,
  approveAthlete,
  joinClubInPage,
  approveFamily,
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
 * The returned id is the test's handle on its own session (`sessionCard`).
 * Every run shares one database and the projects run in parallel, so locating
 * a card by "Šatna 4" or by "1 / 1" finds another run's training — which is
 * how these first failed.
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
  const child = await freshAthlete()

  await joinClub(token)
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
        p_first_name: child.firstName,
        p_last_name: child.lastName,
        p_date_of_birth: child.dateOfBirth,
        p_workspace_id: workspaces[0]?.id,
        p_sport_code: 'HOCKEY',
        p_attributes: { position: child.position, stick_side: child.stickSide },
      }),
    })
  ).json()) as { ok?: boolean; data?: { athlete_id?: string } }
  await approveAthlete(created.data?.athlete_id)
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

/**
 * The coach takes one athlete off the training, through the domain function the
 * roster sheet calls — and gives a number first, so the parent has something to
 * ring (§G6d, decision 28).
 */
async function removeByCoach(
  coachEmail: string,
  sessionId: string,
  athleteName: string,
  phone: string | null,
): Promise<void> {
  const token = await tokenFor(coachEmail)
  const { profileId } = await grantCoach(coachEmail)

  // A real club names its coaches (migration 21); this one is a signup with no
  // name, and §G6d is about reading the name beside the number.
  await fetch(`${STACK}/rest/v1/app_profiles?id=eq.${profileId}`, {
    method: 'PATCH',
    headers: admin,
    body: JSON.stringify({ first_name: 'Milan', last_name: 'Filipi' }),
  })

  if (phone) {
    const stored = (await (
      await fetch(`${STACK}/rest/v1/rpc/set_own_staff_phone`, {
        method: 'POST',
        headers: asUser(token),
        body: JSON.stringify({ p_phone: phone }),
      })
    ).json()) as { ok?: boolean; code?: string }
    expect(stored.ok, `the coach could not record a number: ${stored.code}`).toBe(true)
  }

  const roster = (await (
    await fetch(
      `${STACK}/rest/v1/bookings?select=id,athletes(first_name,last_name)` +
        `&training_session_id=eq.${sessionId}&status=eq.CONFIRMED`,
      { headers: admin },
    )
  ).json()) as { id: string; athletes: { first_name: string; last_name: string } | null }[]

  const booking = roster.find(
    (row) => `${row.athletes?.first_name} ${row.athletes?.last_name}` === athleteName,
  )
  expect(booking, `${athleteName} is not on this roster`).toBeDefined()

  const removed = (await (
    await fetch(`${STACK}/rest/v1/rpc/cancel_booking_as_coach`, {
      method: 'POST',
      headers: asUser(token),
      body: JSON.stringify({ p_booking_id: booking?.id, p_reason: 'Zranění' }),
    })
  ).json()) as { ok?: boolean; code?: string }
  expect(removed.ok, `the removal failed: ${removed.code}`).toBe(true)
}

test.describe('a guardian, from first sign-in to a withdrawn booking', () => {
  // The whole path is one test on purpose. Split into four it would need four
  // sign-ins and four registrations, and it would stop proving the one thing
  // worth proving: that a parent can get from the start to the end.
  test('registers a child, books, sees the count, and withdraws', async ({ page }) => {
    const parent = uniqueEmail('rodic')
    const coach = uniqueEmail('trener')
    const room = `Šatna ${pickRoom()}`
    const sessionId = await openSession(coach, 10, room)

    // AC-001, AC-002: a code arrives and authenticates without a password.
    await signIn(page, parent)

    // D-10 is stated before the child is registered, not after.
    await page.goto('/moji-sportovci')
    await expect(
      page.getByText('Přidejte prvního sportovce a můžete začít rezervovat tréninky.'),
    ).toBeVisible()
    // Migration 50: a club is joined through its link (AC-321).
    await joinClubInPage(page)

    // AC-278 / AC-279: the first registration asks who the parent is, because the
    // coach's roster names whoever booked each child.
    await expect(page.getByText('Vaše údaje')).toBeVisible()
    await page.getByLabel('Jméno').first().fill('Milana')
    await page.getByLabel('Příjmení').first().fill('Kotova')
    await page.getByLabel('Telefon').fill('777 123 456')

    const ivan = await freshAthlete()
    await fillAthleteForm(page, ivan)
    await page.getByRole('button', { name: 'Přidat sportovce' }).click()

    await expect(page.getByText(ivan.name)).toBeVisible()
    // The club has not taken him yet; the administrator does (AC-322).
    await expect(page.getByText('Čeká na schválení')).toBeVisible()
    await page.goto('/treninky')
    await expect(page.getByText('Čekáme na schválení klubem')).toBeVisible()
    await approveFamily(parent)
    await page.goto('/moji-sportovci')

    // Asked once. A second child meets the same screen without the block.
    await page.goto('/moji-sportovci/novy')
    await expect(page.getByText('Vaše údaje')).toHaveCount(0)
    await page.goto('/moji-sportovci')

    // D-01: the workspace only becomes visible once a child belongs to it.
    await page.goto('/treninky')
    const card = sessionCard(page, sessionId)
    await expect(card).toBeVisible()
    await expect(card).toContainText('0 / 10')

    // guardian/SPEC.md §G1/§G2 (AC-268): the card opens the sheet, and a family
    // with one eligible child finds them already selected — one tap to confirm.
    await card.getByRole('button', { name: 'Přihlásit' }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet).toContainText('Koho chcete přihlásit?')
    await expect(sheet).toContainText(ivan.name)
    await sheet.getByRole('button', { name: 'Přihlásit' }).click()

    await expect(page.getByText('Přihlášeno', { exact: true })).toBeVisible()

    // The count comes from the projection, so it moving is the projection
    // having been maintained — not the client having decremented something.
    await expect(sessionCard(page, sessionId)).toContainText('1 / 10')

    // And the card now says who is in, without offering to book them twice.
    await expect(sessionCard(page, sessionId)).toContainText(`Přihlášen: ${ivan.name}`)
    await expect(
      sessionCard(page, sessionId).getByRole('button', { name: 'Přihlásit' }),
    ).toBeDisabled()

    // AC-279: read after booking on purpose. The coach of this training is now
    // a profile this guardian may also read, so an unfiltered profile query
    // returns two rows — and the failure renders as an empty form inviting the
    // parent to save their own name away.
    await page.goto('/ucet')
    await expect(page.getByText('Milana Kotova')).toBeVisible()
    await page.goto('/ucet/udaje')
    await expect(page.getByLabel('Jméno')).toHaveValue('Milana')
    await expect(page.getByLabel('Telefon')).toHaveValue('777 123 456')

    await page.goto('/moje-treninky')
    await expect(page.getByText(ivan.name)).toBeVisible()

    // v3.7: a new booking asks for an answer (guardian test 11).
    const mine = page.locator('main li').first()
    await expect(mine).toContainText('Potvrďte účast')
    await mine.getByRole('button', { name: 'Půjde', exact: true }).click()
    await expect(
      page.getByRole('status').filter({ hasText: `Potvrzeno: ${ivan.firstName} půjde` }),
    ).toBeVisible()
    await expect(mine).toContainText('Půjde · potvrzeno')

    // Withdrawing always says why (AC-040, decision 52): the reason sheet.
    await mine.getByRole('button', { name: 'Nepůjde' }).click()
    const reason = page.getByRole('dialog')
    await expect(reason).toContainText(`Proč ${ivan.firstName} nepůjde?`)
    await reason.getByRole('button', { name: 'Škola' }).click()
    await page.keyboard.type('výlet')
    await reason.getByRole('button', { name: `Odhlásit: ${ivan.firstName} nepůjde` }).click()

    await expect(page.getByRole('status').filter({ hasText: 'Odhlášeno' })).toBeVisible()

    // The booking is kept, not deleted (principle 9): it stays in
    // Nadcházející until the training ends, marked Nepůjde, and offers
    // nothing more to withdraw from. See docs/DESIGN_DEVIATIONS.md.
    const cancelled = page.locator('main li').first()
    await expect(cancelled).toContainText('Nepůjde')
    await expect(page.getByRole('group', { name: 'Účast' })).toHaveCount(0)

    await page.goto('/moje-treninky?tab=minule')
    await expect(page.getByText('Zatím nemáte žádný absolvovaný trénink.')).toBeVisible()

    await page.goto('/treninky')
    await expect(sessionCard(page, sessionId)).toContainText('0 / 10')
  })

  test('a full session offers no booking (AC-021)', async ({ page }) => {
    const parent = uniqueEmail('plny')
    const coach = uniqueEmail('trener')
    const room = `Šatna ${pickRoom()}`
    const sessionId = await openSession(coach, 1, room)
    await fillSession(sessionId)

    await signIn(page, parent)
    await joinClubInPage(page)
    // §G16 fields first: this parent has no name yet either.
    await page.getByLabel('Jméno').first().fill('Hana')
    await page.getByLabel('Příjmení').first().fill('Kotova')
    const anna = await freshAthlete()
    await fillAthleteForm(page, anna)
    await page.getByRole('button', { name: 'Přidat sportovce' }).click()
    await expect(page.getByText(anna.name)).toBeVisible()
    await approveFamily(parent)

    await page.goto('/treninky')
    const card = sessionCard(page, sessionId)
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
    // Nobody's child at all: every athlete in the database belongs to some
    // other family.
    await expect(page.locator('main li')).toHaveCount(0)

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
    const room = `Šatna ${pickRoom()}`
    const sessionId = await openSession(coach, 10, room)

    await signIn(page, parent)
    await joinClubInPage(page)
    await page.getByLabel('Jméno').first().fill('Jana')
    await page.getByLabel('Příjmení').first().fill('Kotova')
    const petr = await freshAthlete()
    await fillAthleteForm(page, petr)
    await page.getByRole('button', { name: 'Přidat sportovce' }).click()
    await expect(page.getByText(petr.name)).toBeVisible()
    await approveFamily(parent)

    await page.goto('/treninky')
    await sessionCard(page, sessionId).getByRole('button', { name: 'Přihlásit' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Přihlásit' }).click()
    await expect(page.getByRole('status')).toContainText('Přihlášeno')

    // Booked at 09:00–10:00; the coach moves it an hour earlier.
    await moveSession(coach, sessionId, '08:00', '09:00')

    await page.goto('/moje-treninky')
    const card = page.locator('main li', { hasText: petr.name }).first()
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
    await expect(page.locator('main li', { hasText: petr.name }).first()).not.toContainText(
      'Změněno',
    )
    // The training still says it moved; only the "new to you" flag is gone.
    await expect(page.locator('main li', { hasText: petr.name }).first()).toContainText(
      '08:00–09:00',
    )
  })

  /**
   * Test 7b (§G4b, §G6d, D-06). A removal the parent cannot undo: the card
   * states who can, the detail screen offers the coach, and booking the same
   * child again is refused by the domain function — not merely hidden.
   */
  test('a child the coach removed cannot be booked again (AC-042a)', async ({ page }) => {
    const parent = uniqueEmail('odebrani')
    const coach = uniqueEmail('trener')
    const room = `Šatna ${pickRoom()}`
    const sessionId = await openSession(coach, 10, room)

    await signIn(page, parent)
    await joinClubInPage(page)
    await page.getByLabel('Jméno').first().fill('Hana')
    await page.getByLabel('Příjmení').first().fill('Procházková')
    const eliska = await freshAthlete()
    await fillAthleteForm(page, eliska)
    await page.getByRole('button', { name: 'Přidat sportovce' }).click()
    // Saving uploads nothing but still waits on the server; under a full run
    // that can take longer than the default five seconds.
    await expect(page.getByText(eliska.name)).toBeVisible({ timeout: 15_000 })
    await approveFamily(parent)

    await page.goto('/treninky')
    await sessionCard(page, sessionId).getByRole('button', { name: 'Přihlásit' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Přihlásit' }).click()
    await expect(page.getByRole('status')).toContainText('Přihlášeno')

    await removeByCoach(coach, sessionId, eliska.name, '777 654 321')

    // §G4b: the orange badge, no strike-through, and no button at all.
    await page.goto('/moje-treninky')
    const card = page.locator('main li', { hasText: eliska.name }).first()
    await expect(card).toContainText('Odhlášeno trenérem')
    await expect(card).toContainText('Znovu přihlásit může jen trenér')
    await expect(card.getByRole('button')).toHaveCount(0)

    // §G6d: the coach instead of an action, with links that really dial.
    await card.getByRole('link').first().click()
    await expect(page.getByRole('status').first()).toContainText(
      'Trenér odhlásil sportovce z tréninku',
    )
    await expect(page.getByText('Zpráva od trenéra')).toBeVisible()
    await expect(page.getByText('Milan Filipi · 777 654 321')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Zavolat Milan Filipi' })).toHaveAttribute(
      'href',
      'tel:777654321',
    )
    await expect(page.getByRole('link', { name: 'Napsat SMS Milan Filipi' })).toHaveAttribute(
      'href',
      'sms:777654321',
    )
    await expect(page.getByRole('group', { name: 'Účast' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Přihlásit znovu' })).toHaveCount(0)

    // AC-292: the footer that replaced the button, with the coach to ring.
    await expectAccessible(page, '§G6d a booking the coach removed')

    // D-06: the training is open and has places, and this child still cannot go
    // back on it. The card says why rather than offering a button that fails.
    await page.goto('/treninky')
    const training = sessionCard(page, sessionId)
    await expect(training).toContainText('Sportovce odebral trenér')
    await expect(training.getByRole('button', { name: 'Přihlásit' })).toBeDisabled()
  })

  test('signing out ends the session (AC-002)', async ({ page }) => {
    await signIn(page, uniqueEmail('odhlaseni'))
    await page.goto('/ucet')
    // The full sentence, and a confirmation: `Odhlásit` on its own means
    // cancelling a training in this product (§G13).
    await page.getByRole('button', { name: 'Odhlásit se z aplikace' }).click()
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Odhlásit se', exact: true })
      .click()
    await page.waitForURL(/\/prihlaseni$/)

    // Not merely redirected: the protected page is gone too.
    await page.goto('/moji-sportovci')
    await expect(page).toHaveURL(/\/prihlaseni$/)
  })
})
