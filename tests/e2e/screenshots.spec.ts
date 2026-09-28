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

async function shoot(page: Page, name: string) {
  // A screenshot does not wait for images. Without this the mark is caught
  // half-fetched and the review is done against an empty plate.
  await page.waitForFunction(() =>
    [...document.images].every((image) => image.complete && image.naturalWidth > 0),
  )
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true })
}

test('the organization screens, with a mark and without', async ({ page, browser }) => {
  await resetOrganization()

  const admin = uniqueEmail('spravce')
  await signIn(page, admin)
  await grantWorkspaceRole(admin, 'WORKSPACE_ADMIN')

  // Without a mark first: this is the state a club starts in.
  await page.goto('/trener/organizace')
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

  await page.goto('/trener/organizace')
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
