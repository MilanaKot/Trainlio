import { test, expect, type Page } from '@playwright/test'
import {
  asUser,
  dateInput,
  grantCoach,
  grantWorkspaceRole,
  resetOrganization,
  signIn,
  tokenFor,
  uniqueEmail,
  STACK,
} from './helpers'

/** A child booked into a training, so the edit screen has somebody to warn about. */
async function bookedAthlete(firstName: string, birthYear: number, sessionId: string) {
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
  ).json()) as { data?: { athlete_id?: string } }

  await fetch(`${STACK}/rest/v1/rpc/book_athletes_as_guardian`, {
    method: 'POST',
    headers: asUser(token),
    body: JSON.stringify({
      p_training_session_id: sessionId,
      p_athlete_ids: [created.data?.athlete_id],
    }),
  })
}

/**
 * The design-review screenshots (admin/SPEC.md "Done when").
 *
 * Not an assertion of anything, which is why it is skipped unless asked for:
 *
 *   SCREENSHOTS=1 npx playwright test tests/e2e/screenshots.spec.ts --project=mobile
 *
 * It leaves PNGs in ./screenshots at the phone viewport the design is drawn
 * for, and puts the club's row back the way it found it.
 */
test.describe.configure({ mode: 'serial' })

const OUT = 'screenshots'

test.skip(!process.env.SCREENSHOTS, 'Run with SCREENSHOTS=1 to regenerate the design review set.')

async function shoot(page: Page, name: string, { full = true }: { full?: boolean } = {}) {
  // A screenshot does not wait for images. Without this the mark is caught
  // half-fetched and the review is done against an empty plate.
  await page.waitForFunction(() =>
    [...document.images].every((image) => image.complete && image.naturalWidth > 0),
  )
  // A list screen is shot at the viewport: full-page on a database with two
  // hundred trainings in it produces a ten-megabyte image of test residue,
  // which is not what anybody reviews.
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full })
}

test('the organization screens, with a mark and without', async ({ page, browser }) => {
  await resetOrganization()

  const admin = uniqueEmail('spravce')
  await signIn(page, admin)
  await grantWorkspaceRole(admin, 'WORKSPACE_ADMIN')

  // Without a mark first: this is the state a club starts in.
  await page.goto('/trener/vice/organizace')
  await expect(page.getByRole('heading', { name: 'Organizace' })).toBeVisible()
  await shoot(page, 'A4b-organizace-bez-loga')

  const guardianless = await browser.newContext()
  const anonymous = await guardianless.newPage()
  await anonymous.goto('/prihlaseni')
  await expect(anonymous.getByText('Rezervace tréninků')).toBeVisible()
  await shoot(anonymous, 'G11-prihlaseni-bez-loga')
  await guardianless.close()

  const before = await browser.newContext()
  const parentBefore = await before.newPage()
  await signIn(parentBefore, uniqueEmail('rodic'))
  await parentBefore.goto('/treninky')
  await expect(parentBefore.getByRole('heading', { name: 'Tréninky' })).toBeVisible()
  await shoot(parentBefore, 'G1-treninky-bez-loga')
  await before.close()

  // Now give it one, through the sheet a person would use.
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 480
    canvas.height = 480
    const context = canvas.getContext('2d')
    if (!context) throw new Error('no 2d context')
    context.fillStyle = '#0e3a7a'
    context.beginPath()
    context.moveTo(240, 40)
    context.lineTo(420, 110)
    context.lineTo(420, 260)
    context.quadraticCurveTo(420, 400, 240, 450)
    context.quadraticCurveTo(60, 400, 60, 260)
    context.lineTo(60, 110)
    context.closePath()
    context.fill()
    context.strokeStyle = '#c8102e'
    context.lineWidth = 26
    context.beginPath()
    context.moveTo(110, 200)
    context.lineTo(370, 200)
    context.moveTo(110, 260)
    context.lineTo(370, 260)
    context.stroke()
    return canvas.toDataURL('image/png')
  })

  await page.locator('input[type="file"]').setInputFiles({
    name: 'znak.png',
    mimeType: 'image/png',
    buffer: Buffer.from(dataUrl.split(',')[1] ?? '', 'base64'),
  })

  await expect(page.getByRole('heading', { name: 'Upravit logo' })).toBeVisible()
  await shoot(page, 'A5-upravit-logo')

  await page.getByRole('button', { name: 'Použít logo' }).click()
  await page.getByRole('button', { name: 'Uložit' }).click()
  await expect(page.getByText('Uloženo')).toBeVisible()

  await page.goto('/trener/vice/organizace')
  await expect(page.locator('main img')).toBeVisible()
  await shoot(page, 'A4-organizace-s-logem')

  const visitor = await browser.newContext()
  const withLogo = await visitor.newPage()
  await withLogo.goto('/prihlaseni')
  await expect(withLogo.locator('header img')).toBeVisible()
  await shoot(withLogo, 'G11-prihlaseni-s-logem')
  await visitor.close()

  const after = await browser.newContext()
  const parentAfter = await after.newPage()
  await signIn(parentAfter, uniqueEmail('rodic'))
  await parentAfter.goto('/treninky')
  await expect(parentAfter.locator('header img')).toBeVisible()
  await shoot(parentAfter, 'G1-treninky-s-logem')
  await after.close()

  await resetOrganization()
})

test('the create and edit form (§K3)', async ({ page }) => {
  const coach = uniqueEmail('trener')
  await signIn(page, coach)
  await grantCoach(coach)

  await page.goto('/trener/novy')
  await expect(page.getByRole('heading', { name: 'Nový trénink' })).toBeVisible()
  await shoot(page, 'K3-novy-trenink')

  await page.getByLabel('Datum').fill(dateInput(21))
  await page.getByLabel('Šatna').fill('Šatna 4')
  await page.getByRole('button', { name: 'Vytvořit trénink' }).click()
  await expect(page.getByText('Šatna 4')).toBeVisible()

  const sessionId = page.url().split('/trener/')[1]?.split('/')[0] ?? ''
  await bookedAthlete('Petr', 2017, sessionId)

  await page.goto(`/trener/${sessionId}/upravit`)
  await page.getByLabel('Začátek').fill('18:30')
  await expect(page.getByText('Změnil se čas.')).toBeVisible()
  await shoot(page, 'K3-upravit-trenink')

  await page.getByRole('button', { name: '+ Přidat asistenta' }).click()
  await expect(page.getByRole('heading', { name: 'Asistenti' })).toBeVisible()
  await shoot(page, 'K3b-asistenti')
})

test('the coach tabs (§K1, §A0)', async ({ page }) => {
  const admin = uniqueEmail('spravce')
  await signIn(page, admin)
  await grantWorkspaceRole(admin, 'WORKSPACE_ADMIN')

  await page.goto('/trener')
  await expect(page.getByRole('heading', { name: 'Tréninky' })).toBeVisible()
  await shoot(page, 'K1-treninky-trener', { full: false })

  await page.goto('/trener/sportovci')
  await expect(page.getByRole('heading', { name: 'Sportovci' })).toBeVisible()
  await shoot(page, 'K-sportovci', { full: false })

  await page.goto('/trener/vice')
  await expect(page.getByRole('heading', { name: 'Více' })).toBeVisible()
  await shoot(page, 'A0-vice')
})

test('the coaching staff (§A1, §A3)', async ({ page }) => {
  const admin = uniqueEmail('spravce')
  await signIn(page, admin)
  await grantWorkspaceRole(admin, 'WORKSPACE_ADMIN')

  await page.goto('/trener/vice/treneri')
  await expect(page.getByRole('heading', { name: 'Trenéři' })).toBeVisible()
  await shoot(page, 'A1-treneri', { full: false })

  await page.goto('/trener/vice/treneri/novy')
  await expect(page.getByRole('heading', { name: 'Nový trenér' })).toBeVisible()
  await shoot(page, 'A2-novy-trener')
})

test('the parent’s children (§G7, §G8, §G9)', async ({ page }) => {
  const parent = uniqueEmail('rodic')
  await signIn(page, parent)

  await page.goto('/moji-sportovci')
  await expect(page.getByRole('heading', { name: 'Moji sportovci' })).toBeVisible()
  await shoot(page, 'G7-sportovci-prazdne')

  await page.goto('/moji-sportovci/novy')
  await page.getByLabel('Jméno').first().fill('Milana')
  await page.getByLabel('Příjmení').first().fill('Kotova')
  await page.getByLabel('Telefon').fill('777 123 456')
  await page.getByLabel('Jméno').last().fill('Ivan')
  await page.getByLabel('Příjmení').last().fill('Kotov')
  await page.getByLabel('Datum narození').fill('2017-06-08')
  await page.getByRole('radio', { name: 'Centr' }).click()
  await page.getByRole('radio', { name: 'Levá' }).click()
  await shoot(page, 'G10-novy-sportovec')

  await page.getByRole('button', { name: 'Přidat sportovce' }).click()
  await expect(page.getByText('Ivan Kotov')).toBeVisible()
  await shoot(page, 'G7-sportovci')

  await page.getByRole('link', { name: /Ivan Kotov/ }).click()
  await expect(page.getByRole('heading', { name: 'Ivan Kotov' })).toBeVisible()
  await shoot(page, 'G8-profil-sportovce')

  await page.getByRole('link', { name: 'Upravit' }).click()
  await expect(page.getByRole('heading', { name: 'Upravit sportovce' })).toBeVisible()
  await shoot(page, 'G9-upravit-sportovce')
})

test('the parent’s account (§G13, §G16)', async ({ page }) => {
  const parent = uniqueEmail('rodic')
  await signIn(page, parent)

  await page.goto('/ucet/udaje')
  await page.getByLabel('Jméno').fill('Milana')
  await page.getByLabel('Příjmení').fill('Kotova')
  await page.getByLabel('Telefon').fill('777 123 456')
  await shoot(page, 'G16-upravit-udaje')

  await page.getByRole('button', { name: 'Uložit' }).click()
  await expect(page.getByRole('heading', { name: 'Účet' })).toBeVisible()
  await shoot(page, 'G13-ucet')
})

test('a season and a copy of it (§K11, §K4b)', async ({ page }) => {
  const coach = uniqueEmail('trener')
  await signIn(page, coach)
  await grantCoach(coach)

  await page.goto('/trener/serie/nova')
  await expect(page.getByRole('heading', { name: 'Série tréninků' })).toBeVisible()
  await shoot(page, 'K11-serie')

  await page.goto('/trener/novy')
  await page.getByLabel('Datum').fill(dateInput(14))
  await page.getByLabel('Šatna').fill('Šatna 4')
  await page.getByRole('button', { name: 'Vytvořit trénink' }).click()
  await expect(page.getByText('Šatna 4')).toBeVisible()
  const sessionId = page.url().split('/trener/')[1]?.split('/')[0] ?? ''

  await page.goto(`/trener/serie/nova?from=${sessionId}`)
  await expect(page.getByText('ZKOPÍRUJE SE')).toBeVisible()
  await shoot(page, 'K4b-duplikovat-obdobi')
})

test('a booking a parent holds (§G4, §G6)', async ({ page, browser }) => {
  // Two sign-ins, a training, a child and a booking: more than the default 30s.
  test.setTimeout(120_000)

  // A training to book into, opened by a coach in a context of their own.
  const coachContext = await browser.newContext()
  const coachPage = await coachContext.newPage()
  const coach = uniqueEmail('trener')
  await signIn(coachPage, coach)
  await grantCoach(coach)
  await coachPage.goto('/trener/novy')
  await coachPage.getByLabel('Datum').fill(dateInput(9))
  await coachPage.getByLabel('Šatna').fill('Šatna 4')
  await coachPage.getByRole('button', { name: 'Vytvořit trénink' }).click()
  await expect(coachPage.getByText('Šatna 4')).toBeVisible()
  await coachContext.close()

  await signIn(page, uniqueEmail('rodic'))

  await page.goto('/moji-sportovci/novy')
  await page.getByLabel('Jméno').first().fill('Milana')
  await page.getByLabel('Příjmení').first().fill('Kotova')
  await page.getByLabel('Jméno').last().fill('Ivan')
  await page.getByLabel('Příjmení').last().fill('Kotov')
  await page.getByLabel('Datum narození').fill('2017-06-08')
  await page.getByRole('radio', { name: 'Centr' }).click()
  await page.getByRole('radio', { name: 'Levá' }).click()
  await page.getByRole('button', { name: 'Přidat sportovce' }).click()
  await expect(page.getByText('Ivan Kotov')).toBeVisible()

  await page.goto('/treninky')
  const card = page.locator('main li', { hasText: 'Šatna 4' }).first()
  await card.getByRole('button', { name: 'Přihlásit' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Přihlásit' }).click()
  await expect(page.getByText('Přihlášeno', { exact: true })).toBeVisible()
  await shoot(page, 'G1-treninky-s-prihlaskou', { full: false })

  await page.goto('/moje-treninky')
  await expect(page.getByText('Ivan Kotov').first()).toBeVisible()
  await shoot(page, 'G4-moje-treninky', { full: false })

  await page.locator('main li').first().getByRole('link').first().click()
  await expect(page.getByText('INFORMACE PRO SPORTOVCE')).toBeVisible()
  await shoot(page, 'G6-detail-prihlasky')
})

test('the booking sheet, with room and without (§G2, §G3)', async ({ page, browser }) => {
  test.setTimeout(120_000)

  // A training with exactly one place, so the sheet has both states to show.
  const coachContext = await browser.newContext()
  const coachPage = await coachContext.newPage()
  const coach = uniqueEmail('trener')
  await signIn(coachPage, coach)
  await grantCoach(coach)
  await coachPage.goto('/trener/novy')
  await coachPage.getByLabel('Datum').fill(dateInput(11))
  await coachPage.getByLabel('Kapacita', { exact: true }).fill('1')
  // A plain room name: this spec runs on a database reset for it, so nothing
  // else is on the board to confuse it with.
  const room = 'Šatna 2'
  await coachPage.getByLabel('Šatna').fill(room)
  await coachPage.getByRole('button', { name: 'Vytvořit trénink' }).click()
  await expect(coachPage.getByText(room)).toBeVisible()
  await coachContext.close()

  await signIn(page, uniqueEmail('rodic'))

  for (const [first, born] of [
    ['Ivan', '2017-06-08'],
    ['Anna', '2018-03-14'],
  ] as const) {
    await page.goto('/moji-sportovci/novy')
    if (first === 'Ivan') {
      await page.getByLabel('Jméno').first().fill('Milana')
      await page.getByLabel('Příjmení').first().fill('Kotova')
    }
    await page.getByLabel('Jméno').last().fill(first)
    await page
      .getByLabel('Příjmení')
      .last()
      .fill(first === 'Anna' ? 'Kotová' : 'Kotov')
    await page.getByLabel('Datum narození').fill(born)
    await page.getByRole('radio', { name: 'Centr' }).click()
    await page.getByRole('radio', { name: 'Levá' }).click()
    await page.getByRole('button', { name: 'Přidat sportovce' }).click()
    await expect(page.getByText(new RegExp(first))).toBeVisible()
  }

  await page.goto('/treninky')
  const card = page.locator('main li', { hasText: room }).first()
  await card.getByRole('button', { name: 'Přihlásit' }).click()
  await expect(page.getByRole('dialog')).toContainText('Koho chcete přihlásit?')
  await shoot(page, 'G2-prihlaseni', { full: false })

  // Two children, one place: §G3 says so rather than failing on submit.
  const sheet = page.getByRole('dialog')
  await sheet.getByText('Ivan Kotov').click()
  await sheet.getByText('Anna Kotová').click()
  await expect(sheet).toContainText('Není dostatek volných míst')
  await shoot(page, 'G3-malo-mist', { full: false })
})
