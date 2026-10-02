import { expect, test, type Page } from '@playwright/test'
import { grantCoach, grantWorkspaceRole, profileFor, signIn, uniqueEmail, MAILPIT } from './helpers'

/**
 * The Trenéři screen: who may add a coach and fill in their name, and who only
 * reads it.
 *
 * This exists because of what a browser found and no unit test could: a coach
 * who never opened Účet had no name, every session page said "Hlavní trenér —",
 * and the schema gave nobody a way to fix it. D-11 says the coach is the
 * product, so the empty name was a defect, not a blank field.
 */

/** The invitation Mailpit received, as text (§A6). */
async function readInvitation(email: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const box = (await (await fetch(`${MAILPIT}/api/v1/messages`)).json()) as {
      messages?: { ID: string; Subject?: string; To?: { Address: string }[] }[]
    }
    const message = box.messages?.find(
      (m) => m.To?.some((to) => to.Address === email) && m.Subject?.includes('Pozvánka'),
    )

    if (message) {
      const body = (await (await fetch(`${MAILPIT}/api/v1/message/${message.ID}`)).json()) as {
        Text?: string
        HTML?: string
      }
      return `${body.Text ?? ''}\n${body.HTML ?? ''}`
    }

    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  throw new Error(`No invitation reached ${email}`)
}

/**
 * The second half of signing in, when the address is already in the field.
 *
 * `signIn` types it; this one proves the invitation's link did (§A6). The code
 * is not sent by the link itself — a scanner fetching it would burn one.
 */
async function signInWithPrefilledAddress(page: Page, email: string): Promise<void> {
  await page.getByRole('button', { name: 'Poslat kód' }).click()
  await page.getByLabel('Kód').waitFor()
  // §6.26: the sixth digit submits.
  await page.getByLabel('Kód').fill(await readSignInCode(email))
  await page.waitForURL((url) => !url.pathname.includes('/prihlaseni'), { timeout: 30_000 })
}

/** The six digits GoTrue just e-mailed. */
async function readSignInCode(email: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const box = (await (await fetch(`${MAILPIT}/api/v1/messages`)).json()) as {
      messages?: { ID: string; Subject?: string; To?: { Address: string }[] }[]
    }
    const message = box.messages?.find(
      (m) => m.To?.some((to) => to.Address === email) && !m.Subject?.includes('Pozvánka'),
    )

    if (message) {
      const body = (await (await fetch(`${MAILPIT}/api/v1/message/${message.ID}`)).json()) as {
        Text?: string
        HTML?: string
      }
      const code = /\b(\d{6})\b/.exec(body.Text ?? body.HTML ?? '')?.[1]
      if (code) return code
    }

    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  throw new Error(`No sign-in code reached ${email}`)
}

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
    // §A3 KONTAKT (decision 28). What a parent is given when this coach removes
    // their child — and the only place a parent ever meets it (§G6d).
    await page.getByLabel('Telefon').fill('777 123 456')
    await page.getByRole('button', { name: 'Uložit změny' }).click()
    await expect(page.getByText(`Pavel Zeman${run}`)).toBeVisible()

    // Read back from the database, grouped as a person reads it.
    await page.goto(`/trener/vice/treneri/${await profileFor(admin)}`)
    await expect(page.getByLabel('Telefon')).toHaveValue('777 123 456')
    // The shape is the column's, so the refusal is the same one it would give.
    await page.getByLabel('Telefon').fill('12345')
    await page.getByRole('button', { name: 'Uložit změny' }).click()
    await expect(page.getByText('Zadejte platné telefonní číslo.')).toBeVisible()
    await page.getByLabel('Telefon').fill('777 123 456')

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
    // §A1 (v3): the meta answers whether this coach can get in, and this one
    // was added without an address.
    await expect(added).toContainText('Chybí e-mail')
    await expect(added).toContainText('Bez přístupu')

    // AC-249: leaving is a deactivation, never a delete, and it is reversible.
    await added.click()
    // The switch itself is visually hidden; the label is the target, which is
    // also what a thumb hits.
    await page.locator('label', { hasText: 'Aktivní trenér' }).click()
    await page.getByRole('button', { name: 'Uložit změny' }).click()

    // Scoped to this run's own row: the list is shared, and other runs leave
    // their own deactivated coaches in the same section.
    const inactive = page.locator('section', { hasText: 'NEAKTIVNÍ' })
    const inactiveRow = inactive.locator('li', { hasText: `Petr ${surname}` })
    await expect(inactiveRow).toBeVisible()
    await expect(inactiveRow).toContainText('Nezobrazuje se při výběru trenérů')
    await expect(inactiveRow).toContainText('Neaktivní')

    await inactiveRow.getByRole('link', { name: new RegExp(`Petr ${surname}`) }).click()
    // The switch itself is visually hidden; the label is the target, which is
    // also what a thumb hits.
    await page.locator('label', { hasText: 'Aktivní trenér' }).click()
    await page.getByRole('button', { name: 'Uložit změny' }).click()
    await expect(
      page.locator('section', { hasText: 'AKTIVNÍ' }).locator('li', {
        hasText: `Petr ${surname}`,
      }),
    ).toBeVisible()

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

  /**
   * Admin tests 11 to 13 (§A2, §A3b, §A6, §K0). The hole this closed: a coach
   * added on A2 could lead trainings and could not sign in, and nobody in the
   * application could give them a login.
   */
  test('invites a coach, who signs in as themselves (AC-289)', async ({ page }) => {
    const admin = uniqueEmail('spravce.pozvanka')
    await signIn(page, admin)
    await grantWorkspaceRole(admin, 'WORKSPACE_ADMIN')

    const run = Date.now()
    const coachEmail = uniqueEmail('trener.pozvany')

    await page.goto('/trener/vice/treneri/novy')
    await page.getByLabel('Jméno').fill('Petr')
    await page.getByLabel('Příjmení').fill(`Pozvaný${run}`)
    await page.getByLabel('E-mail').fill(coachEmail)
    await page.getByLabel('Telefon').fill('777 222 333')

    // §A2: the button says what saving will do, because it will send an e-mail.
    await page.getByRole('button', { name: 'Přidat a poslat pozvánku' }).click()
    await expect(page.getByText('Trenér přidán, pozvánka odeslána')).toBeVisible()

    // §A1: the state the design gives them until they first sign in.
    const row = page.locator('li', { hasText: `Petr Pozvaný${run}` })
    await expect(row).toContainText('Pozván')
    await expect(row).toContainText('Ještě se nepřihlásil')

    // §A3b: a second invitation inside the hour is refused by the database.
    await row.getByRole('link').click()
    await expect(page.getByText('Čeká na první přihlášení')).toBeVisible()
    await page.getByRole('button', { name: 'Poslat pozvánku znovu' }).click()
    await expect(page.getByText('Pozvánku lze poslat znovu nejdřív za hodinu.')).toBeVisible()

    // §A6: the message itself, with the link that prefills the address.
    const invitation = await readInvitation(coachEmail)
    expect(invitation).toContain('Pozvánka do aplikace')
    expect(invitation).toContain(`Petr Pozvaný${run}`)
    expect(invitation).toContain('pozvánka nevyprší')
    expect(invitation).toContain(`/prihlaseni?email=${encodeURIComponent(coachEmail)}`)

    // Sign out, and sign in as the coach — through the invitation's own link.
    await page.goto('/trener/vice')
    await page.getByRole('button', { name: 'Odhlásit se z aplikace' }).click()
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Odhlásit se', exact: true })
      .click()
    await page.waitForURL(/\/prihlaseni/)

    await page.goto(`/prihlaseni?email=${encodeURIComponent(coachEmail)}`)
    await expect(page.getByLabel('E-mail')).toHaveValue(coachEmail)
    await signInWithPrefilledAddress(page, coachEmail)

    // §K0, once: the coach lands on the welcome screen and not on the list.
    await expect(page).toHaveURL(/\/trener\/vitejte$/)
    await expect(page.getByRole('heading', { name: 'Vítejte v týmu' })).toBeVisible()
    // The profile they were attached to is the one the administrator named —
    // not a second one made by signing up.
    await expect(page.getByText(`Petr Pozvaný${run}`)).toBeVisible()
    await page.getByLabel('Váš telefon').fill('777 999 000')
    await page.getByRole('button', { name: 'Pokračovat na tréninky' }).click()

    await expect(page).toHaveURL(/\/trener$/)
    // And never again: §K0 is shown once.
    await page.goto('/trener')
    await expect(page).toHaveURL(/\/trener$/)
    await expect(page.getByRole('heading', { name: 'Tréninky' })).toBeVisible()
  })

  /**
   * Admin tests 14 and 15 (§A3 ROLE, §A3d, §A3e). The role had been in the
   * schema since the first migration with nothing in the application reading
   * it.
   */
  test('grants and revokes the administrator role (AC-290)', async ({ page }) => {
    const admin = uniqueEmail('spravce.role')
    await signIn(page, admin)
    await grantWorkspaceRole(admin, 'WORKSPACE_ADMIN')

    const run = Date.now()
    await page.goto('/trener/vice/treneri/novy')
    await page.getByLabel('Jméno').fill('Jana')
    await page.getByLabel('Příjmení').fill(`Kolegová${run}`)
    await page.getByRole('button', { name: 'Přidat trenéra' }).click()
    await expect(page.getByText('Trenér přidán')).toBeVisible()

    // §A3: the switch, and what it says it does.
    await page.getByRole('link', { name: new RegExp(`Jana Kolegová${run}`) }).click()
    const adminSwitch = page.getByRole('switch', { name: 'Administrátor' })
    await expect(adminSwitch).not.toBeChecked()
    await page.locator('label', { hasText: 'Administrátor' }).click()
    await page.getByRole('button', { name: 'Uložit změny' }).click()
    await expect(page.getByText('Uloženo')).toBeVisible()

    await page.getByRole('link', { name: new RegExp(`Jana Kolegová${run}`) }).click()
    await expect(page.getByRole('switch', { name: 'Administrátor' })).toBeChecked()
    // §A1: the meta line answers the question an administrator is actually
    // asking — can this person get in — so a coach with no address says so
    // rather than announcing a role they cannot yet use.
    await page.goto('/trener/vice/treneri')
    const row = page.locator('li', { hasText: `Jana Kolegová${run}` })
    await expect(row).toContainText('Chybí e-mail')
    await expect(row).toContainText('Bez přístupu')

    // §A3e: revoking your own asks first, and the server refuses without it.
    // This administrator signed in and was granted the role; nobody has given
    // them a name yet, and §A3 requires both halves of one before it saves.
    await page.goto(`/trener/vice/treneri/${await profileFor(admin)}`)
    await page.getByLabel('Jméno').fill('Milana')
    await page.getByLabel('Příjmení').fill(`Správná${run}`)
    await page.locator('label', { hasText: 'Administrátor' }).click()
    await page.getByRole('button', { name: 'Uložit změny' }).click()

    const confirm = page.getByRole('alertdialog')
    await expect(confirm).toContainText('Odebrat si práva administrátora?')
    // Named, but not necessarily this run's: the database is shared between
    // runs and projects, and any other administrator could give them back.
    await expect(confirm).toContainText('Práva vám může vrátit jen')
    await confirm.getByRole('button', { name: 'Odebrat práva' }).click()

    // And the section it administers is gone from Více.
    await page.goto('/trener/vice')
    await expect(page.getByText('SPRÁVA')).toHaveCount(0)
    await expect(page.getByRole('link', { name: /Trenéři/ })).toHaveCount(0)
    // Planning is every coach's, and stays.
    await expect(page.getByRole('link', { name: /Série tréninků/ })).toBeVisible()
  })

  test('a guardian never reaches the staff screen (AC-241)', async ({ page }) => {
    await signIn(page, uniqueEmail('rodic.stab'))

    await page.goto('/trener/vice/treneri')
    await expect(page).toHaveURL(/\/moji-sportovci/)
  })
})
