import { expect, test, type APIRequestContext } from '@playwright/test'
import { MAILPIT, SERVICE, STACK, asUser, expectAccessible, signIn } from './helpers'
import { bookedChild, club, rpc } from './club'

/**
 * Attendance, payment, the player card and a training without a main coach
 * (AC-300, AC-301, AC-302, AC-303, AC-304, AC-305, AC-306, AC-307, AC-308)
 * (handoff v3.4, decisions 38–46): coach tests 19–26 at 390 × 844, with axe on
 * K2, K2c, K13 in all four tabs, G8b and A3f.
 *
 * The refusals and the row policies are the database's and are asserted in
 * supabase/tests/validation_attendance.sql and validation_handover.sql; these
 * walk the screens. Five sign-ins in all — GoTrue allows thirty in five
 * minutes for the whole run.
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

/**
 * Moves a training in time with the service key. Nothing in the product moves
 * a training into the past, and the cases below need one under way and one
 * three months old.
 */
async function moveTo(sessionId: string, startOffsetMinutes: number, lengthMinutes = 60) {
  const start = new Date(Date.now() + startOffsetMinutes * 60_000)
  const end = new Date(start.getTime() + lengthMinutes * 60_000)
  const response = await fetch(`${STACK}/rest/v1/training_sessions?id=eq.${sessionId}`, {
    method: 'PATCH',
    headers: {
      apikey: SERVICE,
      authorization: `Bearer ${SERVICE}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ start_at: start.toISOString(), end_at: end.toISOString() }),
  })
  expect(response.ok, 'moving the training').toBe(true)
}

async function booking(token: string, id: string) {
  return (
    (await (
      await fetch(`${STACK}/rest/v1/bookings?select=paid_at,paid_by,attendance&id=eq.${id}`, {
        headers: asUser(token),
      })
    ).json()) as { paid_at: string | null; paid_by: string | null; attendance: string | null }[]
  )[0]
}

test.describe('attendance and payment in one roster (v3.4)', () => {
  test('the main coach marks who came and who paid (coach tests 19–23, AC-300–AC-304)', async ({
    page,
  }) => {
    const run = Date.now()
    const c = await club(run)
    const [ivan, adam, ondrej, petr] = await Promise.all(
      ['Ivan', 'Adam', 'Ondřej', 'Petr'].map((name) => bookedChild(c.assisted, run, name)),
    )
    if (!ivan || !adam || !ondrej || !petr) throw new Error('families not created')
    // Under way: started half an hour ago.
    await moveTo(c.assisted, -30)

    // Petr paid before the coach opened the training; his who and when must
    // survive both `Vrátit` and `Zaplatili všichni` (coach tests 20, 22).
    expect(
      (await rpc(c.adminToken, 'set_booking_paid', { p_booking_id: petr.bookingId, p_paid: true }))
        .ok,
    ).toBe(true)
    const petrBefore = await booking(c.adminToken, petr.bookingId)

    await signIn(page, c.adminEmail)
    await page.goto(`/trener/${c.assisted}`)
    await expect(page.getByText('SPORTOVEC')).toBeVisible()
    await expectAccessible(page, 'K2 with mixed states')

    const pay = (name: string) => page.getByRole('button', { name: new RegExp(`^Platba ${name}`) })
    const came = (name: string) =>
      page.getByRole('button', { name: new RegExp(`^Docházka ${name}`) })

    // 19 · the $ toggle marks paid and opens nothing.
    const here = page.url()
    await pay(ivan.name).click()
    await expect(pay(ivan.name)).toHaveAttribute('aria-pressed', 'true')
    await page.waitForTimeout(300)
    expect(page.url()).toBe(here)

    // 19 · the gap between the two toggles does nothing.
    const attendanceBox = await came(adam.name).boundingBox()
    const paymentBox = await pay(adam.name).boundingBox()
    if (!attendanceBox || !paymentBox) throw new Error('toggles not laid out')
    const gapX = (attendanceBox.x + attendanceBox.width + paymentBox.x) / 2
    await page.mouse.click(gapX, paymentBox.y + paymentBox.height / 2)
    await page.waitForTimeout(300)
    expect(page.url()).toBe(here)
    await expect(pay(adam.name)).toHaveAttribute('aria-pressed', 'false')
    await expect(came(adam.name)).toHaveAccessibleName(/nezapsáno/)

    // 19 · a vertical drag over a toggle is a scroll and changes nothing.
    await page.mouse.move(paymentBox.x + 20, paymentBox.y + 10)
    await page.mouse.down()
    await page.mouse.move(paymentBox.x + 20, paymentBox.y + 40, { steps: 4 })
    await page.mouse.up()
    await page.waitForTimeout(300)
    await expect(pay(adam.name)).toHaveAttribute('aria-pressed', 'false')

    // 20 · un-marking offers `Vrátit` for four seconds; it puts back who and when.
    await pay(petr.name).click()
    await expect(
      page.getByRole('status').filter({ hasText: `Platba zrušena · ${petr.name}` }),
    ).toBeVisible()
    await expectAccessible(page, 'the Vrátit toast')
    await page.getByRole('button', { name: 'Vrátit' }).click()
    await expect(pay(petr.name)).toHaveAttribute('aria-pressed', 'true')
    await expect
      .poll(async () => (await booking(c.adminToken, petr.bookingId))?.paid_at)
      .toBe(petrBefore?.paid_at)
    expect((await booking(c.adminToken, petr.bookingId))?.paid_by).toBe(petrBefore?.paid_by)

    // 21 · attendance cycles Byl → Nebyl once the training has begun.
    await came(ivan.name).click()
    await expect(came(ivan.name)).toHaveAccessibleName(/: Byl$/)
    await came(ivan.name).click()
    await expect(came(ivan.name)).toHaveAccessibleName(/: Nebyl$/)

    // 23 · the header counts as it goes, and payment never moves attendance.
    await expect(page.getByText('0/4')).toBeVisible()
    await expect(page.getByText('2/4')).toBeVisible()
    await expect
      .poll(async () => (await booking(c.adminToken, ivan.bookingId))?.attendance)
      .toBe('ABSENT')
    expect((await booking(c.adminToken, ivan.bookingId))?.paid_at).not.toBeNull()

    // 22 · `Ostatní byli` marks the unmarked, no dialog; Ivan stays Nebyl.
    await page.getByRole('button', { name: 'Ostatní byli' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(came(adam.name)).toHaveAccessibleName(/: Byl$/)
    await expect(came(ondrej.name)).toHaveAccessibleName(/: Byl$/)
    await expect(came(ivan.name)).toHaveAccessibleName(/: Nebyl$/)
    await expect(page.getByText('3/4')).toBeVisible()

    // 22 · `Zaplatili všichni` lists only the unpaid, then turns static.
    await page.getByRole('button', { name: 'Zaplatili všichni' }).click()
    const sheet = page.getByRole('dialog', { name: 'Označit 2 sportovce jako zaplacené?' })
    await expect(sheet.getByText(adam.name)).toBeVisible()
    await expect(sheet.getByText(ondrej.name)).toBeVisible()
    await expect(sheet.getByText(ivan.name)).toHaveCount(0)
    await expectAccessible(page, 'K2c')
    await sheet.getByRole('button', { name: 'Označit 2 jako zaplacené' }).click()
    await expect(page.getByText('Zaplatili všichni ✓')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Zaplatili všichni' })).toHaveCount(0)
    expect((await booking(c.adminToken, petr.bookingId))?.paid_at).toBe(petrBefore?.paid_at)

    // 23 · K14 counts the same.
    await moveTo(c.assisted, -120)
    await page.goto('/trener?tab=minule')
    await expect(page.getByLabel('Byli 3/4').first()).toBeVisible()
    await expect(page.getByLabel('Zaplatili 4/4').first()).toBeVisible()
  })

  test('the player card, its four tabs, and the parent (coach tests 21, 24; G8b; AC-302, AC-305, AC-308)', async ({
    page,
    request,
  }) => {
    const run = Date.now()
    const c = await club(run)
    const child = await bookedChild(c.assisted, run)
    // Book the same child on the second training too: one past, one ahead.
    const added = await rpc(c.adminToken, 'book_athlete_as_coach', {
      p_training_session_id: c.led,
      p_athlete_id: (
        (await (
          await fetch(`${STACK}/rest/v1/bookings?select=athlete_id&id=eq.${child.bookingId}`, {
            headers: asUser(c.adminToken),
          })
        ).json()) as { athlete_id: string }[]
      )[0]?.athlete_id,
    })
    expect(added.ok, `adding failed: ${added.code}`).toBe(true)
    // 21 · three months ago, and never marked.
    await moveTo(c.assisted, -92 * 24 * 60)
    const athleteId = (
      (await (
        await fetch(`${STACK}/rest/v1/bookings?select=athlete_id&id=eq.${child.bookingId}`, {
          headers: asUser(c.adminToken),
        })
      ).json()) as { athlete_id: string }[]
    )[0]?.athlete_id
    expect(
      (
        await rpc(c.adminToken, 'set_athlete_internal_note', {
          p_workspace_id: c.workspaceId,
          p_athlete_id: athleteId,
          p_notes: 'Po zranění kotníku bez soubojů.',
        })
      ).ok,
    ).toBe(true)

    await signIn(page, c.adminEmail)
    await page.goto(`/trener/${c.led}`)
    // 21 · before the start the attendance toggle cannot be pressed.
    await expect(
      page.getByRole('button', { name: new RegExp(`^Docházka ${child.name}`) }),
    ).toBeDisabled()

    // 24 · the name opens K13 on `Tréninky`.
    await page.getByRole('link', { name: new RegExp(child.name) }).click()
    await page.waitForURL(`**/trener/sportovci/${athleteId}`)
    await expect(page.getByRole('tab', { name: 'Tréninky', selected: true })).toBeVisible()
    await expectAccessible(page, 'K13 Tréninky')

    // 21 · the old training: unmarked after its end reads as Nebyl, and it
    // still takes a correction three months on.
    const oldMonth = new Date(Date.now() - 92 * 24 * 60 * 60_000)
    const key = `${oldMonth.getFullYear()}-${String(oldMonth.getMonth() + 1).padStart(2, '0')}`
    await page.goto(`/trener/sportovci/${athleteId}?obdobi=${key}`)
    await expect(page.getByText('0 %')).toBeVisible()
    await expect(page.getByText('Docházka · byl 0 z 1')).toBeVisible()
    await page.getByRole('button', { name: /^Docházka .*: Nebyl$/ }).click()
    await expect(page.getByText('100 %')).toBeVisible()

    // 24 · Hráč: the general note.
    await page.getByRole('tab', { name: 'Hráč' }).click()
    await expect(page.getByText('Po zranění kotníku bez soubojů.')).toBeVisible()
    await expectAccessible(page, 'K13 Hráč')

    // 24 · Rodiče: call and SMS.
    await page.getByRole('tab', { name: 'Rodiče' }).click()
    await expect(page.getByRole('link', { name: /Zavolat/ })).toHaveAttribute('href', /^tel:/)
    await expect(page.getByRole('link', { name: /SMS/ })).toHaveAttribute('href', /^sms:/)
    await expectAccessible(page, 'K13 Rodiče')

    // 24 · Zprávy: a note for the staff, a message for the parents (E09).
    await page.getByRole('tab', { name: 'Zprávy' }).click()
    await expectAccessible(page, 'K13 Zprávy')
    await page.getByRole('button', { name: 'Přidat poznámku' }).first().click()
    await page.getByLabel('Poznámka · jen trenéři').fill('Hlídat levou nohu.')
    await page.getByRole('button', { name: 'Uložit' }).click()
    await expect(page.getByText('Poznámka · jen trenéři')).toBeVisible()
    await expect(page.getByText('Hlídat levou nohu.')).toBeVisible()
    await page.getByRole('button', { name: 'Napsat rodičům' }).first().click()
    await page.getByLabel('Napsat rodičům').fill('Dnes výborně bruslil.')
    await page.getByRole('button', { name: 'Odeslat' }).click()
    await expect(page.getByText(/Zpráva rodičům · odesláno/)).toBeVisible()
    await deliver(request)
    expect(await mailTo(child.parentEmail, /^Zpráva od trenéra: /)).toBe(true)

    // 24 · the parent's session reads no coach note at all.
    const notes = (await (
      await fetch(`${STACK}/rest/v1/booking_coach_notes?select=note`, {
        headers: asUser(child.parentToken),
      })
    ).json()) as unknown[]
    expect(notes).toEqual([])

    // G8b · the parent sees Byl / Nebyl, never payment.
    await page.context().clearCookies()
    await signIn(page, child.parentEmail)
    await page.goto(`/moji-sportovci/${athleteId}`)
    await expect(page.getByText('DOCHÁZKA · LEDNÍ HOKEJ')).toBeVisible()
    await expectAccessible(page, 'G8b')
  })

  test('a deactivated main coach leaves the trainings without one (coach test 25, A3f, AC-306)', async ({
    page,
    request,
  }) => {
    const run = Date.now()
    const c = await club(run)
    // The view-only coach leads `led`; two more of theirs ahead.
    for (const room of ['A', 'B']) {
      const created = await rpc(c.adminToken, 'create_training_session', {
        p_workspace_id: c.workspaceId,
        p_local_date: new Date(Date.now() + 25 * 86_400_000).toISOString().slice(0, 10),
        p_local_start_time: room === 'A' ? '08:00' : '09:00',
        p_local_end_time: room === 'A' ? '08:45' : '09:45',
        p_facility_id: c.mh,
        p_main_coach_profile_id: c.viewerId,
      })
      expect(created.ok).toBe(true)
    }
    const child = await bookedChild(c.led, run)

    await signIn(page, c.adminEmail)
    await page.goto(`/trener/vice/treneri/${c.viewerId}`)
    await page.getByRole('switch', { name: /Aktivní trenér/ }).setChecked(false, { force: true })
    await page.getByRole('button', { name: 'Uložit změny' }).click()
    const sheet = page.getByRole('dialog', { name: 'Deaktivovat trenéra?' })
    await expect(sheet.getByRole('listitem')).toHaveCount(3)
    await expectAccessible(page, 'A3f')
    await sheet.getByRole('button', { name: 'Deaktivovat' }).click()
    await page.waitForURL('**/trener/vice/treneri')

    await page.goto('/trener')
    await expect(page.getByText('Bez hlavního trenéra').first()).toBeVisible()
    await page.goto(`/trener/${c.led}`)
    await expect(page.getByText('Trénink nemá hlavního trenéra')).toBeVisible()
    await expect(page.getByText('Bez trenéra')).toBeVisible()

    // The parent reads `Trenér bude upřesněn`: no main coach on their training.
    const seen = (await (
      await fetch(
        `${STACK}/rest/v1/training_sessions?select=main_coach_profile_id&id=eq.${c.led}`,
        {
          headers: asUser(child.parentToken),
        },
      )
    ).json()) as { main_coach_profile_id: string | null }[]
    expect(seen[0]?.main_coach_profile_id).toBeNull()

    // Assigning one sends E05.
    await page.getByRole('link', { name: 'Přiřadit trenéra' }).click()
    await page.getByRole('button', { name: 'Bez trenéra' }).click()
    // Parallel workers can share a run number, so two clubs' administrators
    // may share a name; either may lead it.
    await page.getByRole('searchbox').fill(`Hlavní${run}`)
    await page.getByText(`Iva Hlavní${run}`).first().click()
    await page.getByRole('button', { name: 'Hotovo' }).click()
    await page.getByRole('button', { name: 'Uložit změny' }).click()
    await page.waitForURL(`**/trener/${c.led}`)
    await expect(page.getByText('Trénink nemá hlavního trenéra')).toHaveCount(0)
    await deliver(request)
    expect(await mailTo(child.parentEmail, /trenér/i)).toBe(true)
  })

  test('a coach who can only view sees it all and changes nothing (coach test 26, AC-307)', async ({
    page,
  }) => {
    const run = Date.now()
    const c = await club(run)
    const child = await bookedChild(c.assisted, run)
    await moveTo(c.assisted, -30)

    await signIn(page, c.viewerEmail)
    await page.goto(`/trener/${c.assisted}`)
    await expect(page.getByRole('img', { name: new RegExp(`^Platba ${child.name}`) })).toBeVisible()
    await expect(
      page.getByRole('button', { name: new RegExp(`^Platba ${child.name}`) }),
    ).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Ostatní byli' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Zaplatili všichni' })).toHaveCount(0)
    await expectAccessible(page, 'K2b')

    await page.getByRole('link', { name: new RegExp(child.name) }).click()
    await expect(page.getByRole('tab', { name: 'Tréninky', selected: true })).toBeVisible()
    await expect(
      page.getByRole('button', { name: new RegExp(`^Docházka ${child.name}`) }),
    ).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Odhlásit z tréninku' })).toHaveCount(0)

    for (const [name, body] of [
      ['set_booking_paid', { p_booking_id: child.bookingId, p_paid: true }],
      ['set_booking_attendance', { p_booking_id: child.bookingId, p_attendance: 'PRESENT' }],
      ['mark_session_present', { p_training_session_id: c.assisted }],
    ] as const) {
      expect((await rpc(c.viewerToken, name, body)).code, name).toBe('FORBIDDEN_EDIT')
    }
  })
})
