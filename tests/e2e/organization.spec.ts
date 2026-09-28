import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {
  grantCoach,
  grantWorkspaceRole,
  organizationRow,
  resetOrganization,
  signIn,
  storedLogoUrl,
  uniqueEmail,
} from './helpers'

/**
 * The club's name and mark (admin/SPEC.md §4 tests 5–10, guardian §6 test 10).
 *
 * Serial, and it puts the row back afterwards: the organization is one row
 * shared by the whole run, and a parallel worker asserting on the club's name
 * would be asserting on whatever this spec last set.
 */
test.describe.configure({ mode: 'serial' })

/** A real PNG of a given size, made by the browser that will later crop one. */
async function pngFile(page: Page, width: number, height: number) {
  const dataUrl = await page.evaluate(
    ({ w, h }) => {
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const context = canvas.getContext('2d')
      if (!context) throw new Error('no 2d context')
      context.fillStyle = '#2b55e0'
      context.fillRect(0, 0, w, h)
      context.fillStyle = '#ffffff'
      context.fillRect(w / 4, h / 4, w / 2, h / 2)
      return canvas.toDataURL('image/png')
    },
    { w: width, h: height },
  )

  return {
    name: 'znak.png',
    mimeType: 'image/png',
    buffer: Buffer.from(dataUrl.split(',')[1] ?? '', 'base64'),
  }
}

/** The dimensions of a PNG, read from its IHDR chunk. */
function pngSize(bytes: Buffer): { width: number; height: number } {
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

async function openOrganization(page: Page) {
  await page.goto('/trener/vice/organizace')
  await expect(page.getByRole('heading', { name: 'Organizace' })).toBeVisible()
}

async function adminPage(page: Page) {
  const email = uniqueEmail('spravce')
  await signIn(page, email)
  await grantWorkspaceRole(email, 'WORKSPACE_ADMIN')
  return email
}

test.afterAll(async () => {
  await resetOrganization()
})

test('a coach who is not an administrator is sent away (admin test 5)', async ({ page }) => {
  const email = uniqueEmail('trener')
  await signIn(page, email)
  await grantCoach(email)

  await page.goto('/trener/vice/organizace')

  // Not a screen with the controls hidden: the redirect uses the same
  // predicate that would refuse the write.
  await expect(page).toHaveURL(/\/trener$/)
  await expect(page.getByRole('heading', { name: 'Organizace' })).toHaveCount(0)
})

test('a file that cannot be a logo is refused before anything is uploaded (admin test 9)', async ({
  page,
}) => {
  await adminPage(page)
  await openOrganization(page)

  const picker = page.locator('input[type="file"]')

  await picker.setInputFiles({
    name: 'velky.png',
    mimeType: 'image/png',
    buffer: Buffer.alloc(3 * 1024 * 1024, 1),
  })
  await expect(page.getByText('Soubor je větší než 2 MB.')).toBeVisible()

  await picker.setInputFiles({
    name: 'znak.gif',
    mimeType: 'image/gif',
    buffer: Buffer.from('GIF89a'),
  })
  await expect(
    page.getByText('Tento formát nepodporujeme. Nahrajte PNG, SVG nebo JPG.'),
  ).toBeVisible()

  await picker.setInputFiles(await pngFile(page, 100, 100))
  await expect(page.getByText('Logo je příliš malé. Nahrajte alespoň 256 × 256 px.')).toBeVisible()

  // The sheet never opened, so nothing was cropped and nothing was sent.
  await expect(page.getByRole('heading', { name: 'Upravit logo' })).toHaveCount(0)
  expect((await organizationRow()).logo_path).toBeNull()
})

test('uploading a mark stores a 512px PNG and shows it everywhere (admin tests 6, 7)', async ({
  page,
  browser,
}) => {
  await adminPage(page)
  await openOrganization(page)

  // A4b first: no mark, so the monogram of the club's name stands in for one.
  await expect(page.getByText('HŠ')).toBeVisible()
  await expect(page.getByText('Nahrát logo')).toBeVisible()

  // An SVG, which is the case that must never reach the bucket as it is.
  await page.locator('input[type="file"]').setInputFiles({
    name: 'znak.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">' +
        '<rect width="400" height="400" fill="#2b55e0"/>' +
        '<circle cx="200" cy="200" r="120" fill="#ffffff"/></svg>',
    ),
  })

  await expect(page.getByRole('heading', { name: 'Upravit logo' })).toBeVisible()
  await expect(page.getByLabel('Velikost')).toBeVisible()

  const sheetViolations = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  expect(
    sheetViolations.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'),
  ).toEqual([])

  await page.getByRole('button', { name: 'Použít logo' }).click()
  await expect(page.getByRole('heading', { name: 'Upravit logo' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Uložit' }).click()
  await expect(page.getByText('Uloženo')).toBeVisible()

  const stored = await organizationRow()
  expect(stored.logo_path).toMatch(new RegExp(`^logos/${stored.id}/[0-9a-f-]+\\.png$`))

  // The SVG was rasterised in the browser: what is in the bucket is a PNG of
  // exactly the size we store, and not the document that was chosen.
  const response = await fetch(storedLogoUrl(stored.logo_path ?? ''))
  expect(response.headers.get('content-type')).toContain('image/png')
  const bytes = Buffer.from(await response.arrayBuffer())
  expect(pngSize(bytes)).toEqual({ width: 512, height: 512 })

  await openOrganization(page)
  await expect(page.locator('main img')).toBeVisible()

  const adminViolations = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  expect(
    adminViolations.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'),
  ).toEqual([])

  // The parent's side, in a context of its own: a different person entirely.
  const guardian = await browser.newContext()
  const parent = await guardian.newPage()
  await signIn(parent, uniqueEmail('rodic'))
  await parent.goto('/treninky')
  await expect(parent.getByRole('heading', { name: 'Tréninky' })).toBeVisible()
  await expect(parent.locator('header img')).toBeVisible()
  await expect(parent.getByText('Hokejová škola Příbram')).toBeVisible()
  await guardian.close()

  // And the sign-in screen, where nobody is signed in at all.
  const visitor = await browser.newContext()
  const anonymous = await visitor.newPage()
  await anonymous.goto('/prihlaseni')
  await expect(anonymous.locator('header img')).toBeVisible()
  await expect(anonymous.getByText('Hokejová škola Příbram')).toBeVisible()
  await expect(anonymous.getByText('Rezervace tréninků')).toBeVisible()
  await expect(anonymous.getByText('Běží na')).toBeVisible()

  const loginViolations = await new AxeBuilder({ page: anonymous })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  expect(
    loginViolations.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'),
  ).toEqual([])
  await visitor.close()
})

test('removing the mark brings the monogram back and deletes the object (admin test 8)', async ({
  page,
  browser,
}) => {
  const before = await organizationRow()
  expect(before.logo_path).not.toBeNull()
  const previous = storedLogoUrl(before.logo_path ?? '')

  await adminPage(page)
  await openOrganization(page)

  await page.getByRole('button', { name: 'Odebrat logo' }).click()
  await page.getByRole('button', { name: 'Odebrat', exact: true }).click()
  await page.getByRole('button', { name: 'Uložit' }).click()
  await expect(page.getByText('Uloženo')).toBeVisible()

  expect((await organizationRow()).logo_path).toBeNull()

  // The object itself is gone, not merely unreferenced: it sat in a public
  // bucket behind a URL anybody could have kept. Storage answers a missing
  // object with 400 and a body that says so, not with 404.
  const gone = await fetch(previous)
  expect(gone.ok).toBe(false)
  expect(await gone.text()).toContain('not_found')

  const guardian = await browser.newContext()
  const parent = await guardian.newPage()
  await signIn(parent, uniqueEmail('rodic'))
  await parent.goto('/treninky')
  await expect(parent.locator('header').getByText('HŠ')).toBeVisible()
  await expect(parent.locator('header img')).toHaveCount(0)
  await guardian.close()
})

test('the monogram follows the name as it is typed (admin test 10)', async ({ page, browser }) => {
  await adminPage(page)
  await openOrganization(page)

  const name = page.getByLabel('Název organizace')
  await expect(page.getByText('HŠ')).toBeVisible()

  await name.fill('Sportovní klub Dobříš')
  // Live, before anything is saved: the monogram is what a parent will see, so
  // it is shown while the decision is still being made.
  await expect(page.getByText('SK')).toBeVisible()

  await page.getByLabel('Krátký název').fill('SK Dobříš')
  await page.getByRole('button', { name: 'Uložit' }).click()
  await expect(page.getByText('Uloženo')).toBeVisible()

  const saved = await organizationRow()
  expect(saved.name).toBe('Sportovní klub Dobříš')
  expect(saved.short_name).toBe('SK Dobříš')

  const visitor = await browser.newContext()
  const anonymous = await visitor.newPage()
  await anonymous.goto('/prihlaseni')
  await expect(anonymous.getByText('Sportovní klub Dobříš')).toBeVisible()
  await expect(anonymous.getByText('SK', { exact: true })).toBeVisible()
  await visitor.close()
})
