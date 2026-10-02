import { expect, test } from '@playwright/test'
import {
  asUser,
  dateInput,
  grantCoach,
  profileFor,
  signIn,
  tokenFor,
  uniqueEmail,
  SERVICE,
  STACK,
} from './helpers'

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

/**
 * Moves a training into the past, which no interface can do and nothing should.
 *
 * `create_training_session` refuses a date that has already happened, and
 * rightly — but `Minulé` cannot be tested without one, so the test does the one
 * thing only the service role can: it moves the clock under the training.
 */
async function moveToPast(sessionId: string): Promise<void> {
  // Two hours ago, not yesterday: every run against this shared database leaves
  // its own finished trainings behind, the list is newest first and capped, and
  // a pile of them stamped `yesterday 09:00` sorts by nothing at all. The one
  // this test is about has to be the most recent.
  const start = new Date(Date.now() - 2 * 3_600_000).toISOString()
  const end = new Date(Date.now() - 3_600_000).toISOString()

  const response = await fetch(`${STACK}/rest/v1/training_sessions?id=eq.${sessionId}`, {
    method: 'PATCH',
    headers: {
      apikey: SERVICE,
      authorization: `Bearer ${SERVICE}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ start_at: start, end_at: end }),
  })
  expect(response.ok, `could not move the training: ${response.status}`).toBe(true)
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

    // §K1/§K10 (AC-273): the FAB asks which kind of training before the form,
    // because a single session and a season of Sundays are different jobs.
    await page.getByRole('button', { name: 'Vytvořit', exact: true }).click()
    await page.getByRole('dialog').getByRole('link', { name: 'Trénink Jeden termín' }).click()
    await page.getByLabel('Datum').fill(dateInput(14))
    await page.getByLabel('Začátek').fill('17:00')
    await page.getByLabel('Konec').fill('18:00')
    await page.getByLabel('Kapacita', { exact: true }).fill('2')
    // Unique per run: the projects run in parallel against one database, so a
    // fixed room name finds the other run's training.
    const room = `Šatna ${Date.now()}`
    await page.getByLabel('Šatna').fill(room)
    await page.getByRole('button', { name: 'Vytvořit trénink' }).click()

    await expect(page.getByText(room)).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Sportovci 0' })).toBeVisible()

    const sessionUrl = page.url()
    const sessionId = sessionUrl.split('/trener/')[1]?.split('/')[0] ?? ''
    expect(sessionId).not.toBe('')

    // Two families book, which is what makes the roster worth reading. A third
    // registers without booking, so the coach's picker has someone to offer.
    await family('Adam', { bookInto: sessionId })
    await family('Bohdan', { bookInto: sessionId })
    await family('Cyril')

    await page.reload()
    await expect(page.getByRole('heading', { name: 'Sportovci 2' })).toBeVisible()
    await expect(page.getByText('Adam Hráč', { exact: true })).toBeVisible()
    await expect(page.getByText('Bohdan Hráč', { exact: true })).toBeVisible()
    // BR-092: who booked each child, which no row policy would let a coach
    // read. Masculine participle for everyone (DESIGN_SYSTEM §8).
    await expect(page.getByText(/Přihlásil /).first()).toBeVisible()

    // §K2 (AC-274): the athlete sheet is where a coach reaches the family.
    // AC-254 — the number is readable here and nowhere else.
    await page.getByRole('button', { name: /Adam Hráč/ }).click()
    const athlete = page.getByRole('dialog')
    await expect(athlete).toContainText('Rodič')
    await expect(athlete).toContainText('Telefon')
    await athlete.getByRole('button', { name: 'Zavřít' }).click()

    // AC-050: the session is full, so adding by hand is refused until the coach
    // confirms, and the dialog quotes the server's own numbers.
    await page.getByRole('button', { name: '+ Přidat sportovce' }).click()
    const adding = page.getByRole('dialog')
    // The row, not the input: the control is visually hidden inside its label,
    // which is what a thumb hits. Both projects run against one database, so
    // another run's "Cyril Hráč" is in the workspace too; the roster below is
    // per session and unambiguous.
    await adding.locator('label', { hasText: 'Cyril' }).first().click()
    await adding.getByRole('button', { name: /Přidat 1 sportovce/ }).click()

    const override = page.getByRole('alertdialog')
    await expect(override).toContainText('Trénink je již plný')
    await expect(override).toContainText('Chcete sportovce přidat nad stanovenou kapacitu?')
    await override.getByRole('button', { name: 'Přidat', exact: true }).click()

    await expect(page.getByRole('heading', { name: 'Sportovci 3' })).toBeVisible()
    await expect(page.getByText('Cyril Hráč', { exact: true })).toBeVisible()

    // D-06 (AC-275): removing sends the parent an e-mail and frees the place;
    // the coach's own message can go with it (§G6d).
    await page.getByRole('button', { name: /Cyril Hráč/ }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Odhlásit z tréninku' }).click()

    const removal = page.getByRole('alertdialog')
    await expect(removal).toContainText('Odhlásit sportovce z tréninku?')
    await expect(removal).toContainText('Rodič dostane e-mail.')
    await removal.getByLabel('Zpráva pro rodiče').fill('Zranění')
    await removal.getByRole('button', { name: 'Odhlásit', exact: true }).click()

    // By its words: a Notice on the page is a status region too.
    await expect(page.getByText('Sportovec odhlášen')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Sportovci 2' })).toBeVisible()
    // BR-044: nothing is deleted, so the removal stays on the record.
    await page.getByText(/Odebraní a odhlášení/).click()
    await expect(page.getByText('Odebral trenér').first()).toBeVisible()
  })

  /**
   * Coach test 10 (§K1, §K14). The past is behind the same switch a parent has,
   * and a finished training reports who was booked — never a meter, which would
   * report free places that no longer exist, and never anything that could read
   * as who actually came.
   */
  test('the past is a tab, and it counts rather than measures (AC-285)', async ({ page }) => {
    const coach = uniqueEmail('trener.minule')
    await signIn(page, coach)
    await grantCoach(coach)

    await page.goto('/trener/novy')
    await page.getByLabel('Datum').fill(dateInput(10))
    await page.getByLabel('Začátek').fill('09:00')
    await page.getByLabel('Konec').fill('10:00')
    await page.getByLabel('Kapacita', { exact: true }).fill('10')
    const room = `Šatna ${Date.now()}`
    await page.getByLabel('Šatna').fill(room)
    await page.getByRole('button', { name: 'Vytvořit trénink' }).click()

    await expect(page.getByText(room)).toBeVisible()
    const sessionId = page.url().split('/trener/')[1]?.split('/')[0] ?? ''
    await family('Dalibor', { bookInto: sessionId })
    await moveToPast(sessionId)

    await page.goto('/trener')
    const tabs = page.getByRole('tablist')
    await expect(tabs).toBeVisible()
    // Finished, so it is not on the list a coach opens the app for.
    await expect(page.locator('main').getByText(room)).toHaveCount(0)

    await tabs.getByRole('tab', { name: 'Minulé' }).click()
    const row = page.locator('main li', { hasText: room })
    await expect(row).toBeVisible()
    await expect(row).toContainText('1')
    await expect(row).toContainText('přihlášený')
    // No meter, no `1 / 10`: free places mean nothing once it is over.
    await expect(row.getByRole('meter')).toHaveCount(0)
    await expect(row).not.toContainText('/')
    // Nothing is created from the past.
    await expect(page.getByRole('button', { name: 'Vytvořit', exact: true })).toHaveCount(0)

    await page.getByRole('tab', { name: 'Nadcházející' }).click()
    await expect(page.locator('main').getByText(room)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Vytvořit', exact: true })).toBeVisible()
  })

  /**
   * Coach tests 11 and 12 (§K12, §K13). The tab that had no design is now the
   * one a coach uses to find a child and reach their family — and the note on
   * that screen is the one thing on it a parent must never see.
   */
  test('the athletes tab finds a child by their parent, and keeps the note (AC-286)', async ({
    page,
  }) => {
    const coach = uniqueEmail('trener.sportovci')
    await signIn(page, coach)
    await grantCoach(coach)

    // A family of this run's own, so the shared database's other athletes do
    // not decide what the assertions below find.
    const run = Date.now()
    const parentEmail = uniqueEmail('rodic.hledani')
    const token = await tokenFor(parentEmail)
    const workspaces = (await (
      await fetch(`${STACK}/rest/v1/rpc/joinable_workspaces`, {
        method: 'POST',
        headers: asUser(token),
        body: '{}',
      })
    ).json()) as { id: string }[]

    await fetch(`${STACK}/rest/v1/app_profiles?id=eq.${await profileFor(parentEmail)}`, {
      method: 'PATCH',
      headers: {
        apikey: SERVICE,
        authorization: `Bearer ${SERVICE}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        first_name: 'Hana',
        last_name: `Řezníčková${run}`,
        phone: '777111222',
      }),
    })

    const created = (await (
      await fetch(`${STACK}/rest/v1/rpc/create_athlete_with_guardian`, {
        method: 'POST',
        headers: asUser(token),
        body: JSON.stringify({
          p_first_name: 'Eliška',
          p_last_name: `Dítě${run}`,
          p_date_of_birth: '2017-05-05',
          p_workspace_id: workspaces[0]?.id,
          p_sport_code: 'HOCKEY',
          p_attributes: { position: 'GOALIE', stick_side: 'LEFT' },
        }),
      })
    ).json()) as { ok?: boolean; data?: { athlete_id?: string } }
    expect(created.ok).toBe(true)

    await page.goto('/trener/sportovci')
    await expect(page.getByRole('heading', { name: 'Sportovci', level: 1 })).toBeVisible()

    // The search matches the parent, not only the child: a coach who met the
    // family remembers the parent's name as often as the child's. And it
    // ignores diacritics, because "Řezníčková" is not what anyone types.
    await page.getByRole('searchbox').fill(`reznickova${run}`)
    const row = page.locator('main li', { hasText: `Eliška Dítě${run}` })
    await expect(row).toBeVisible()
    await expect(row).toContainText('Brankář')
    await expect(row).toContainText('bez přihlášek')

    await row.getByRole('link').click()
    await expect(page.getByRole('heading', { name: `Eliška Dítě${run}` })).toBeVisible()
    await expect(page.getByText('Ročník 2017 · narozen 5. 5. 2017')).toBeVisible()

    // §K13: the family, with the number a coach may ring.
    await expect(page.getByText(`Hana Řezníčková${run}`)).toBeVisible()
    await expect(page.getByRole('link', { name: `Zavolat Hana Řezníčková${run}` })).toHaveAttribute(
      'href',
      'tel:777111222',
    )

    // The note. D-13: the one thing on this screen a parent must never read.
    await page.getByRole('button', { name: 'Upravit poznámku' }).click()
    await page.getByLabel('INTERNÍ POZNÁMKA · JEN TRENÉŘI').fill('Alergie na ořechy.')
    await page.getByRole('button', { name: 'Uložit' }).click()
    await expect(page.getByText('Alergie na ořechy.')).toBeVisible()

    // Read back by the parent, through their own session: the athlete screen
    // they have, and the API besides. Neither carries it.
    const noteForParent = await fetch(
      `${STACK}/rest/v1/athlete_internal_notes?athlete_id=eq.${created.data?.athlete_id}`,
      { headers: asUser(token) },
    )
    expect(await noteForParent.json()).toEqual([])
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
    await expect(page.getByRole('button', { name: 'Vytvořit', exact: true })).toHaveCount(0)
    await expect(page.getByText(/Sportovci \d/)).toHaveCount(0)
  })

  test('closing booking holds guardians off but not the coach (BR-030)', async ({ page }) => {
    const coach = uniqueEmail('trener')
    await signIn(page, coach)
    await grantCoach(coach)

    await page.goto('/trener/novy')
    await page.getByLabel('Datum').fill(dateInput(15))
    await page.getByLabel('Začátek').fill('18:00')
    await page.getByLabel('Konec').fill('19:00')
    await page.getByLabel('Kapacita', { exact: true }).fill('10')
    const room = `Šatna ${Date.now()}`
    await page.getByLabel('Šatna').fill(room)
    await page.getByRole('button', { name: 'Vytvořit trénink' }).click()
    await expect(page.getByText(room)).toBeVisible()

    // §K5 (AC-275): reversible, so the sheet says what it does and does not do
    // before it happens — including that it can be reopened.
    await page.getByRole('button', { name: 'Zavřít přihlašování' }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet).toContainText('Noví sportovci se už nebudou moci přihlásit.')
    await expect(sheet).toContainText('Přihlašování můžete kdykoli znovu otevřít')
    await sheet.getByRole('button', { name: 'Zavřít přihlašování' }).click()

    await expect(page.getByText('Přihlašování uzavřeno').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Otevřít přihlašování' })).toBeVisible()

    // The roster controls stay: a closed session is what a coach closes in
    // order to finish the list themselves (BR-030).
    await expect(page.getByRole('button', { name: '+ Přidat sportovce' })).toBeVisible()
  })
})
