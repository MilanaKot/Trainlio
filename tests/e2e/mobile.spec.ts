import { expect, test, type Page } from '@playwright/test'
import { dateInput, grantCoach, signIn, tokenFor, uniqueEmail, asUser, STACK } from './helpers'

/**
 * Mobile viewport review.
 *
 * CLAUDE.md's first engineering principle is mobile-first, and the guardian
 * flows are specified for a phone. These run only on the phone project and
 * check the two things that actually break a page on one: content wider than
 * the screen, and controls too small to hit with a thumb.
 *
 * 44 CSS pixels is the size below which a target is unreliable for an adult
 * thumb; the interface is built to 44 and mostly to 48 (`min-h-11`, `min-h-12`).
 *
 * The desktop project skips this file (playwright.config.ts): at 1280px these
 * assertions are trivially true and would pass while testing nothing.
 */

const MIN_TAP = 44

/** Content wider than the viewport means a horizontal scrollbar on a phone. */
async function expectNoHorizontalScroll(page: Page, where: string) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(
    overflow.scrollWidth,
    `${where} scrolls sideways: ${overflow.scrollWidth}px of content in ${overflow.clientWidth}px`,
  ).toBeLessThanOrEqual(overflow.clientWidth + 1)
}

/**
 * Every visible control is thumb-sized.
 *
 * Checked on what rendered rather than on the class names, so a Tailwind class
 * that was overridden, or a control someone added without one, is caught.
 */
async function expectTappableControls(page: Page, where: string) {
  const controls = page.locator(
    'button:visible, a[href]:visible, select:visible, input:not([type="hidden"]):visible',
  )
  const count = await controls.count()
  expect(count, `${where} has no controls to check`).toBeGreaterThan(0)

  const tooSmall: string[] = []
  for (let i = 0; i < count; i += 1) {
    const control = controls.nth(i)

    // A checkbox or radio is drawn small on purpose and is hit through the
    // label wrapping it — so the label is what gets measured. Skipping them
    // instead would excuse the one control most likely to be too small.
    const type = await control.getAttribute('type')
    const target =
      type === 'checkbox' || type === 'radio'
        ? control.locator('xpath=ancestor::label[1]')
        : control

    const box = await ((await target.count()) > 0 ? target : control).boundingBox()
    if (!box) continue
    if (box.height < MIN_TAP) {
      const label =
        (await control.innerText()).trim() ||
        (await control.getAttribute('aria-label')) ||
        (await control.getAttribute('name')) ||
        (await control.getAttribute('type')) ||
        (await control.evaluate(
          (el) =>
            el.tagName.toLowerCase() +
            (el.className ? '.' + String(el.className).split(' ')[0] : ''),
        ))
      tooSmall.push(`${label.slice(0, 50)}: ${Math.round(box.height)}px`)
    }
  }

  expect(tooSmall, `${where} has controls under ${MIN_TAP}px tall`).toEqual([])
}

async function openSession(coachEmail: string, changingRoom: string): Promise<string> {
  const token = await tokenFor(coachEmail)
  const { workspaceId, profileId } = await grantCoach(coachEmail)

  const facilities = (await (
    await fetch(`${STACK}/rest/v1/facilities?select=id,code`, { headers: asUser(token) })
  ).json()) as { id: string; code: string }[]

  const created = (await (
    await fetch(`${STACK}/rest/v1/rpc/create_training_session`, {
      method: 'POST',
      headers: asUser(token),
      body: JSON.stringify({
        p_workspace_id: workspaceId,
        p_local_date: dateInput(18),
        p_local_start_time: '09:00',
        p_local_end_time: '10:00',
        p_facility_id: facilities.find((f) => f.code === 'MH')?.id,
        p_capacity: 10,
        p_eligibility_mode: 'ALL',
        p_changing_room: changingRoom,
        // A long note is the realistic way a page grows wider than a phone.
        p_public_notes:
          'Vezměte si prosím chrániče, láhev s pitím a náhradní dres. Sraz je patnáct minut před začátkem u vchodu do haly.',
        p_main_coach_profile_id: profileId,
      }),
    })
  ).json()) as { ok?: boolean; data?: { training_session_id?: string } }

  expect(created.ok).toBe(true)
  return created.data?.training_session_id ?? ''
}

test.describe('on a phone', () => {
  test('the guardian screens fit and are tappable', async ({ page }) => {
    const room = `Šatna ${Date.now()}`
    await openSession(uniqueEmail('trener'), room)

    await page.goto('/prihlaseni')
    await expectNoHorizontalScroll(page, 'sign-in')
    await expectTappableControls(page, 'sign-in')

    await signIn(page, uniqueEmail('rodic'))

    await page.goto('/moji-sportovci')
    await expectNoHorizontalScroll(page, 'my athletes (empty)')
    await expectTappableControls(page, 'my athletes (empty)')

    await page.goto('/moji-sportovci/novy')
    await expectNoHorizontalScroll(page, 'new athlete')
    await expectTappableControls(page, 'new athlete')

    await page.getByLabel('Jméno').fill('Ivan')
    await page.getByLabel('Příjmení').fill('Kotov')
    await page.getByLabel('Datum narození').fill('2017-10-23')
    await page.getByLabel('Pozice').selectOption('CENTER')
    await page.getByLabel('Hůl').selectOption('LEFT')
    await page.getByRole('button', { name: 'Uložit' }).click()
    await expect(page.getByText('Ivan Kotov')).toBeVisible()

    await expectNoHorizontalScroll(page, 'my athletes')
    await expectTappableControls(page, 'my athletes')

    await page.goto('/treninky')
    await expect(page.getByText(room)).toBeVisible()
    await expectNoHorizontalScroll(page, 'sessions')
    await expectTappableControls(page, 'sessions')

    const card = page.locator('li', { hasText: room }).first()
    await card.getByRole('checkbox').check()
    await card.getByRole('button', { name: 'Přihlásit' }).click()
    await expect(page.locator('li', { hasText: room }).first()).toContainText('1 / 10')

    await page.goto('/moje-treninky')
    await expectNoHorizontalScroll(page, 'my bookings')
    await expectTappableControls(page, 'my bookings')

    await page.goto('/ucet')
    await expectNoHorizontalScroll(page, 'account')
    await expectTappableControls(page, 'account')
  })

  test('the bottom navigation stays reachable without scrolling', async ({ page }) => {
    await signIn(page, uniqueEmail('rodic'))
    await page.goto('/moji-sportovci')

    const viewport = page.viewportSize()
    expect(viewport).not.toBeNull()

    for (const label of ['Tréninky', 'Moje tréninky', 'Moji sportovci', 'Účet']) {
      const item = page.getByRole('link', { name: label, exact: true }).last()
      const box = await item.boundingBox()
      expect(box, `${label} is not on screen`).not.toBeNull()
      expect(box!.y + box!.height, `${label} sits below the fold`).toBeLessThanOrEqual(
        viewport!.height + 1,
      )
      expect(box!.height, `${label} is not thumb-sized`).toBeGreaterThanOrEqual(MIN_TAP)
    }
  })

  test('the coach roster fits on a phone at the rink', async ({ page }) => {
    const coach = uniqueEmail('trener')
    await signIn(page, coach)
    await grantCoach(coach)

    await page.goto('/trener/novy')
    await expectNoHorizontalScroll(page, 'new session')
    await expectTappableControls(page, 'new session')

    await page.getByLabel('Datum').fill(dateInput(12))
    await page.getByLabel('Začátek').fill('17:00')
    await page.getByLabel('Konec').fill('18:00')
    await page.getByLabel('Kapacita').fill('10')
    const coachRoom = `Šatna ${Date.now()}`
    await page.getByLabel('Šatna').fill(coachRoom)
    await page.getByRole('button', { name: 'Uložit' }).click()
    await expect(page.getByText(coachRoom)).toBeVisible()

    await expectNoHorizontalScroll(page, 'session detail with roster')
    await expectTappableControls(page, 'session detail with roster')

    await page.goto('/trener')
    await expectNoHorizontalScroll(page, 'coach session list')
    await expectTappableControls(page, 'coach session list')
  })
})
