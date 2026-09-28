import { expect, test } from '@playwright/test'
import { grantCoach, grantWorkspaceRole, profileFor, signIn, uniqueEmail } from './helpers'

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

    await page.goto('/trener/vice/treneri')
    await expect(page.getByRole('heading', { name: 'Trenéři' })).toBeVisible()

    // Straight to this run's own row. The list is shared by every run against
    // this database, so `the first one called Bez jména` is somebody else's.
    const ownRow = page.getByRole('link', { name: /Bez jména/ })
    await expect(ownRow.first()).toBeVisible()
    await page.goto(`/trener/vice/treneri/${await profileFor(admin)}`)
    await expect(page.getByRole('heading', { name: 'Upravit trenéra' })).toBeVisible()

    // AC-243: a coach without a surname is not how a parent asks for them.
    await page.getByLabel('Jméno').fill('Pavel')
    await page.getByLabel('Příjmení').fill('')
    await page.getByRole('button', { name: 'Uložit změny' }).click()
    await expect(page.getByText('Vyplňte příjmení.')).toBeVisible()

    // Unique per run: the projects run in parallel against one database, and a
    // fixed surname matches the row a previous run left behind — which passes
    // this assertion before this run's own save has landed.
    const run = Date.now()
    await page.getByLabel('Příjmení').fill(`Zeman${run}`)
    await page.getByRole('button', { name: 'Uložit změny' }).click()
    await expect(page.getByText(`Pavel Zeman${run}`)).toBeVisible()

    // An administrator cannot switch themselves off (§A3), and the database
    // refuses the case that matters — the last active administrator — whatever
    // the form offers.
    await page.goto(`/trener/vice/treneri/${await profileFor(admin)}`)
    await expect(page.getByRole('switch', { name: 'Aktivní trenér' })).toBeDisabled()
    await expect(page.getByText('Nemůžete deaktivovat sám sebe.')).toBeVisible()
    await page.getByRole('button', { name: 'Zrušit' }).click()

    // AC-248: a coach the club employs but who has never signed in.
    const surname = `Málek${run}`
    await page.getByRole('link', { name: '+ Přidat trenéra' }).click()
    await page.getByLabel('Jméno').fill('Petr')
    await page.getByLabel('Příjmení').fill(surname)
    await page.getByRole('button', { name: 'Přidat trenéra' }).click()

    await expect(page.getByText('Trenér přidán')).toBeVisible()
    const added = page.getByRole('link', { name: new RegExp(`Petr ${surname}`) })
    await expect(added).toBeVisible()
    await expect(added).toContainText('Bez přihlášení')

    // AC-249: leaving is a deactivation, never a delete, and it is reversible.
    await added.click()
    // The switch itself is visually hidden; the label is the target, which is
    // also what a thumb hits.
    await page.locator('label', { hasText: 'Aktivní trenér' }).click()
    await page.getByRole('button', { name: 'Uložit změny' }).click()

    const inactive = page.locator('section', { hasText: 'NEAKTIVNÍ' })
    await expect(inactive.getByText(`Petr ${surname}`)).toBeVisible()
    await expect(inactive.getByText('Nezobrazuje se při výběru trenérů')).toBeVisible()

    await inactive.getByRole('link', { name: new RegExp(`Petr ${surname}`) }).click()
    // The switch itself is visually hidden; the label is the target, which is
    // also what a thumb hits.
    await page.locator('label', { hasText: 'Aktivní trenér' }).click()
    await page.getByRole('button', { name: 'Uložit změny' }).click()
    await expect(page.locator('section', { hasText: 'NEAKTIVNÍ' })).toHaveCount(0)

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

    await page.goto('/trener/vice/treneri')
    await expect(page.getByText(`Pavel Zeman${run}`)).toBeVisible()
    // Visible, and not editable: the rows are not even links for a coach who
    // cannot open what is behind them (§A1).
    await expect(page.getByRole('link', { name: '+ Přidat trenéra' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: new RegExp(`Pavel Zeman${run}`) })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '+ Přidat trenéra' })).toHaveCount(0)
  })

  test('a guardian never reaches the staff screen (AC-241)', async ({ page }) => {
    await signIn(page, uniqueEmail('rodic.stab'))

    await page.goto('/trener/vice/treneri')
    await expect(page).toHaveURL(/\/moji-sportovci/)
  })
})
