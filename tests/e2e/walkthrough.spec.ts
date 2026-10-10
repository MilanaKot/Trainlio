import { test, expect, type Page } from '@playwright/test'
import { dateInput, grantCoach, signIn, uniqueEmail, MAILPIT } from './helpers'

/**
 * The product, end to end, as two people meet it.
 *
 * Not an assertion suite — `coach-flow`, `guardian-flow` and the rest are
 * that. This walks one story in order, a coach and a parent, and photographs
 * every screen and every e-mail along the way, so the whole thing can be read
 * without a database or a terminal. Run it when somebody needs to see the
 * product rather than a test report:
 *
 *   WALKTHROUGH=1 npx playwright test tests/e2e/walkthrough.spec.ts --project=mobile
 *
 * It leaves numbered PNGs in ./walkthrough at the phone viewport the design is
 * drawn for. The e-mails are the real ones: the outbox is drained through the
 * route Vercel's cron calls, and Mailpit renders what Resend would send.
 */

const OUT = 'walkthrough'

test.skip(!process.env.WALKTHROUGH, 'Run with WALKTHROUGH=1 to regenerate the walkthrough.')
test.describe.configure({ mode: 'serial' })

async function shoot(page: Page, name: string, { full = false }: { full?: boolean } = {}) {
  await page.waitForFunction(() =>
    [...document.images].every((image) => image.complete && image.naturalWidth > 0),
  )
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full })
}

/**
 * Empties the outbox the way production does: the cron route, with the secret
 * Vercel sends. Nothing is posted to Resend locally — `EMAIL_TRANSPORT=mailpit`
 * puts the same message in the local inbox instead.
 */
async function deliver(page: Page) {
  const secret = process.env.CRON_SECRET ?? 'local-development-secret-value'
  const response = await page.request.get('/api/notifications/drain', {
    headers: { authorization: `Bearer ${secret}` },
  })
  expect(response.ok(), 'the drain route answered').toBe(true)
}

/** The newest message Mailpit holds for an address whose subject matches. */
async function mail(address: string, subject: RegExp): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const box = (await (await fetch(`${MAILPIT}/api/v1/messages?limit=200`)).json()) as {
      messages?: { ID: string; Subject: string; To?: { Address: string }[] }[]
    }
    const message = box.messages?.find(
      (one) => one.To?.some((to) => to.Address === address) && subject.test(one.Subject),
    )
    if (message) return message.ID
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`No message matching ${subject} reached ${address}`)
}

/** The six digits inside a message Mailpit holds. */
async function codeIn(id: string): Promise<string> {
  const body = (await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()) as {
    Text?: string
    HTML?: string
  }
  const code = /\b(\d{6})\b/.exec(body.Text ?? body.HTML ?? '')?.[1]
  if (!code) throw new Error(`No code in message ${id}`)
  return code
}

/** Mailpit renders the message itself, so this is the e-mail as it arrives. */
async function shootMail(page: Page, id: string, name: string) {
  await page.goto(`${MAILPIT}/view/${id}.html`)
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true })
}

test('a coach opens a training, a parent books, and the training changes', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000)

  // ─── The coach ────────────────────────────────────────────────────────────
  const coachEmail = uniqueEmail('trener.milan')
  await signIn(page, coachEmail)
  await grantCoach(coachEmail)

  // A name, because D-11 says the coach is the product and a parent reads it.
  await page.goto('/ucet/udaje')
  await page.getByLabel('Jméno').fill('Milan')
  await page.getByLabel('Příjmení').fill('Filipi')
  await page.getByRole('button', { name: 'Uložit' }).click()

  const room = `Šatna ${100 + Math.floor(Math.random() * 900)}`
  await page.goto('/trener/novy')
  await page.getByLabel('Datum').fill(dateInput(7))
  await page.getByLabel('Začátek').fill('17:00')
  await page.getByLabel('Konec').fill('18:00')
  await page.getByLabel('Kapacita', { exact: true }).fill('10')
  await page.getByLabel('Šatna').fill(room)
  await shoot(page, '01-trener-novy-trenink', { full: true })

  await page.getByRole('button', { name: 'Vytvořit trénink' }).click()
  await expect(page.getByRole('heading', { name: /Sportovci/ })).toBeVisible()
  const sessionId = page.url().split('/trener/')[1]?.split('/')[0] ?? ''
  await shoot(page, '02-trener-detail-prazdny', { full: true })

  // ─── The parent, in a browser of their own ────────────────────────────────
  const family = await browser.newContext()
  const parent = await family.newPage()
  const parentEmail = uniqueEmail('rodina.novakova')

  await parent.goto('/prihlaseni')
  await shoot(parent, '03-rodic-prihlaseni')
  await parent.getByLabel('E-mail').fill(parentEmail)
  await parent.getByRole('button', { name: 'Poslat kód' }).click()
  await parent.getByLabel('Kód').waitFor()
  await shoot(parent, '04-rodic-kod')

  // The code itself, as it lands in the inbox.
  const codeMail = await mail(parentEmail, /Přihlášení|Trainlio/)
  const mailShot = await family.newPage()
  await shootMail(mailShot, codeMail, '05-email-prihlasovaci-kod')
  await mailShot.close()

  // The code from that same message. Asking `signIn` would request a second
  // one, and GoTrue holds a cooldown between two codes to one address.
  await parent.getByLabel('Kód').fill(await codeIn(codeMail))
  await parent.waitForURL((url) => !url.pathname.includes('/prihlaseni'), { timeout: 30_000 })

  // The first child, which is also where the parent says who they are (§G16).
  await parent.goto('/moji-sportovci/novy')
  await parent.getByLabel('Jméno').first().fill('Hana')
  await parent.getByLabel('Příjmení').first().fill('Nováková')
  await parent.getByLabel('Telefon').fill('777 123 456')
  await parent.getByLabel('Jméno').last().fill('Eliška')
  await parent.getByLabel('Příjmení').last().fill('Nováková')
  await parent.getByLabel('Datum narození').fill('2017-05-05')
  await parent.getByRole('radio', { name: 'Centr' }).click()
  await parent.getByRole('radio', { name: 'Levá' }).click()
  await shoot(parent, '06-rodic-novy-sportovec', { full: true })
  await parent.getByRole('button', { name: 'Přidat sportovce' }).click()
  await expect(parent.getByText('Eliška Nováková')).toBeVisible()

  await parent.goto('/treninky')
  await expect(parent.locator('li', { hasText: room }).first()).toBeVisible()
  await shoot(parent, '07-rodic-treninky')

  await parent
    .locator('li', { hasText: room })
    .first()
    .getByRole('button', { name: 'Přihlásit' })
    .click()
  await shoot(parent, '08-rodic-prihlaseni-sheet')
  await parent.getByRole('dialog').getByRole('button', { name: 'Přihlásit' }).click()
  await expect(parent.getByRole('status')).toContainText('Přihlášeno')

  await parent.goto('/moje-treninky')
  await expect(parent.getByText('Eliška Nováková').first()).toBeVisible()
  await shoot(parent, '09-rodic-moje-treninky')

  // The coach sees the child, and who booked it.
  await page.goto(`/trener/${sessionId}`)
  await expect(page.getByRole('heading', { name: 'Sportovci 1' })).toBeVisible()
  await shoot(page, '10-trener-detail-s-dítětem', { full: true })

  // ─── The training moves ───────────────────────────────────────────────────
  await page.goto(`/trener/${sessionId}/upravit`)
  await page.getByLabel('Začátek').fill('18:30')
  await page.getByLabel('Konec').fill('19:30')
  await expect(page.getByText('Změnil se čas.')).toBeVisible()
  await shoot(page, '11-trener-upravit', { full: true })
  await page.getByRole('button', { name: 'Uložit změny' }).click()
  await expect(page.getByRole('heading', { name: /Sportovci/ })).toBeVisible()

  await deliver(page)
  const changeMail = await mail(parentEmail, /[Zz]měn/)
  const changeShot = await family.newPage()
  await shootMail(changeShot, changeMail, '12-email-zmena-treninku')
  await changeShot.close()

  // The parent's own screen says the same thing, without an e-mail client.
  await parent.goto('/moje-treninky')
  await shoot(parent, '13-rodic-zmeneno')

  // ─── The coach takes the child off the list ───────────────────────────────
  await page.goto(`/trener/${sessionId}`)
  await page.getByRole('button', { name: /Eliška Nováková/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Odhlásit z tréninku' }).click()
  const removal = page.getByRole('alertdialog')
  await removal
    .getByLabel('Zpráva pro rodiče')
    .fill('Dnes trénují jen brankáři, Elišku vezmu ve čtvrtek.')
  await shoot(page, '14-trener-odhlasuje')
  await removal.getByRole('button', { name: 'Odhlásit', exact: true }).click()
  await expect(page.getByText('Sportovec odhlášen')).toBeVisible()

  await deliver(page)
  const removalMail = await mail(parentEmail, /[Oo]dhlá|[Zz]měn/)
  const removalShot = await family.newPage()
  await shootMail(removalShot, removalMail, '15-email-odhlaseni')
  await removalShot.close()

  // D-06: the parent cannot put the child back. The coach is who they ring,
  // and the number is the one he published on his own account.
  await parent.goto('/moje-treninky')
  const card = parent.locator('main li', { hasText: 'Eliška Nováková' }).first()
  await expect(card).toContainText('Znovu přihlásit může jen trenér')
  await shoot(parent, '16-rodic-odhlasen')
  await card.getByRole('link').first().click()
  await expect(parent.getByText('Zpráva od trenéra')).toBeVisible()
  await shoot(parent, '17-rodic-detail-odhlasen', { full: true })

  // ─── And the training is called off ───────────────────────────────────────
  await page.goto(`/trener/${sessionId}`)
  await page.getByRole('button', { name: 'Zrušit trénink' }).click()
  const cancelling = page.getByRole('alertdialog')
  await expect(cancelling).toContainText('Zrušit trénink?')
  await shoot(page, '18-trener-rusi-trenink')
  await cancelling.getByRole('button', { name: 'Zrušit trénink' }).click()
  await expect(page.getByText('Trénink zrušen')).toBeVisible()
  await shoot(page, '19-trener-zruseno', { full: true })

  await family.close()
})
