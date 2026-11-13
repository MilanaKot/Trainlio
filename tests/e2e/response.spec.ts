import { expect, test } from '@playwright/test'
import { STACK, asUser, expectAccessible, sessionCard, signIn } from './helpers'
import { bookedChild, club, deliver, mailTo, moveTo, rpc } from './club'

/**
 * Parents confirm attendance: Půjde / Nepůjde (handoff v3.7, decisions 52–55;
 * AC-315, AC-316, AC-317, AC-318, AC-319). Guardian tests 11–14 and coach
 * tests 30, 31 and 33 at 390 × 844, with axe on G6f, G6g, G6i and K2n.
 *
 * The refusals, the row policies and the counting are the database's and are
 * asserted in supabase/tests/validation_guardian_response.sql (coach test 32
 * there); these walk the screens. Six sign-ins in all.
 */

test.use({ viewport: { width: 390, height: 844 } })

async function reason(token: string, bookingId: string) {
  return (await (
    await fetch(
      `${STACK}/rest/v1/bookings?select=cancellation_reason,cancel_late&id=eq.${bookingId}`,
      {
        headers: asUser(token),
      },
    )
  ).json()) as { cancellation_reason: string | null; cancel_late: boolean | null }[]
}

test.describe('Půjde / Nepůjde (v3.7)', () => {
  test('a parent answers, then withdraws with a reason; the coaches see it (guardian 11, 12, 14; coach 30, 33; AC-315, AC-316, AC-319)', async ({
    page,
    request,
  }) => {
    const c = await club(Date.now())
    const child = await bookedChild(c.assisted)
    const other = await bookedChild(c.assisted)
    const first = child.athlete.firstName

    await signIn(page, child.parentEmail)

    // 11 · a new booking asks for an answer.
    await page.goto('/moje-treninky')
    await expect(page.getByText('Potvrďte účast')).toBeVisible()
    await page
      .getByRole('link', { name: new RegExp(child.name) })
      .first()
      .click()
    await page.waitForURL(`**/moje-treninky/${child.bookingId}`)
    await expect(page.getByRole('heading', { name: `Půjde ${first} na trénink?` })).toBeVisible()
    await expect(page.getByText('Nepotvrzeno')).toBeVisible()
    await expectAccessible(page, 'G6f')

    // 11 · Půjde saves at once: no dialog, a toast, and G6h.
    await page.getByRole('button', { name: 'Půjde', exact: true }).click()
    await expect(
      page.getByRole('status').filter({ hasText: `Potvrzeno: ${first} půjde` }),
    ).toBeVisible()
    await expect(page.getByText(`Potvrdili jste, že ${first} přijde.`)).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)

    await page.goto('/treninky')
    await expect(sessionCard(page, c.assisted)).toContainText('2 / 10')
    await page.goto('/moje-treninky')
    await expect(page.getByText('Půjde · potvrzeno')).toBeVisible()

    // 12 · the reason sheet.
    await page.goto(`/moje-treninky/${child.bookingId}`)
    await page.getByRole('button', { name: `Změnit: ${first} nepůjde` }).click()
    const sheet = page.getByRole('dialog')
    const confirm = sheet.getByRole('button', { name: `Odhlásit: ${first} nepůjde` })
    const field = sheet.getByRole('textbox', { name: /Důvod/ })
    await expect(confirm).toBeDisabled()
    await field.fill('   ')
    await expect(confirm).toBeDisabled()
    await field.fill('x'.repeat(201))
    await expect(confirm).toBeDisabled()
    await sheet.getByRole('button', { name: 'Nemoc' }).click()
    await expect(field).toHaveValue('Nemoc – ')
    await expect(field).toBeFocused()
    await page.keyboard.type('teplota, zůstává doma.')
    await expectAccessible(page, 'G6g')
    await confirm.click()

    // 12 · G6i: the reason, the struck time, the place freed.
    await expect(page.getByRole('status').filter({ hasText: 'Odhlášeno' })).toBeVisible()
    await expect(page.getByText('Nemoc – teplota, zůstává doma.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Přihlásit znovu' })).toBeVisible()
    await expectAccessible(page, 'G6i')
    await page.goto('/treninky')
    await expect(sessionCard(page, c.assisted)).toContainText('1 / 10')

    // 30 · E10 to the training's main coach.
    await deliver(request)
    expect(await mailTo(c.adminEmail, /^Omluvenka: .* nepůjde · trénink /)).toBe(true)

    // 33 · the family wrote it and reads it; another family reads nothing.
    expect((await reason(child.parentToken, child.bookingId))[0]?.cancellation_reason).toBe(
      'Nemoc – teplota, zůstává doma.',
    )
    expect(await reason(other.parentToken, child.bookingId)).toEqual([])

    // 30 · K2n: the answers before the start, and NEPŮJDOU with the reason.
    await page.context().clearCookies()
    await signIn(page, c.adminEmail)
    await page.goto(`/trener/${c.assisted}`)
    await expect(page.getByText('Potvrdili účast 0 z 1')).toBeVisible()
    await expect(page.getByText('Nepotvrzeno ·')).toBeVisible()
    await expect(page.getByText('NEPŮJDOU · 1')).toBeVisible()
    await expect(page.getByText('„Nemoc – teplota, zůstává doma.“')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Ostatní byli' })).toBeDisabled()
    await expectAccessible(page, 'K2n')

    // 33 · a coach who can only view reads it too (K2b).
    await page.context().clearCookies()
    await signIn(page, c.viewerEmail)
    await page.goto(`/trener/${c.assisted}`)
    await expect(page.getByText('„Nemoc – teplota, zůstává doma.“')).toBeVisible()
  })

  test('late, and after the start (guardian 13; coach 31; AC-317, AC-318)', async ({ page }) => {
    const c = await club(Date.now())
    const late = await bookedChild(c.assisted)
    const started = await bookedChild(c.led)

    // Six hours away: inside the twelve-hour deadline, still possible.
    await moveTo(c.assisted, 6 * 60)
    const withdrawn = await rpc(late.parentToken, 'cancel_booking_as_guardian', {
      p_booking_id: late.bookingId,
      p_reason: 'Škola – výlet',
    })
    expect(withdrawn.ok, `withdrawing failed: ${withdrawn.code}`).toBe(true)
    expect((await reason(late.parentToken, late.bookingId))[0]?.cancel_late).toBe(true)

    // 13 · once it has started, neither answer is offered or accepted.
    await moveTo(c.led, -10)
    expect(
      (
        await rpc(started.parentToken, 'confirm_attendance_as_guardian', {
          p_booking_id: started.bookingId,
        })
      ).code,
    ).toBe('SESSION_STARTED')
    await signIn(page, started.parentEmail)
    await page.goto(`/moje-treninky/${started.bookingId}`)
    await expect(page.getByRole('heading', { name: 'Účast' })).toBeVisible()
    await expect(page.getByRole('group', { name: 'Účast' })).toHaveCount(0)

    // 31 · Pozdě in K2 and in the player card.
    await page.context().clearCookies()
    await signIn(page, c.adminEmail)
    await page.goto(`/trener/${c.assisted}`)
    await expect(page.getByText('NEPŮJDOU · 1')).toBeVisible()
    await expect(page.getByText('Pozdě', { exact: true })).toBeVisible()
    await page.getByRole('link', { name: new RegExp(late.name) }).click()
    await expect(page.getByRole('tab', { name: 'Tréninky', selected: true })).toBeVisible()
    await expect(page.getByText('· 1 nepůjde')).toBeVisible()
    await expect(page.getByText('„Škola – výlet“')).toBeVisible()
    await expect(page.getByText('Pozdě', { exact: true })).toBeVisible()
    await page.getByRole('tab', { name: 'Zprávy' }).click()
    await expect(page.getByText(/^Omluvenka od rodiče · /)).toBeVisible()
  })
})
