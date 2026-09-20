import type { Page } from '@playwright/test'

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
  await page.goto('/prihlaseni')
  await page.getByLabel('E-mail').fill(email)
  await page.getByRole('button', { name: 'Poslat kód' }).click()

  await page.getByLabel('Kód').waitFor()
  await page.getByLabel('Kód').fill(await readCode(email))
  await page.getByRole('button', { name: 'Přihlásit se' }).click()

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
export async function tokenFor(email: string): Promise<string> {
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
  const profileId = await profileFor(email)

  const workspaces = (await (
    await fetch(`${STACK}/rest/v1/workspaces?select=id&limit=1`, { headers: admin })
  ).json()) as { id: string }[]

  const workspaceId = workspaces[0]?.id
  if (!workspaceId) throw new Error('No workspace in the database')

  const response = await fetch(`${STACK}/rest/v1/workspace_members`, {
    method: 'POST',
    headers: admin,
    body: JSON.stringify({ workspace_id: workspaceId, profile_id: profileId, role: 'COACH' }),
  })
  if (!response.ok) throw new Error(`Could not grant coach: ${response.status}`)

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
