import { expect, test } from '@playwright/test'
import {
  apiUser,
  asUser,
  dateInput,
  expectAccessible,
  grantCoach,
  grantWorkspaceRole,
  profileFor,
  signIn,
  uniqueEmail,
  SERVICE,
  STACK,
} from './helpers'

/**
 * Assistants and view-only coaches (handoff v3.2, decision 33).
 *
 *   canEdit(session) = isAdmin || canEditTrainings || session.mainCoachId === me
 *
 * Coach tests 16–18 and admin tests 16–17 of the specs, at 390 × 844. The
 * refusals themselves are the database's and are asserted in
 * supabase/tests/validation_permissions.sql; these check what each screen
 * offers, and that a direct call is refused the same way.
 */

test.use({ viewport: { width: 390, height: 844 } })

type Rpc = { ok?: boolean; code?: string; data?: { training_session_id?: string } }

async function rpc(token: string, name: string, body: object): Promise<Rpc> {
  const response = await fetch(`${STACK}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: asUser(token),
    body: JSON.stringify(body),
  })
  return (await response.json()) as Rpc
}

async function facility(token: string, code: string): Promise<string> {
  const rows = (await (
    await fetch(`${STACK}/rest/v1/facilities?select=id,code`, { headers: asUser(token) })
  ).json()) as { id: string; code: string }[]
  return rows.find((row) => row.code === code)?.id ?? ''
}

/**
 * An administrator, a coach without the permission, and two trainings: one the
 * administrator leads with that coach assisting, one that coach leads.
 */
async function club(run: number) {
  const adminEmail = uniqueEmail('spravce.opravneni')
  const viewerEmail = uniqueEmail('asistent.opravneni')
  // API users: only the browser signs in through a code (see apiUser).
  const adminToken = await apiUser(adminEmail)
  const viewerToken = await apiUser(viewerEmail)

  const { workspaceId, profileId: adminId } = await grantWorkspaceRole(
    adminEmail,
    'WORKSPACE_ADMIN',
  )
  const { profileId: viewerId } = await grantCoach(viewerEmail)

  await fetch(`${STACK}/rest/v1/app_profiles?id=eq.${viewerId}`, {
    method: 'PATCH',
    headers: {
      apikey: SERVICE,
      authorization: `Bearer ${SERVICE}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ first_name: 'Ota', last_name: `Asistent${run}` }),
  })
  await fetch(`${STACK}/rest/v1/app_profiles?id=eq.${adminId}`, {
    method: 'PATCH',
    headers: {
      apikey: SERVICE,
      authorization: `Bearer ${SERVICE}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ first_name: 'Iva', last_name: `Hlavní${run}` }),
  })

  const restricted = await rpc(adminToken, 'set_member_can_edit_trainings', {
    p_workspace_id: workspaceId,
    p_profile_id: viewerId,
    p_value: false,
  })
  expect(restricted.ok, `restricting failed: ${restricted.code}`).toBe(true)

  const mh = await facility(adminToken, 'MH')
  const training = async (room: string, mainCoach: string, internal: string | null) => {
    const created = await rpc(adminToken, 'create_training_session', {
      p_workspace_id: workspaceId,
      p_local_date: dateInput(19),
      p_local_start_time: '17:00',
      p_local_end_time: '18:00',
      p_facility_id: mh,
      p_capacity: 10,
      p_eligibility_mode: 'ALL',
      p_changing_room: room,
      p_internal_notes: internal,
      p_main_coach_profile_id: mainCoach,
    })
    expect(created.ok, `create failed: ${created.code}`).toBe(true)
    return created.data?.training_session_id ?? ''
  }

  const assistedRoom = `${run}1`
  const ledRoom = `${run}2`
  const assisted = await training(assistedRoom, adminId, `Interní pro asistenta ${run}`)
  const led = await training(ledRoom, viewerId, null)

  const assistants = await rpc(adminToken, 'set_session_assistants', {
    p_training_session_id: assisted,
    p_profile_ids: [viewerId],
  })
  expect(assistants.ok).toBe(true)

  return {
    workspaceId,
    adminEmail,
    adminToken,
    adminId,
    viewerEmail,
    viewerToken,
    viewerId,
    mh,
    assisted,
    led,
    assistedRoom: `Šatna ${assistedRoom}`,
    ledRoom: `Šatna ${ledRoom}`,
  }
}

/** A child with a parent who has a phone, booked onto the training. */
async function bookedChild(sessionId: string, run: number): Promise<string> {
  const parentEmail = uniqueEmail('rodic.opravneni')
  const token = await apiUser(parentEmail)
  await fetch(`${STACK}/rest/v1/app_profiles?id=eq.${await profileFor(parentEmail)}`, {
    method: 'PATCH',
    headers: {
      apikey: SERVICE,
      authorization: `Bearer ${SERVICE}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ first_name: 'Eva', last_name: `Rodič${run}`, phone: '777333444' }),
  })
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
        p_first_name: 'Max',
        p_last_name: `Hráč${run}`,
        p_date_of_birth: '2016-04-02',
        p_workspace_id: workspaces[0]?.id,
        p_sport_code: 'HOCKEY',
        p_attributes: { position: 'CENTER', stick_side: 'LEFT' },
      }),
    })
  ).json()) as { ok?: boolean; data?: { athlete_id?: string } }
  expect(created.ok).toBe(true)
  const booked = await rpc(token, 'book_athletes_as_guardian', {
    p_training_session_id: sessionId,
    p_athlete_ids: [created.data?.athlete_id],
  })
  expect(booked.ok, `booking failed: ${booked.code}`).toBe(true)
  return `Max Hráč${run}`
}

test.describe('a coach without `Může upravovat všechny tréninky`', () => {
  test('`Moje` shows their trainings with their role, and survives a reload (coach test 16)', async ({
    page,
  }) => {
    const run = Date.now()
    const c = await club(run)
    await signIn(page, c.viewerEmail)

    await page.goto('/trener')
    // §K1b: `Moje` is where a view-only coach starts.
    await expect(page.getByRole('button', { name: 'Moje' })).toHaveAttribute('aria-pressed', 'true')

    const assisted = page.locator('main li', { hasText: c.assistedRoom })
    const led = page.locator('main li', { hasText: c.ledRoom })
    await expect(assisted).toContainText('Asistent')
    await expect(led).toContainText('Hlavní trenér')
    await expectAccessible(page, '§K1b the list under `Moje`')

    // `Všechny` is remembered across a reload.
    await page.getByRole('button', { name: 'Všechny' }).click()
    await expect(page.getByRole('button', { name: 'Všechny' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await page.reload()
    await expect(page.getByRole('button', { name: 'Všechny' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(page.locator('main li', { hasText: c.assistedRoom })).toContainText('Asistent')

    // `Moje` hides a training they have no part in.
    const elsewhere = await rpc(c.adminToken, 'create_training_session', {
      p_workspace_id: c.workspaceId,
      p_local_date: dateInput(19),
      p_local_start_time: '19:00',
      p_local_end_time: '20:00',
      p_facility_id: c.mh,
      p_changing_room: `${run}3`,
      p_main_coach_profile_id: c.adminId,
    })
    expect(elsewhere.ok).toBe(true)
    await page.reload()
    await expect(page.locator('main li', { hasText: `Šatna ${run}3` })).toHaveCount(1)
    await expect(page.locator('main li', { hasText: `Šatna ${run}3` })).not.toContainText(
      'Asistent',
    )
    await page.getByRole('button', { name: 'Moje' }).click()
    await expect(page.locator('main li', { hasText: `Šatna ${run}3` })).toHaveCount(0)
  })

  test('reads what they assist, and edits what they lead (coach test 17)', async ({ page }) => {
    const run = Date.now()
    const c = await club(run)
    await signIn(page, c.viewerEmail)

    // No FAB, and no way in by URL.
    await page.goto('/trener')
    await expect(page.getByRole('button', { name: /Vytvořit/ })).toHaveCount(0)
    await page.goto('/trener/novy')
    await page.waitForURL(/\/trener$/)
    await page.goto(`/trener/novy?from=${c.led}`)
    await page.waitForURL(/\/trener$/)

    // An assisted training is K2b.
    await page.goto(`/trener/${c.assisted}`)
    await expect(page.getByText('Jen pro čtení')).toBeVisible()
    await expect(
      page.getByText(
        `Tento trénink vede Iva Hlavní${run}. Upravit ho může hlavní trenér nebo administrátor.`,
      ),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: /Přidat sportovce/ })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Upravit trénink' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Zrušit trénink' })).toHaveCount(0)
    await expectAccessible(page, '§K2b a training the coach assists')

    await page.goto(`/trener/${c.assisted}/upravit`)
    await page.waitForURL(new RegExp(`/trener/${c.assisted}$`))

    // The database says no to a direct call, whatever the screen shows.
    const edited = await rpc(c.viewerToken, 'set_session_booking_state', {
      p_training_session_id: c.assisted,
      p_open: false,
    })
    expect(edited.code).toBe('FORBIDDEN_EDIT')
    const created = await rpc(c.viewerToken, 'create_training_session', {
      p_workspace_id: c.workspaceId,
      p_local_date: dateInput(21),
      p_local_start_time: '09:00',
      p_local_end_time: '10:00',
      p_facility_id: c.mh,
      p_main_coach_profile_id: c.viewerId,
    })
    expect(created.code).toBe('FORBIDDEN_EDIT')

    // Their own training: the full K2, without the copy.
    await page.goto(`/trener/${c.led}`)
    await expect(page.getByText('Jen pro čtení')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Přidat sportovce/ })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Upravit trénink' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Zrušit trénink' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Duplikovat', exact: true })).toHaveCount(0)

    // …and in K3 the main coach stays where it is.
    await page.getByRole('link', { name: 'Upravit trénink' }).click()
    await expect(page.getByText('Hlavního trenéra může změnit administrátor.')).toBeVisible()
    await expect(page.getByRole('button', { name: `Ota Asistent${run}` })).toBeDisabled()
    await page.getByLabel('Kapacita', { exact: true }).fill('12')
    await page.getByRole('button', { name: 'Uložit změny' }).click()
    await page.waitForURL(new RegExp(`/trener/${c.led}$`))
    await expect(page.getByText('0 / 12')).toBeVisible()

    // Closing registration on their own training works.
    await page.getByRole('button', { name: /Zavřít přihlašování/ }).click()
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: /Zavřít/ })
      .click()
    await expect(page.getByText('Přihlašování uzavřeno').first()).toBeVisible()
  })

  test('still rings a parent and reads the internal note (coach test 18)', async ({ page }) => {
    const run = Date.now()
    const c = await club(run)
    const child = await bookedChild(c.assisted, run)
    await signIn(page, c.viewerEmail)

    await page.goto(`/trener/${c.assisted}`)
    await expect(page.getByText(`Interní pro asistenta ${run}`)).toBeVisible()

    await page.getByRole('button', { name: new RegExp(child) }).click()
    await expect(page.getByRole('link', { name: `Zavolat Eva Rodič${run}` })).toHaveAttribute(
      'href',
      'tel:777333444',
    )
    // Reading the family is not removing the child.
    await expect(page.getByRole('button', { name: 'Odebrat z tréninku' })).toHaveCount(0)
  })
})

test.describe('an administrator sets the permission', () => {
  test('on by default; off makes the coach `Jen prohlížení` (admin test 16)', async ({ page }) => {
    const run = Date.now()
    const adminEmail = uniqueEmail('spravce.a2')
    await signIn(page, adminEmail)
    await grantWorkspaceRole(adminEmail, 'WORKSPACE_ADMIN')

    await page.goto('/trener/vice/treneri/novy')
    const permission = page.getByRole('switch', { name: /Může upravovat všechny tréninky/ })
    await expect(permission).toBeChecked()

    await page.getByLabel('Jméno').fill('Petr')
    await page.getByLabel('Příjmení').fill(`Omezený${run}`)
    await page.getByRole('button', { name: 'Přidat trenéra' }).click()
    await page.waitForURL(/\/trener\/vice\/treneri$/)

    const row = page.locator('li', { hasText: `Petr Omezený${run}` })
    await row.getByRole('link').click()
    await expect(page.getByText('ROLE A OPRÁVNĚNÍ')).toBeVisible()
    await page.getByText('Může upravovat všechny tréninky').click()
    await expect(
      page.getByText('Upravuje jen tréninky, které vede jako hlavní trenér.', { exact: false }),
    ).toBeVisible()
    await expectAccessible(page, '§A3 a coach with the permission off')
    await page.getByRole('button', { name: 'Uložit změny' }).click()
    await page.waitForURL(/\/trener\/vice\/treneri$/)

    // Saved: A3 reads it back off.
    await page
      .locator('li', { hasText: `Petr Omezený${run}` })
      .getByRole('link')
      .click()
    await expect(
      page.getByRole('switch', { name: /Může upravovat všechny tréninky/ }),
    ).not.toBeChecked()

    // §A1: a signed-in coach without it reads `Jen prohlížení`. (One with no
    // address shows `Chybí e-mail` first, which is what Petr shows.)
    const c = await club(run)
    await fetch(`${STACK}/rest/v1/staff_contacts`, {
      method: 'POST',
      headers: {
        apikey: SERVICE,
        authorization: `Bearer ${SERVICE}`,
        'content-type': 'application/json',
        prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        profile_id: c.viewerId,
        email: c.viewerEmail,
        first_sign_in_at: new Date().toISOString(),
        welcomed_at: new Date().toISOString(),
      }),
    })
    await page.goto('/trener/vice/treneri')
    await expect(page.locator('li', { hasText: `Ota Asistent${run}` })).toContainText(
      'Jen prohlížení',
    )
  })

  test("an administrator's own permission is on and fixed (admin test 17)", async ({ page }) => {
    const adminEmail = uniqueEmail('spravce.a3')
    await signIn(page, adminEmail)
    const { workspaceId, profileId } = await grantWorkspaceRole(adminEmail, 'WORKSPACE_ADMIN')

    await page.goto(`/trener/vice/treneri/${profileId}`)
    const permission = page.getByRole('switch', { name: /Může upravovat všechny tréninky/ })
    await expect(permission).toBeChecked()
    await expect(permission).toBeDisabled()

    const refused = await rpc(await apiUser(adminEmail), 'set_member_can_edit_trainings', {
      p_workspace_id: workspaceId,
      p_profile_id: profileId,
      p_value: false,
    })
    expect(refused.code).toBe('ADMIN_ALWAYS_EDITS')
  })
})
