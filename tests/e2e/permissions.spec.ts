import { expect, test } from '@playwright/test'
import {
  freshPerson,
  pickRoom,
  sessionCard,
  apiUser,
  dateInput,
  expectAccessible,
  grantWorkspaceRole,
  signIn,
  uniqueEmail,
  SERVICE,
  STACK,
} from './helpers'
import { bookedChild, club, rpc } from './club'

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

    const assisted = sessionCard(page, c.assisted)
    const led = sessionCard(page, c.led)
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
    await expect(sessionCard(page, c.assisted)).toContainText('Asistent')

    // `Moje` hides a training they have no part in.
    const elsewhere = await rpc(c.adminToken, 'create_training_session', {
      p_workspace_id: c.workspaceId,
      p_local_date: dateInput(19),
      p_local_start_time: '19:00',
      p_local_end_time: '20:00',
      p_facility_id: c.mh,
      p_changing_room: pickRoom(),
      p_main_coach_profile_id: c.adminId,
    })
    expect(elsewhere.ok).toBe(true)
    const other = sessionCard(page, elsewhere.data?.training_session_id ?? '')
    await page.reload()
    await expect(other).toHaveCount(1)
    await expect(other).not.toContainText('Asistent')
    await page.getByRole('button', { name: 'Moje' }).click()
    await expect(other).toHaveCount(0)
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
        `Tento trénink vede ${c.adminName}. Docházku, platby a sestavu může měnit hlavní trenér nebo administrátor.`,
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
    await expect(page.getByRole('button', { name: c.viewerName })).toBeDisabled()
    await page.getByLabel('Kapacita', { exact: true }).fill('12')
    await page.getByRole('button', { name: 'Uložit změny' }).click()
    await page.waitForURL(new RegExp(`/trener/${c.led}$`))
    await expect(page.getByText('0 / 12')).toBeVisible()

    // Closing registration on their own training works.
    await page.getByRole('button', { name: 'Zavřít přihlašování' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Zavřít přihlašování' }).click()
    await expect(page.getByText('Přihlašování uzavřeno').first()).toBeVisible()
  })

  test('still rings a parent and reads the internal note (coach test 18)', async ({ page }) => {
    const run = Date.now()
    const c = await club(run)
    const { name: child, parent } = await bookedChild(c.assisted)
    await signIn(page, c.viewerEmail)

    await page.goto(`/trener/${c.assisted}`)
    await expect(page.getByText(`Interní pro asistenta ${run}`)).toBeVisible()

    // v3.4: the player card (K13), `Rodiče`.
    await page.getByRole('link', { name: new RegExp(child) }).click()
    await page.getByRole('tab', { name: 'Rodiče' }).click()
    await expect(page.getByText(parent.name)).toBeVisible()
    await expect(page.getByRole('link', { name: `Zavolat ${parent.name}` })).toHaveAttribute(
      'href',
      'tel:777333444',
    )
    // Reading the family is not removing the child.
    await expect(page.getByRole('button', { name: 'Odhlásit z tréninku' })).toHaveCount(0)
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

    const limited = await freshPerson()
    await page.getByLabel('Jméno').fill(limited.firstName)
    await page.getByLabel('Příjmení').fill(limited.lastName)
    await page.getByRole('button', { name: 'Přidat trenéra' }).click()
    await page.waitForURL(/\/trener\/vice\/treneri$/)

    const row = page.locator('li', { hasText: limited.name })
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
    await page.locator('li', { hasText: limited.name }).getByRole('link').click()
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
    await expect(page.locator('li', { hasText: c.viewerName })).toContainText('Jen prohlížení')
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
