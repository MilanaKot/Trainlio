/**
 * Trainlio — integration test against a running Supabase stack.
 *
 *   pnpm supabase start
 *   pnpm db:integration
 *
 * Covers what the SQL suites cannot: real GoTrue OTP delivery, real Storage
 * policies, and RLS as PostgREST actually applies it over HTTP. The SQL suites
 * reach the same rules through `set role authenticated`, which is what
 * PostgREST does internally — this proves the whole path end to end.
 *
 * Requires the local stack's fixed development keys; it never runs against a
 * real project.
 */
const API = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'
const MAIL = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324'
const ANON = process.env.ANON

if (!ANON) {
  console.error('ANON is required (the local anon key from `supabase status`)')
  process.exit(1)
}

let failures = 0
const ok = (label, cond, extra = '') => {
  if (!cond) failures++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? ' — ' + extra : ''}`)
}

/** Signs a new person in through the real OTP flow, reading the code from Mailpit. */
async function signIn(email) {
  const r = await fetch(`${API}/auth/v1/otp`, {
    method: 'POST',
    headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ email, create_user: true }),
  })
  if (!r.ok) throw new Error(`OTP request failed: ${r.status}`)

  await new Promise((s) => setTimeout(s, 1500))
  const box = await (await fetch(`${MAIL}/api/v1/messages`)).json()
  const msg = box.messages?.find((m) => m.To?.some((t) => t.Address === email))
  if (!msg) throw new Error(`no email delivered to ${email}`)

  const body = await (await fetch(`${MAIL}/api/v1/message/${msg.ID}`)).json()
  const code = (body.Text || body.HTML || '').match(/\b(\d{6})\b/)?.[1]
  if (!code) throw new Error('no 6-digit code in the email')

  const verified = await (
    await fetch(`${API}/auth/v1/verify`, {
      method: 'POST',
      headers: { apikey: ANON, 'content-type': 'application/json' },
      body: JSON.stringify({ email, token: code, type: 'email' }),
    })
  ).json()

  return { msg, code, token: verified.access_token }
}

const bearer = (token) => ({
  apikey: ANON,
  authorization: `Bearer ${token}`,
  'content-type': 'application/json',
})

// A 1x1 transparent PNG.
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082',
  'hex',
)

console.log('── Email one-time-code sign-in ─────────────────────────────────────')
const EMAIL = `parent.${Date.now()}@example.test`
const first = await signIn(EMAIL)
ok('an OTP email is delivered', Boolean(first.msg))
ok('its subject is the Czech template', first.msg.Subject === 'Přihlášení do Trainlio', first.msg.Subject)
ok('it carries a six-digit code, not a magic link', Boolean(first.code))
ok('verifying the code issues a session', Boolean(first.token))

const auth = bearer(first.token)

console.log('')
console.log('── Signup creates the actor record ─────────────────────────────────')
const profiles = await (
  await fetch(`${API}/rest/v1/app_profiles?select=id,display_name,auth_user_id`, { headers: auth })
).json()
ok('exactly one profile exists for the new identity', profiles.length === 1)
ok('display_name starts null, so signup writes no personal data', profiles[0]?.display_name === null)

console.log('')
console.log('── A first-time parent can still find a workspace ──────────────────')
const visible = await (await fetch(`${API}/rest/v1/workspaces?select=id`, { headers: auth })).json()
ok('no workspace row is readable yet (D-01)', visible.length === 0)
const workspaces = await (
  await fetch(`${API}/rest/v1/rpc/joinable_workspaces`, { method: 'POST', headers: auth, body: '{}' })
).json()
ok('joinable_workspaces() offers one to register into', workspaces.length === 1, workspaces[0]?.name)

console.log('')
console.log('── Transactional athlete creation ──────────────────────────────────')
const created = await (
  await fetch(`${API}/rest/v1/rpc/create_athlete_with_guardian`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      p_first_name: 'Ivan',
      p_last_name: 'Kotov',
      p_date_of_birth: '2017-10-23',
      p_workspace_id: workspaces[0].id,
      p_sport_code: 'HOCKEY',
      p_attributes: { position: 'CENTER', stick_side: 'LEFT' },
    }),
  })
).json()
ok('the athlete is created', created.ok === true, created.code ?? '')
const athleteId = created.data?.athlete_id

console.log('')
console.log('── Private photo storage ───────────────────────────────────────────')
const path = `athletes/${athleteId}/${crypto.randomUUID()}.png`
let r = await fetch(`${API}/storage/v1/object/athlete-photos/${path}`, {
  method: 'POST',
  headers: { apikey: ANON, authorization: `Bearer ${first.token}`, 'content-type': 'image/png' },
  body: PNG,
})
ok('a guardian can upload under their own athlete path', r.ok, `${r.status}`)

// The storage policy reads the athlete id out of the second path segment, so a
// path pointing elsewhere must be refused however it is constructed.
r = await fetch(`${API}/storage/v1/object/athlete-photos/athletes/${crypto.randomUUID()}/x.png`, {
  method: 'POST',
  headers: { apikey: ANON, authorization: `Bearer ${first.token}`, 'content-type': 'image/png' },
  body: PNG,
})
ok('and cannot upload under another athlete id', !r.ok, `${r.status}`)

r = await fetch(`${API}/storage/v1/object/public/athlete-photos/${path}`)
ok('the object is not publicly readable (AC-092)', !r.ok, `${r.status}`)

const signed = await (
  await fetch(`${API}/storage/v1/object/sign/athlete-photos/${path}`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ expiresIn: 3600 }),
  })
).json()
ok('a signed URL is issued server-side', Boolean(signed.signedURL))
r = await fetch(`${API}/storage/v1${signed.signedURL}`)
ok('and it fetches the image', r.ok, `${r.status}`)

console.log('')
console.log('── One family cannot reach another ─────────────────────────────────')
const second = await signIn(`other.${Date.now()}@example.test`)
const auth2 = bearer(second.token)

const otherView = await (
  await fetch(`${API}/rest/v1/athletes?select=first_name`, { headers: auth2 })
).json()
ok('a second family sees none of the first family athletes (AC-091)', otherView.length === 0)

r = await fetch(`${API}/storage/v1/object/sign/athlete-photos/${path}`, {
  method: 'POST',
  headers: auth2,
  body: JSON.stringify({ expiresIn: 60 }),
})
ok('nor can it sign their photo (AC-092)', !r.ok, `${r.status}`)

console.log('')
console.log('── Mutations that are RPC-only ─────────────────────────────────────')
r = await fetch(`${API}/rest/v1/bookings`, {
  method: 'POST',
  headers: auth,
  body: JSON.stringify({
    training_session_id: crypto.randomUUID(),
    athlete_id: athleteId,
    created_by: profiles[0].id,
    created_by_role: 'USER',
  }),
})
ok('a guardian cannot insert a booking directly (AC-026)', !r.ok, `${r.status}`)

r = await fetch(`${API}/rest/v1/audit_log?select=id`, { headers: auth })
ok('nor read the audit log', !r.ok, `${r.status}`)

r = await fetch(`${API}/rest/v1/notification_deliveries?select=id`, { headers: auth })
ok('nor read guardian email addresses', !r.ok, `${r.status}`)

r = await fetch(`${API}/rest/v1/athletes?select=first_name`, { headers: { apikey: ANON } })
ok('and anon reaches nothing at all', !r.ok, `${r.status}`)

console.log('')
console.log(failures === 0 ? 'integration: all checks passed' : `integration: ${failures} failed`)
process.exit(failures === 0 ? 0 : 1)
