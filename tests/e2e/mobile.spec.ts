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

/**
 * WCAG contrast between two computed colours, measured in the browser.
 *
 * Read rather than reasoned about: a Tailwind class can be overridden, a
 * custom property can stop existing, and either way the arithmetic done on the
 * intended colours says nothing about what a parent actually sees. This is how
 * the bottom bar was found rendering transparent — `bg-[var(--background)]`
 * survived a token rename, and `background-color` came back `rgba(0, 0, 0, 0)`.
 */
async function contrastInNav(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const parse = (value: string): number[] => {
      const parts = value.match(/[\d.]+/g)?.map(Number) ?? []
      return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1]
    }
    const luminance = (rgb: number[]) =>
      rgb
        .slice(0, 3)
        .map((c) => {
          const v = (c ?? 0) / 255
          return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
        })
        .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i]!, 0)

    const nav = document.querySelector('nav')
    if (!nav) return null
    const background = parse(getComputedStyle(nav).backgroundColor)

    const results = [...nav.querySelectorAll(sel)].map((el) => {
      const colour = parse(getComputedStyle(el as Element).color)

      // `opacity` dims what is painted without touching the computed `color`,
      // so a label at `opacity-60` reads as full-strength ink unless the
      // element's own opacity, and every ancestor's up to the bar, is folded
      // into the alpha. Missing this is how a 4.4:1 label measured 16:1.
      let alpha = colour[3] ?? 1
      for (let node: Element | null = el as Element; node; node = node.parentElement) {
        alpha *= Number(getComputedStyle(node).opacity)
        if (node === nav) break
      }

      const composited = [0, 1, 2].map(
        (i) => alpha * (colour[i] ?? 0) + (1 - alpha) * (background[i] ?? 255),
      )
      const a = luminance(composited)
      const c = luminance(background)
      return {
        label: (el as HTMLElement).innerText.trim(),
        ratio: (Math.max(a, c) + 0.05) / (Math.min(a, c) + 0.05),
      }
    })
    return { backgroundAlpha: background[3] ?? 1, results }
  }, selector)
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

    // The first registration asks who the parent is as well (AC-278).
    await page.getByLabel('Jméno').first().fill('Milana')
    await page.getByLabel('Příjmení').first().fill('Kotova')
    await page.getByLabel('Jméno').last().fill('Ivan')
    await page.getByLabel('Příjmení').last().fill('Kotov')
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
    await card.getByRole('button', { name: 'Přihlásit' }).click()

    // The sheet is a phone-sized surface of its own, so it gets the same review.
    await expectNoHorizontalScroll(page, 'booking sheet')
    await expectTappableControls(page, 'booking sheet')

    await page.getByRole('dialog').getByRole('button', { name: 'Přihlásit' }).click()
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

  // The bar is fixed over the page, so a transparent one is not merely plain:
  // the last row of every list scrolls underneath it and stays readable enough
  // to look like part of the bar.
  test('the bottom navigation is opaque and its labels are legible', async ({ page }) => {
    await signIn(page, uniqueEmail('rodic'))
    await page.goto('/moji-sportovci')

    const measured = await contrastInNav(page, 'a[href]')
    expect(measured, 'no bottom navigation was rendered').not.toBeNull()

    expect(
      measured!.backgroundAlpha,
      'the fixed bottom bar has no opaque background, so content scrolls through it',
    ).toBe(1)

    const illegible = measured!.results.filter((r) => r.ratio < 4.5)
    expect(
      illegible.map((r) => `${r.label}: ${r.ratio.toFixed(2)}:1`),
      'bottom navigation labels below the 4.5:1 WCAG AA minimum',
    ).toEqual([])
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
    await page.getByLabel('Kapacita', { exact: true }).fill('10')
    const coachRoom = `Šatna ${Date.now()}`
    await page.getByLabel('Šatna').fill(coachRoom)
    await page.getByRole('button', { name: 'Vytvořit trénink' }).click()
    await expect(page.getByText(coachRoom)).toBeVisible()

    await expectNoHorizontalScroll(page, 'session detail with roster')
    await expectTappableControls(page, 'session detail with roster')

    await page.goto('/trener')
    await expectNoHorizontalScroll(page, 'coach session list')
    await expectTappableControls(page, 'coach session list')
  })
})
