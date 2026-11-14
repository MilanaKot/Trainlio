import { expect, test } from '@playwright/test'
import {
  SERVICE,
  STACK,
  apiUser,
  asUser,
  expectAccessible,
  freshAthlete,
  grantCoach,
  signIn,
  uniqueEmail,
  joinClub,
  approveAthlete,
} from './helpers'

/**
 * Coach test 11, v3.6 (decision 49): K12's year filter is a YearGrid, every
 * year in sight on a phone, newest first, and forgotten when the coach leaves.
 */

test.use({ viewport: { width: 390, height: 844 } })

const YEARS = [2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019]

/** At least one active athlete of each year, adding only the years missing. */
async function nineYears(): Promise<void> {
  const existing = (await (
    await fetch(`${STACK}/rest/v1/athletes?select=date_of_birth&is_active=eq.true`, {
      headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}` },
    })
  ).json()) as { date_of_birth: string }[]
  const present = new Set(existing.map((row) => Number(row.date_of_birth.slice(0, 4))))
  for (const year of YEARS.filter((y) => !present.has(y))) {
    const token = await apiUser(uniqueEmail('rodina.rocnik'))
    await joinClub(token)
    const workspaces = (await (
      await fetch(`${STACK}/rest/v1/rpc/joinable_workspaces`, {
        method: 'POST',
        headers: asUser(token),
        body: '{}',
      })
    ).json()) as { id: string }[]
    const child = await freshAthlete({ birthYear: year })
    const created = (await (
      await fetch(`${STACK}/rest/v1/rpc/create_athlete_with_guardian`, {
        method: 'POST',
        headers: asUser(token),
        body: JSON.stringify({
          p_first_name: child.firstName,
          p_last_name: child.lastName,
          p_date_of_birth: child.dateOfBirth,
          p_workspace_id: workspaces[0]?.id,
          p_sport_code: 'HOCKEY',
          p_attributes: { position: child.position, stick_side: child.stickSide },
        }),
      })
    ).json()) as { ok?: boolean; data?: { athlete_id?: string } }
    expect(created.ok).toBe(true)
    // K12 lists the club's children, which a waiting one is not yet.
    await approveAthlete(created.data?.athlete_id)
  }
}

test('every birth year fits on a phone, 2018 filters, and Všechny comes back (test 11, AC-313)', async ({
  page,
}) => {
  await nineYears()
  const coach = uniqueEmail('trener.rocniky')
  await signIn(page, coach)
  await grantCoach(coach)

  await page.goto('/trener/sportovci')
  const grid = page.getByRole('group', { name: 'Ročník' })
  await expect(grid).toBeVisible()
  await expect(grid.getByRole('button', { name: 'Všechny' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  // Newest first, and every chip inside the screen: nothing scrolls sideways.
  const chips = grid.getByRole('button')
  const labels = await chips.allTextContents()
  const years = labels.slice(1).map((label) => Number(label.slice(0, 4)))
  expect(years.length).toBeGreaterThanOrEqual(9)
  expect(years).toEqual([...years].sort((a, b) => b - a))
  for (let index = 0; index < (await chips.count()); index += 1) {
    const box = await chips.nth(index).boundingBox()
    expect(box, `chip ${labels[index]}`).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(390)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await expectAccessible(page, 'K12 the YearGrid')

  // 2018: only that group, and `x z n` in the header.
  const total = Number(await page.locator('main header span').first().textContent())
  const chip = grid.getByRole('button', { name: /^2018, / })
  const count = Number((await chip.getAttribute('aria-label'))?.split(', ')[1])
  await chip.click()
  await expect(chip).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('main header span').first()).toHaveText(`${count} z ${total}`)
  await expect(page.getByRole('heading', { name: /^Ročník / })).toHaveCount(1)
  await expect(page.getByRole('heading', { name: /^Ročník 2018/ })).toBeVisible()

  // Not remembered: away and back is `Všechny` again.
  await page.getByRole('link', { name: 'Tréninky' }).click()
  await page.waitForURL(/\/trener$/)
  await page.getByRole('link', { name: 'Sportovci' }).click()
  await expect(
    page.getByRole('group', { name: 'Ročník' }).getByRole('button', { name: 'Všechny' }),
  ).toHaveAttribute('aria-pressed', 'true')
})
