import { expect, test, type APIRequestContext } from '@playwright/test'
import { MAILPIT, STACK, asUser, expectAccessible, signIn } from './helpers'
import { bookedChild, club, rpc } from './club'

/**
 * Payment, the coach's note and the message to the parent (handoff v3.3,
 * decisions 34–36): coach tests 19–23 at 390 × 844, with axe on K2, K17 and
 * G6e.
 *
 * The refusals and the row policies are the database's and are asserted in
 * supabase/tests/validation_payment.sql; these walk the screens. Three
 * sign-ins in all — GoTrue allows thirty in five minutes for the whole run.
 */

test.use({ viewport: { width: 390, height: 844 } })

/** Empties the outbox the way production does: the cron route. */
async function deliver(request: APIRequestContext) {
  const secret = process.env.CRON_SECRET ?? 'local-development-secret-value'
  const response = await request.get('/api/notifications/drain', {
    headers: { authorization: `Bearer ${secret}` },
  })
  expect(response.ok(), 'the drain route answered').toBe(true)
}

async function mailTo(address: string, subject: RegExp): Promise<boolean> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const box = (await (await fetch(`${MAILPIT}/api/v1/messages?limit=200`)).json()) as {
      messages?: { Subject: string; To?: { Address: string }[] }[]
    }
    if (
      box.messages?.some(
        (one) => one.To?.some((to) => to.Address === address) && subject.test(one.Subject),
      )
    ) {
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return false
}

test.describe('payment, the note and the message per booking', () => {
  test('the main coach marks, notes and writes; the parent sees it (coach tests 19–22)', async ({
    page,
    request,
  }) => {
    const run = Date.now()
    const c = await club(run)
    const [ivan, adam, ondrej, petr] = await Promise.all(
      ['Ivan', 'Adam', 'Ondřej', 'Petr'].map((name) => bookedChild(c.assisted, run, name)),
    )
    if (!ivan || !adam || !ondrej || !petr) throw new Error('families not created')

    // Petr paid before the coach opened the training; his who and when must
    // survive `Zaplatili všichni` (coach test 20).
    const earlier = await rpc(c.adminToken, 'set_booking_paid', {
      p_booking_id: petr.bookingId,
      p_paid: true,
    })
    expect(earlier.ok).toBe(true)
    const paidBefore = async () =>
      (
        (await (
          await fetch(`${STACK}/rest/v1/bookings?select=paid_at&id=eq.${petr.bookingId}`, {
            headers: asUser(c.adminToken),
          })
        ).json()) as { paid_at: string }[]
      )[0]?.paid_at
    const petrPaidAt = await paidBefore()

    await signIn(page, c.adminEmail)
    await page.goto(`/trener/${c.assisted}`)
    await expect(page.getByText('Zaplaceno 1 z 4')).toBeVisible()
    await expectAccessible(page, 'K2 with mixed payment')

    // 19 · `Zaplaceno` saves on the tap.
    await page.getByRole('button', { name: new RegExp(ivan.name) }).click()
    const card = page.getByRole('dialog', { name: ivan.name })
    await expectAccessible(page, 'K17 empty')
    await card.getByRole('checkbox', { name: /Zaplaceno/ }).click()
    await expect(card.getByText(/Označil Iva Hlavní/)).toBeVisible()

    // 21 · the note for this training, saved when the field is left.
    await card.getByLabel('POZNÁMKA K TRÉNINKU · JEN TRENÉŘI').fill('Hlídat levou nohu.')

    // 22 · the message, sent to the parent.
    await card.getByLabel('Napište zprávu rodiči').fill('Ivan dnes výborně bruslil.')
    await card.getByRole('button', { name: 'Odeslat rodiči' }).click()
    await expect(card.getByText(/Odesláno .* v aplikaci a e-mailem/)).toBeVisible()
    await expectAccessible(page, 'K17b filled')
    await card.getByRole('button', { name: 'Hotovo' }).click()

    const row = page.getByRole('button', { name: new RegExp(ivan.name) })
    await expect(row).toContainText('Zaplaceno')
    await expect(row.getByRole('img', { name: 'Má poznámku trenéra' })).toBeVisible()
    await expect(row.getByRole('img', { name: 'Zpráva rodiči odeslána' })).toBeVisible()
    await expect(page.getByText('Zaplaceno 2 z 4')).toBeVisible()

    // 20 · `Zaplatili všichni` lists exactly the two still unpaid.
    await page.getByRole('button', { name: 'Zaplatili všichni' }).click()
    const sheet = page.getByRole('dialog', { name: 'Označit 2 sportovce jako zaplacené?' })
    await expect(sheet.getByText(adam.name)).toBeVisible()
    await expect(sheet.getByText(ondrej.name)).toBeVisible()
    await expect(sheet.getByText(ivan.name)).toHaveCount(0)
    await sheet.getByRole('button', { name: 'Označit 2 jako zaplacené' }).click()
    await expect(page.getByText('Zaplaceno 4 z 4')).toBeVisible()
    await expect(page.getByText('Zaplatili všichni ✓')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Zaplatili všichni' })).toHaveCount(0)
    expect(await paidBefore()).toBe(petrPaidAt)

    // 22 · E09 reaches the parent.
    await deliver(request)
    expect(await mailTo(ivan.parentEmail, /^Zpráva od trenéra: /)).toBe(true)

    // 21 · the parent's own session reads no coach note at all.
    const notes = (await (
      await fetch(`${STACK}/rest/v1/booking_coach_notes?select=note`, {
        headers: asUser(ivan.parentToken),
      })
    ).json()) as unknown[]
    expect(notes).toEqual([])

    // 19, 22 · G6e: `Zaplaceno` and the message, and nothing of the note.
    // The coach signs out by losing the session; the parent signs in fresh.
    await page.context().clearCookies()
    await signIn(page, ivan.parentEmail)
    await page.goto(`/moje-treninky/${ivan.bookingId}`)
    await expect(page.getByText('Zaplaceno', { exact: true })).toBeVisible()
    await expect(page.getByText('Ivan dnes výborně bruslil.')).toBeVisible()
    await expect(page.getByText('Hlídat levou nohu.')).toHaveCount(0)
    await expectAccessible(page, 'G6e')
  })

  test('a coach who can only view sees it read-only (coach test 23)', async ({ page }) => {
    const run = Date.now()
    const c = await club(run)
    const child = await bookedChild(c.assisted, run)

    await signIn(page, c.viewerEmail)
    await page.goto(`/trener/${c.assisted}`)
    await expect(page.getByText('Zaplaceno 0 z 1')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Zaplatili všichni' })).toHaveCount(0)

    await page.getByRole('button', { name: new RegExp(child.name) }).click()
    const card = page.getByRole('dialog', { name: child.name })
    await expect(card.getByText('Nezaplaceno')).toBeVisible()
    await expect(card.getByRole('checkbox')).toHaveCount(0)
    await expect(card.getByRole('textbox')).toHaveCount(0)
    await expect(card.getByRole('button', { name: 'Odeslat rodiči' })).toHaveCount(0)
    await expectAccessible(page, 'K17 read-only')

    const refused = await rpc(c.viewerToken, 'set_booking_paid', {
      p_booking_id: child.bookingId,
      p_paid: true,
    })
    expect(refused.code).toBe('FORBIDDEN_EDIT')
  })
})
