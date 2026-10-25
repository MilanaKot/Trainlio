import { createHmac } from 'node:crypto'
import AxeBuilder from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'

/**
 * Helpers for the signed-in end-to-end flows.
 *
 * These drive the local Supabase stack's fixed development keys and Mailpit.
 * They never run against a real project: `STACK` is the loopback address the
 * CLI binds, and the anon key below is the CLI's published dev key.
 */

export const STACK = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'
export const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324'

export const ANON =
  process.env.ANON ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

export const SERVICE =
  process.env.SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const admin = {
  apikey: SERVICE,
  authorization: `Bearer ${SERVICE}`,
  'content-type': 'application/json',
}

/**
 * The local stack's published JWT secret, the one ANON and SERVICE above are
 * signed with. Like them it authenticates nothing outside a local stack.
 */
const JWT_SECRET =
  process.env.JWT_SECRET ?? 'super-secret-jwt-token-with-at-least-32-characters-long'

/**
 * A signed-in person for API calls only, without the sign-in.
 *
 * tokenFor() goes through GoTrue's OTP, which allows 30 sign-ins per five
 * minutes from one address; a suite that sets up an administrator, a coach and
 * a parent per test spends that in a minute, and then every browser sign-in
 * waits for a code that never comes. This creates the account through the
 * admin API, as the trigger expects, and signs the token itself. Keep
 * signIn() for what the browser does.
 */
export async function apiUser(email: string): Promise<string> {
  const created = await fetch(`${STACK}/auth/v1/admin/users`, {
    method: 'POST',
    headers: admin,
    body: JSON.stringify({ email, email_confirm: true }),
  })
  // 422: already there, from an earlier sign-in in the same test.
  if (!created.ok && created.status !== 422) {
    throw new Error(`Could not create ${email}: ${created.status}`)
  }

  const users = (await (
    await fetch(`${STACK}/auth/v1/admin/users?page=1&per_page=1000`, { headers: admin })
  ).json()) as { users?: { id: string; email: string }[] }
  const id = users.users?.find((user) => user.email === email)?.id
  if (!id) throw new Error(`No account for ${email}`)

  const encode = (part: object) => Buffer.from(JSON.stringify(part)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    sub: id,
    email,
    role: 'authenticated',
    aud: 'authenticated',
    iat: now,
    exp: now + 3600,
  })}`
  const signature = createHmac('sha256', JWT_SECRET).update(unsigned).digest('base64url')
  return `${unsigned}.${signature}`
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.test`
}

/** The six-digit code Supabase Auth just emailed, read from Mailpit. */
async function readCode(email: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const box = (await (await fetch(`${MAILPIT}/api/v1/messages`)).json()) as {
      messages?: { ID: string; To?: { Address: string }[] }[]
    }
    const message = box.messages?.find((m) => m.To?.some((t) => t.Address === email))

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

/**
 * Signs in through the interface a parent actually uses, not by injecting a
 * token. The OTP flow is itself an acceptance criterion (AC-001, AC-002), and a
 * test that skipped it would also skip the proxy that turns the session into
 * cookies — which is the part that has to work for every page below.
 */
export async function signIn(page: Page, email: string): Promise<void> {
  // A sign-out leaves the client router mid-navigation, and a `goto` that
  // arrives in that moment is aborted by it. Waiting for the page it is on to
  // settle first costs nothing and removes the race.
  await page.waitForLoadState('load').catch(() => undefined)
  await page.goto('/prihlaseni')
  await page.getByLabel('E-mail').fill(email)
  await page.getByRole('button', { name: 'Poslat kód' }).click()

  await page.getByLabel('Kód').waitFor()
  await page.getByLabel('Kód').fill(await readCode(email))

  // §6.26: the sixth digit submits, so nothing is clicked here. Pressing the
  // button as well raced the submission the code had already started, and the
  // second attempt arrived with a one-time code that had just been spent.
  await page.waitForURL((url) => !url.pathname.includes('/prihlaseni'), { timeout: 30_000 })
}

/**
 * A signed-in token for someone the test needs to exist but never plays: the
 * coach who opened the session a parent books into.
 *
 * Through the real OTP flow rather than the admin API, because the domain
 * functions resolve the actor from the JWT's subject. The service key carries
 * no subject, so calling them with it returns NOT_AUTHENTICATED — correctly:
 * the service role is for the drain job, not for acting as a person.
 */
// One token per address for the life of the worker. GoTrue holds a cooldown
// between one-time-code e-mails to the same address, so a test that asks twice
// — opening a session and then changing it, say — gets a 429 of its own
// making. A JWT is valid for an hour, which outlives any run.
const tokens = new Map<string, Promise<string>>()

export function tokenFor(email: string): Promise<string> {
  const cached = tokens.get(email)
  if (cached) return cached

  const issued = issueToken(email)
  tokens.set(email, issued)
  // A failed request must not be remembered, or every later call inherits it.
  void issued.catch(() => tokens.delete(email))
  return issued
}

async function issueToken(email: string): Promise<string> {
  const requested = await fetch(`${STACK}/auth/v1/otp`, {
    method: 'POST',
    headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ email, create_user: true }),
  })
  if (!requested.ok) throw new Error(`OTP request failed for ${email}: ${requested.status}`)

  const verified = (await (
    await fetch(`${STACK}/auth/v1/verify`, {
      method: 'POST',
      headers: { apikey: ANON, 'content-type': 'application/json' },
      body: JSON.stringify({ email, token: await readCode(email), type: 'email' }),
    })
  ).json()) as { access_token?: string }

  if (!verified.access_token) throw new Error(`Could not authenticate ${email}`)
  return verified.access_token
}

/** Headers for a request made as a signed-in person. */
export function asUser(token: string) {
  return {
    apikey: ANON,
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  }
}

/**
 * Makes a person workspace staff.
 *
 * There is no interface for this and there is not meant to be: granting a coach
 * role is an administrative act (D-17, and the deployment notes say the same).
 * The test does it the way an administrator would, with the service key.
 */
export async function grantCoach(
  email: string,
): Promise<{ workspaceId: string; profileId: string }> {
  return grantWorkspaceRole(email, 'COACH')
}

/** The same administrative act, for either workspace role (D-17). */
export async function grantWorkspaceRole(
  email: string,
  role: 'COACH' | 'WORKSPACE_ADMIN',
): Promise<{ workspaceId: string; profileId: string }> {
  const profileId = await profileFor(email)

  const workspaces = (await (
    await fetch(`${STACK}/rest/v1/workspaces?select=id&limit=1`, { headers: admin })
  ).json()) as { id: string }[]

  const workspaceId = workspaces[0]?.id
  if (!workspaceId) throw new Error('No workspace in the database')

  const response = await fetch(`${STACK}/rest/v1/workspace_members`, {
    method: 'POST',
    // Idempotent: a test that acts as the same coach twice — opening a session
    // and then changing it — asks for the role it already holds, and the
    // unique constraint answers 409. That is the desired state, not a failure.
    headers: { ...admin, prefer: 'resolution=ignore-duplicates' },
    body: JSON.stringify({ workspace_id: workspaceId, profile_id: profileId, role }),
  })
  if (!response.ok && response.status !== 409) {
    throw new Error(`Could not grant ${role}: ${response.status}`)
  }

  return { workspaceId, profileId }
}

/** The durable profile behind an email address. */
export async function profileFor(email: string): Promise<string> {
  const users = (await (
    await fetch(`${STACK}/auth/v1/admin/users?page=1&per_page=1000`, { headers: admin })
  ).json()) as { users?: { id: string; email: string }[] }

  const user = users.users?.find((u) => u.email === email)
  if (!user) throw new Error(`No authentication record for ${email}`)

  const profiles = (await (
    await fetch(`${STACK}/rest/v1/app_profiles?auth_user_id=eq.${user.id}&select=id`, {
      headers: admin,
    })
  ).json()) as { id: string }[]

  const profileId = profiles[0]?.id
  if (!profileId) throw new Error(`No profile for ${email}`)
  return profileId
}

/** A date input wants `YYYY-MM-DD`, whatever the display locale. */
export function dateInput(offsetDays: number): string {
  const at = new Date(Date.now() + offsetDays * 86_400_000)
  return at.toISOString().slice(0, 10)
}

/** The one workspace, as the organization screens edit it (migration 30). */
export async function organizationRow(): Promise<{
  id: string
  name: string
  short_name: string | null
  logo_path: string | null
  logo_background: string
}> {
  const rows = (await (
    await fetch(
      `${STACK}/rest/v1/workspaces?select=id,name,short_name,logo_path,logo_background&limit=1`,
      { headers: admin },
    )
  ).json()) as {
    id: string
    name: string
    short_name: string | null
    logo_path: string | null
    logo_background: string
  }[]

  const row = rows[0]
  if (!row) throw new Error('No workspace in the database')
  return row
}

/**
 * Puts the club's identity back the way the seed left it.
 *
 * The organization is one row shared by every test in the run, so a spec that
 * renames it or gives it a mark has to put it back, or the next spec asserts
 * against somebody else's leftovers.
 */
export async function resetOrganization(): Promise<void> {
  const { id } = await organizationRow()
  await fetch(`${STACK}/rest/v1/workspaces?id=eq.${id}`, {
    method: 'PATCH',
    headers: admin,
    body: JSON.stringify({
      name: 'Hokejová škola Příbram',
      short_name: null,
      logo_path: null,
      logo_background: 'white',
      logo_updated_at: null,
    }),
  })
}

/** The public URL of a stored mark, for a test that wants the bytes. */
export function storedLogoUrl(path: string): string {
  return `${STACK}/storage/v1/object/public/workspace-logos/${path}`
}

/**
 * No serious or critical accessibility violation on the screen as rendered
 * (AC-292).
 *
 * Called from the flow that already built the screen rather than from an
 * accessibility suite of its own: every one of these screens costs a sign-in,
 * a family and a training to reach, and a second suite would build all of it
 * again to assert one more thing about the same page.
 *
 * `serious` and `critical` only. Axe's `minor` and `moderate` findings are
 * largely advisory — a landmark it would have preferred, a heading order it
 * reads as skipped — and a suite that fails on advice gets switched off. What
 * is left is the set a person using a screen reader or a keyboard cannot work
 * around: an unlabelled control, a name that is not announced, text under the
 * contrast minimum.
 */
export async function expectAccessible(page: Page, where: string): Promise<void> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()

  // Reported with the element that failed: "colour-contrast on 3 nodes" sends
  // the next person back to the browser to find out which three.
  const blocking = violations
    .filter((one) => one.impact === 'serious' || one.impact === 'critical')
    .map(
      (one) =>
        `${one.id} (${one.impact}): ${one.nodes.map((node) => node.target.join(' ')).join(', ')}`,
    )

  expect(blocking, `${where} has accessibility violations`).toEqual([])
}
