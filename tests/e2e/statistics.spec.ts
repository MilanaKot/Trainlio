import { expect, test } from '@playwright/test'
import { SERVICE, STACK, expectAccessible, signIn } from './helpers'
import { bookedChild, club, rpc } from './club'

/**
 * Statistics (handoff v3.5, decision 48): coach tests 27–29 at 390 × 844,
 * with axe on K20 and K20b. The arithmetic itself is the database's and is
 * checked on a hand-worked month in supabase/tests/validation_statistics.sql;
 * these check that the screens show it, to whom, and for which period.
 *
 * Every run shares one club, so the numbers asserted are read with the coach
 * filter set to this run's administrator, whose trainings are this run's only.
 */

test.use({ viewport: { width: 390, height: 844 } })

async function moveTo(sessionId: string, daysAgo: number) {
  const start = new Date(Date.now() - daysAgo * 86_400_000)
  const end = new Date(start.getTime() + 3_600_000)
  const response = await fetch(`${STACK}/rest/v1/training_sessions?id=eq.${sessionId}`, {
    method: 'PATCH',
    headers: {
      apikey: SERVICE,
      authorization: `Bearer ${SERVICE}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ start_at: start.toISOString(), end_at: end.toISOString() }),
  })
  expect(response.ok).toBe(true)
  return start
}

/** `?obdobi=` of the Prague month a moment falls in. */
function monthKey(at: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Prague',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(at)
  return `${parts.find((p) => p.type === 'year')?.value}-${parts.find((p) => p.type === 'month')?.value}`
}

test.describe('statistics (v3.5)', () => {
  test('K20 shows the hand-worked numbers, and Trenéři to an administrator (tests 27, 28; AC-310, AC-311)', async ({
    page,
  }) => {
    const run = Date.now()
    const c = await club(run)
    const [came, missed, unmarked] = await Promise.all([
      bookedChild(c.assisted),
      bookedChild(c.assisted),
      bookedChild(c.assisted),
    ])
    const held = await moveTo(c.assisted, 2)
    for (const [child, mark] of [
      [came, 'PRESENT'],
      [missed, 'ABSENT'],
    ] as const) {
      expect(
        (
          await rpc(c.adminToken, 'set_booking_attendance', {
            p_booking_id: child.bookingId,
            p_attendance: mark,
          })
        ).ok,
      ).toBe(true)
    }
    for (const child of [came, unmarked]) {
      expect(
        (
          await rpc(c.adminToken, 'set_booking_paid', {
            p_booking_id: child.bookingId,
            p_paid: true,
          })
        ).ok,
      ).toBe(true)
    }

    // One held training of 10 places: 3 booked, 1 of 3 came (the unmarked one
    // counts as Nebyl, it has ended), 2 of 3 paid. `led` is still to come.
    await signIn(page, c.adminEmail)
    await page.goto(`/trener/statistiky?obdobi=${monthKey(held)}&trener=${c.adminId}`)
    const tiles = page.locator('dl')
    await expect(tiles).toContainText('Tréninků1')
    await expect(tiles).toContainText('Obsazenost30 %')
    await expect(tiles).toContainText('Docházka33 %')
    await expect(tiles).toContainText('Zaplaceno67 %')
    // Nezaplaceno: the one unpaid booking of a held training.
    await expect(page.getByRole('link', { name: new RegExp(missed.name) }).first()).toContainText(
      '1 trénink',
    )
    await expect(page.getByRole('heading', { name: 'TRENÉŘI', exact: true })).toBeVisible()
    // With one coach chosen there is no club-wide lowest attendance to show.
    await expect(page.getByRole('heading', { name: 'NEJNIŽŠÍ DOCHÁZKA' })).toHaveCount(0)
    // And the filters do not move when one of them changes.
    const before = await page.getByLabel('Trenér').boundingBox()
    await page.getByLabel('Ročník').selectOption({ index: 1 })
    await page.waitForURL(/rocnik=/)
    expect(await page.getByLabel('Trenér').boundingBox()).toEqual(before)
    await page.goto(`/trener/statistiky?obdobi=${monthKey(held)}&trener=${c.adminId}`)
    await expectAccessible(page, 'K20')

    await page.goto(`/trener/statistiky/trener/${c.adminId}?obdobi=${monthKey(held)}`)
    await expect(page.getByText('Statistiky trenéra')).toBeVisible()
    await expect(page.getByRole('img', { name: /DOCHÁZKA PO TÝDNECH/ })).toBeVisible()
    await expectAccessible(page, 'K20b')
  })

  test('a coach sees no Trenéři and gets 403 for a colleague (test 28, AC-311)', async ({
    page,
  }) => {
    const run = Date.now()
    const c = await club(run)
    await signIn(page, c.viewerEmail)

    await page.goto('/trener/statistiky')
    await expect(page.getByRole('heading', { name: 'Statistiky' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'TRENÉŘI', exact: true })).toHaveCount(0)

    const own = await page.goto(`/trener/statistiky/trener/${c.viewerId}`)
    expect(own?.status()).toBe(200)
    const other = await page.goto(`/trener/statistiky/trener/${c.adminId}`)
    expect(other?.status()).toBe(403)
    await expect(page.getByText('Sem nemáte přístup')).toBeVisible()
  })

  test('Měsíc / Sezóna means 1 August – 31 July everywhere (test 29, AC-312)', async ({ page }) => {
    const run = Date.now()
    const c = await club(run)
    const child = await bookedChild(c.assisted)
    const today = new Date()
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Prague',
      year: 'numeric',
      month: 'numeric',
    }).formatToParts(today)
    const year = Number(parts.find((p) => p.type === 'year')?.value)
    const month = Number(parts.find((p) => p.type === 'month')?.value)
    const seasonStart = month >= 8 ? year : year - 1
    const label = `Sezóna ${seasonStart}/${String((seasonStart + 1) % 100).padStart(2, '0')}`

    await signIn(page, c.adminEmail)
    const athleteId = (
      (await (
        await fetch(`${STACK}/rest/v1/bookings?select=athlete_id&id=eq.${child.bookingId}`, {
          headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}` },
        })
      ).json()) as { athlete_id: string }[]
    )[0]?.athlete_id

    for (const path of [
      '/trener/statistiky',
      `/trener/statistiky/trener/${c.adminId}`,
      `/trener/sportovci/${athleteId}`,
    ]) {
      await page.goto(path)
      await page.getByRole('radio', { name: 'Sezóna' }).click()
      await expect(page.getByText(label, { exact: true })).toBeVisible()
      await expect(page).toHaveURL(new RegExp(`obdobi=sezona-${seasonStart}`))
    }

    await page.context().clearCookies()
    await signIn(page, child.parentEmail)
    await page.goto(`/moji-sportovci/${athleteId}`)
    // G8b opens on the season.
    await expect(page.getByText(label, { exact: true })).toBeVisible()
  })
})
