import { expect, test } from '@playwright/test'
import {
  STACK,
  apiUser,
  asUser,
  expectAccessible,
  fillAthleteForm,
  freshAthlete,
  joinClub,
  joinCode,
  readCode,
  signIn,
  uniqueEmail,
} from './helpers'
import { bookedChild, club, deliver, mailTo, rpc } from './club'

/**
 * Joining a club by its link, the administrator's approval, and the second
 * parent (migration 50, D-39 to D-41; AC-321, AC-322, AC-323, AC-324,
 * AC-325) at 390 × 844, with axe on the link, the waiting state, the
 * approval list, the access page and the invitation sheet.
 *
 * The refusals and the row policies are the database's and are asserted in
 * supabase/tests/validation_club_access.sql; these walk the screens. Five
 * sign-ins in all.
 */

test.use({ viewport: { width: 390, height: 844 } })

/**
 * E11 goes to every administrator, and a long test run leaves many behind:
 * one drain takes twenty, so this one may need a few turns to come up.
 */
async function deliveredTo(
  request: Parameters<typeof deliver>[0],
  address: string,
  subject: RegExp,
): Promise<boolean> {
  for (let turn = 0; turn < 15; turn += 1) {
    await deliver(request)
    if (await mailTo(address, subject, 2)) return true
  }
  return false
}

async function athleteIdFor(token: string, firstName: string): Promise<string> {
  const rows = (await (
    await fetch(
      `${STACK}/rest/v1/athletes?select=id&first_name=eq.${encodeURIComponent(firstName)}`,
      {
        headers: asUser(token),
      },
    )
  ).json()) as { id: string }[]
  return rows[0]?.id ?? ''
}

test.describe('joining a club (migration 50)', () => {
  test('by the link, waiting, and approved by the administrator (AC-321, AC-322, AC-323)', async ({
    page,
    request,
  }) => {
    const c = await club(Date.now())
    const parent = uniqueEmail('rodic.odkaz')
    const code = await joinCode()

    // 321 · the link names the club, and sign-in comes back to it.
    await page.goto(`/klub/${code}`)
    await expect(
      page.getByRole('heading', { name: 'Přihlaste svého sportovce do klubu' }),
    ).toBeVisible()
    await expectAccessible(page, 'the club link')
    await page.getByRole('link', { name: 'Přihlásit se a pokračovat' }).click()
    await page.getByLabel('E-mail').fill(parent)
    await page.getByRole('button', { name: 'Poslat kód' }).click()
    await page.getByLabel('Kód').fill(await readCode(parent))
    await page.waitForURL(`**/klub/${code}`)
    await page.getByRole('button', { name: 'Pokračovat' }).click()
    await page.waitForURL('**/moji-sportovci/novy')

    const child = await freshAthlete()
    await page.getByLabel('Jméno').first().fill('Jana')
    await page.getByLabel('Příjmení').first().fill('Kotova')
    await fillAthleteForm(page, child)
    await page.getByRole('button', { name: 'Přidat sportovce' }).click()

    // 322 · the child waits; the family sees no training yet.
    await expect(page.getByText(child.name)).toBeVisible()
    await expect(page.getByText('Čeká na schválení')).toBeVisible()
    await page.goto('/treninky')
    await expect(page.getByText('Čekáme na schválení klubem')).toBeVisible()
    await expectAccessible(page, 'waiting for approval')

    expect(
      await deliveredTo(request, c.adminEmail, new RegExp(`^Žádost o přijetí: ${child.name}`)),
    ).toBe(true)

    // 322 · the administrator sees it on K1 and approves it.
    await page.context().clearCookies()
    await signIn(page, c.adminEmail)
    await expect(page.getByRole('link', { name: /na schválení/ })).toBeVisible()
    await page.goto('/trener/vice/zadosti')
    const card = page.locator('li', { hasText: child.name }).first()
    await expect(card).toContainText('Jana Kotova')
    await expectAccessible(page, 'Žádosti o přijetí')
    await card.getByRole('button', { name: 'Schválit' }).click()
    await expect(
      page.getByRole('status').filter({ hasText: `Schváleno · ${child.name}` }),
    ).toBeVisible()

    expect(await deliveredTo(request, parent, new RegExp(`^Přijato do klubu: ${child.name}`))).toBe(
      true,
    )

    // 321 · the link and its QR code, the administrator's to share.
    await page.goto('/trener/vice/pristup')
    await expect(page.getByRole('img', { name: 'QR kód s odkazem klubu' })).toBeVisible()
    await expect(page.getByText(`/klub/${code}`)).toBeVisible()
    await expectAccessible(page, 'Přístup do klubu')

    // 323 · a family turned away sees why, and asks again.
    const other = uniqueEmail('rodic.zamitnuty')
    const token = await apiUser(other)
    await joinClub(token)
    const rejected = await freshAthlete()
    const created = await rpc(token, 'create_athlete_with_guardian', {
      p_first_name: rejected.firstName,
      p_last_name: rejected.lastName,
      p_date_of_birth: rejected.dateOfBirth,
      p_workspace_id: c.workspaceId,
      p_sport_code: 'HOCKEY',
      p_attributes: { position: rejected.position, stick_side: rejected.stickSide },
    })
    expect(created.ok, `registering failed: ${created.code}`).toBe(true)
    const membership = (
      (await (
        await fetch(
          `${STACK}/rest/v1/workspace_athlete_memberships?select=id&athlete_id=eq.${await athleteIdFor(token, rejected.firstName)}`,
          { headers: asUser(token) },
        )
      ).json()) as { id: string }[]
    )[0]?.id
    expect(
      (
        await rpc(c.adminToken, 'decide_join_request', {
          p_membership_id: membership,
          p_approve: false,
        })
      ).ok,
    ).toBe(true)

    await page.context().clearCookies()
    await signIn(page, other)
    await page.goto('/moji-sportovci')
    await expect(page.getByText('Zamítnuto').first()).toBeVisible()
    await page.getByRole('link', { name: new RegExp(rejected.name) }).click()
    await page.getByRole('button', { name: 'Požádat znovu' }).click()
    await expect(page.getByText('Čekáme na schválení klubem')).toBeVisible()
  })

  test('a parent invites the other parent, who signs in to the same child (AC-324, AC-325)', async ({
    page,
  }) => {
    const c = await club(Date.now())
    const child = await bookedChild(c.assisted)
    const second = uniqueEmail('druhy.rodic')
    const athleteId = await athleteIdFor(child.parentToken, child.athlete.firstName)

    await signIn(page, child.parentEmail)
    await page.goto(`/moji-sportovci/${athleteId}`)
    // G8b draws Měsíc / Sezóna inside a padded card: it fits a 390 px phone.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await page.getByRole('button', { name: 'Pozvat dalšího rodiče' }).click()
    const sheet = page.getByRole('dialog')
    await sheet.getByLabel('E-mail druhého rodiče').fill(second)
    await expectAccessible(page, 'the invitation sheet')
    await sheet.getByRole('button', { name: 'Poslat pozvánku' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Pozvánka odeslána' })).toBeVisible()
    await expect(page.getByText(second)).toBeVisible()

    expect(await mailTo(second, /^Pozvánka: /)).toBe(true)

    await page.context().clearCookies()
    await signIn(page, second)
    await page.goto('/moji-sportovci')
    await expect(page.getByText(child.name)).toBeVisible()
    await page.goto('/moje-treninky')
    await expect(page.getByText(child.name).first()).toBeVisible()
  })
})
