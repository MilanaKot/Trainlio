import { expect, test } from '@playwright/test'
import { grantCoach, grantWorkspaceRole, signIn, uniqueEmail } from './helpers'

/**
 * The Trenéři screen: who may add a coach and fill in their name, and who only
 * reads it.
 *
 * This exists because of what a browser found and no unit test could: a coach
 * who never opened Účet had no name, every session page said "Hlavní trenér —",
 * and the schema gave nobody a way to fix it. D-11 says the coach is the
 * product, so the empty name was a defect, not a blank field.
 */

test.describe('a workspace administrator manages the coaching staff', () => {
  test('adds a coach, names themselves, and a coach can only read it', async ({ page }) => {
    // Signed in through the interface first, then granted the role: two OTP
    // requests for one address inside a minute is what GoTrue rate-limits.
    const admin = uniqueEmail('spravce')
    await signIn(page, admin)
    await grantWorkspaceRole(admin, 'WORKSPACE_ADMIN')

    await page.goto('/trener/treneri')
    await expect(page.getByRole('heading', { name: 'Trenéři' })).toBeVisible()

    // A fresh profile has no name at all, and the screen says so rather than
    // rendering an empty line nobody notices (AC-240).
    const own = page.locator('li', { hasText: 'Bez jména' }).first()
    await expect(own).toBeVisible()

    await own.getByRole('button', { name: 'Upravit jméno' }).click()

    // AC-243: a coach without a surname is not how a parent asks for them, and
    // the refusal comes from the domain function, not from this form.
    await own.getByLabel('Jméno').fill('Pavel')
    await own.getByLabel('Příjmení').fill('')
    await own.getByRole('button', { name: 'Uložit' }).click()
    // Scoped to the row: Next's route announcer is also role=alert, so an
    // unscoped query matches two elements and resolves the empty one.
    await expect(own.getByRole('alert')).toHaveText('Zadejte jméno i příjmení.')

    // Unique per run: the projects run in parallel against one database, and a
    // fixed surname matches the row a previous run left behind — which passes
    // this assertion before this run's own save has landed.
    const run = Date.now()
    await own.getByLabel('Příjmení').fill(`Zeman${run}`)
    await own.getByRole('button', { name: 'Uložit' }).click()
    await expect(page.getByText(`Pavel Zeman${run}`)).toBeVisible()

    // AC-248: a coach the club employs but who has never signed in.
    const surname = `Málek${run}`
    await page.getByRole('button', { name: '+ Přidat trenéra' }).click()
    const addForm = page.locator('form', { hasText: 'Nový trenér' })
    await addForm.getByLabel('Jméno').fill('Petr')
    await addForm.getByLabel('Příjmení').fill(surname)
    await addForm.getByRole('button', { name: 'Přidat', exact: true }).click()

    const added = page.locator('li', { hasText: `Petr ${surname}` })
    await expect(added).toBeVisible()
    await expect(added.getByText('Bez přihlášení')).toBeVisible()

    // AC-249: leaving is a deactivation, never a delete, and it is reversible.
    await added.getByRole('button', { name: 'Deaktivovat' }).click()
    await expect(added.getByText('Neaktivní')).toBeVisible()
    await added.getByRole('button', { name: 'Znovu aktivovat' }).click()
    await expect(added.getByText('Neaktivní')).toHaveCount(0)

    // The same list, read by a coach who is not an administrator: visible, and
    // not editable. The screen asks the database, so this is the same answer
    // the write would give (AC-241).
    const coach = uniqueEmail('trener.stab')
    // Signed in as the administrator, /prihlaseni sends you where you already
    // belong, so the sign-in form is only reachable after signing out — which
    // lives on `Více` (§A0) and asks first, because `Odhlásit` on its own
    // means cancelling a training in this product.
    await page.goto('/trener/vice')
    await page.getByRole('button', { name: 'Odhlásit se z aplikace' }).click()
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Odhlásit se', exact: true })
      .click()
    await page.waitForURL(/\/prihlaseni/)
    await signIn(page, coach)
    await grantCoach(coach)

    await page.goto('/trener/treneri')
    await expect(page.getByText(`Pavel Zeman${run}`)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Upravit jméno' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '+ Přidat trenéra' })).toHaveCount(0)
  })

  test('a guardian never reaches the staff screen (AC-241)', async ({ page }) => {
    await signIn(page, uniqueEmail('rodic.stab'))

    await page.goto('/trener/treneri')
    await expect(page).toHaveURL(/\/moji-sportovci/)
  })
})
