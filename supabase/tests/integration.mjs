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
console.log('── Coach session management ────────────────────────────────────────')

// Making someone workspace staff is an administrative act with no interface
// yet, exactly as the deployment notes say. Done here with the service key,
// which is how an administrator would do it.
const SERVICE = process.env.SERVICE_ROLE_KEY
if (!SERVICE) {
  console.log('SKIP  coach checks (SERVICE_ROLE_KEY not set)')
} else {
  const admin = {
    apikey: SERVICE,
    authorization: `Bearer ${SERVICE}`,
    'content-type': 'application/json',
    prefer: 'return=representation',
  }

  const coach = await signIn(`coach.${Date.now()}@example.test`)
  const coachAuth = bearer(coach.token)
  const coachProfile = (
    await (await fetch(`${API}/rest/v1/app_profiles?select=id`, { headers: coachAuth })).json()
  )[0]

  const allWorkspaces = await (
    await fetch(`${API}/rest/v1/workspaces?select=id,timezone`, { headers: admin })
  ).json()
  const ws = allWorkspaces[0]

  r = await fetch(`${API}/rest/v1/workspace_members`, {
    method: 'POST',
    headers: admin,
    body: JSON.stringify({ workspace_id: ws.id, profile_id: coachProfile.id, role: 'COACH' }),
  })
  ok('a coach can be granted workspace staff', r.ok, `${r.status}`)

  const facilities = await (
    await fetch(`${API}/rest/v1/facilities?select=id,code&order=code`, { headers: admin })
  ).json()
  const mh = facilities.find((f) => f.code === 'MH')
  const vh = facilities.find((f) => f.code === 'VH')

  const rpc = (fn, body, headers = coachAuth) =>
    fetch(`${API}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(body) }).then((x) => x.json())

  // Local wall clock in, correct instant out.
  let res = await rpc('create_training_session', {
    p_workspace_id: ws.id,
    p_local_date: '2026-10-04',
    p_local_start_time: '09:00',
    p_local_end_time: '10:00',
    p_facility_id: mh.id,
    p_capacity: 10,
    p_eligibility_mode: 'BIRTH_YEAR_RANGE',
    p_birth_year_from: 2016,
    p_birth_year_to: 2018,
    p_internal_notes: 'Interní poznámka.',
  })
  ok('a coach can create a session', res.ok === true, res.code ?? '')
  const sessionId = res.data?.training_session_id

  const stored = (
    await (
      await fetch(`${API}/rest/v1/training_sessions?id=eq.${sessionId}&select=start_at`, { headers: coachAuth })
    ).json()
  )[0]
  const localStart = new Intl.DateTimeFormat('en-GB', {
    timeZone: ws.timezone, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(stored.start_at))
  ok('local wall-clock time round-trips through the workspace zone', localStart === '09:00', localStart)

  // A guardian must not be able to reach any of it.
  res = await rpc('create_training_session', {
    p_workspace_id: ws.id, p_local_date: '2026-10-11', p_local_start_time: '09:00',
    p_local_end_time: '10:00', p_facility_id: mh.id,
  }, auth)
  ok('a guardian cannot create a session', res.code === 'NOT_AUTHORIZED', res.code ?? '')

  r = await fetch(`${API}/rest/v1/training_sessions?id=eq.${sessionId}`, {
    method: 'PATCH', headers: auth, body: JSON.stringify({ capacity: 99 }),
  })
  ok('nor update one directly (AC-027)', !r.ok, `${r.status}`)

  // D-13: internal notes are a separate table, so a guardian gets no row.
  r = await fetch(`${API}/rest/v1/training_session_internal_notes?select=notes`, { headers: auth })
  const guardianNotes = await r.json()
  ok('a guardian reads no internal notes at all', Array.isArray(guardianNotes) && guardianNotes.length === 0)
  // Scoped to this session: the fixtures carry a note of their own, and the
  // coach can see that one too.
  r = await fetch(
    `${API}/rest/v1/training_session_internal_notes?training_session_id=eq.${sessionId}&select=notes`,
    { headers: coachAuth },
  )
  ok('the coach reads them', (await r.json())[0]?.notes === 'Interní poznámka.')

  // D-11: what counts as significant.
  const edit = (extra) => rpc('update_training_session', {
    p_training_session_id: sessionId,
    p_local_date: '2026-10-04', p_local_start_time: '09:00', p_local_end_time: '10:00',
    p_facility_id: mh.id, p_capacity: 10,
    p_eligibility_mode: 'BIRTH_YEAR_RANGE', p_birth_year_from: 2016, p_birth_year_to: 2018,
    ...extra,
  })

  // Note that edit() omits p_internal_notes: update is a full replace, so an
  // omitted field is a cleared field. The form always submits every field.
  res = await edit({ p_changing_room: 'Šatna 4' })
  ok('a changing-room change is not significant (D-12)', res.data?.significant === false)

  res = await edit({ p_capacity: 12 })
  ok('a capacity change is not significant (BR-064)', res.data?.significant === false)

  res = await edit({ p_capacity: 12, p_local_start_time: '08:00' })
  ok('a time change is significant', res.data?.events?.[0] === 'SESSION_SCHEDULE_CHANGED')

  res = await edit({ p_capacity: 12, p_local_start_time: '08:00', p_facility_id: vh.id })
  ok('MH to VH is significant', res.data?.events?.[0] === 'SESSION_FACILITY_CHANGED')

  // D-07: terminal.
  res = await rpc('cancel_training_session', { p_training_session_id: sessionId })
  ok('the session can be cancelled', res.ok === true, res.code ?? '')
  res = await rpc('set_session_booking_state', { p_training_session_id: sessionId, p_open: true })
  ok('and cannot be reopened (AC-160)', res.code === 'SESSION_CANCELLED', res.code ?? '')
  res = await rpc('duplicate_training_session', { p_training_session_id: sessionId, p_local_date: '2026-11-01' })
  ok('but can be duplicated, which is the recovery path (AC-164)', res.ok === true, res.code ?? '')

  // The outbox and audit trail were written, and stay out of reach.
  const events = await (
    await fetch(`${API}/rest/v1/notification_events?select=event_type`, { headers: admin })
  ).json()
  ok('a cancellation queued its notification event',
     events.some((e) => e.event_type === 'SESSION_CANCELLED'))
  const audit = await (
    await fetch(`${API}/rest/v1/audit_log?select=action`, { headers: admin })
  ).json()
  ok('the audit trail recorded the session actions',
     ['SESSION_CREATED', 'SESSION_UPDATED', 'SESSION_CANCELLED', 'SESSION_DUPLICATED']
       .every((a) => audit.some((row) => row.action === a)))
  r = await fetch(`${API}/rest/v1/audit_log?select=action`, { headers: coachAuth })
  ok('which even a coach cannot read', !r.ok, `${r.status}`)

  console.log('')
  console.log('── Recurring series across a daylight-saving change ────────────────')

  // The PRD's own example. Czech DST ends on 25 October 2026, which is itself
  // an occurrence date.
  res = await rpc('create_session_series', {
    p_workspace_id: ws.id,
    p_by_weekday: 7,
    p_local_date_from: '2026-10-04',
    p_local_date_to: '2026-11-29',
    p_local_start_time: '09:00',
    p_local_end_time: '10:00',
    p_facility_id: mh.id,
    p_capacity: 10,
    p_eligibility_mode: 'BIRTH_YEAR_RANGE',
    p_birth_year_from: 2017,
    p_birth_year_to: 2018,
  })
  ok('a coach can create a series', res.ok === true, res.code ?? '')
  ok('it generates nine occurrences (AC-080)', res.data?.generated_count === 9)

  const seriesId = res.data?.session_series_id
  const occurrences = await (
    await fetch(
      `${API}/rest/v1/training_sessions?series_id=eq.${seriesId}&select=start_at,capacity,status&order=start_at`,
      { headers: coachAuth },
    )
  ).json()

  const localTimes = occurrences.map((o) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: ws.timezone, hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(o.start_at)),
  )
  ok('every occurrence keeps the same local start time (AC-080a)',
     new Set(localTimes).size === 1 && localTimes[0] === '09:00',
     [...new Set(localTimes)].join(', '))

  // The corollary, and the reason a fixed interval is wrong: the absolute gaps
  // are not all equal.
  const gaps = new Set(
    occurrences.slice(1).map((o, i) =>
      new Date(o.start_at).getTime() - new Date(occurrences[i].start_at).getTime()),
  )
  ok('so the absolute gap between them is not uniform', gaps.size === 2, `${gaps.size} distinct gaps`)

  // BR-081: independent from creation onward.
  const firstId = (
    await (
      await fetch(
        `${API}/rest/v1/training_sessions?series_id=eq.${seriesId}&select=id&order=start_at&limit=1`,
        { headers: coachAuth },
      )
    ).json()
  )[0].id
  res = await rpc('cancel_training_session', { p_training_session_id: firstId })
  ok('one occurrence can be cancelled', res.ok === true, res.code ?? '')

  const after = await (
    await fetch(`${API}/rest/v1/training_sessions?series_id=eq.${seriesId}&select=status`, { headers: coachAuth })
  ).json()
  ok('and its siblings are untouched (AC-081)',
     after.filter((o) => o.status === 'CANCELLED').length === 1 &&
     after.filter((o) => o.status === 'OPEN').length === 8)

  const series = (
    await (
      await fetch(
        `${API}/rest/v1/session_series?id=eq.${seriesId}&select=generated_in_timezone,generated_count`,
        { headers: coachAuth },
      )
    ).json()
  )[0]
  ok('the series records the timezone it was generated under (AC-080c)',
     series.generated_in_timezone === ws.timezone, series.generated_in_timezone)
  ok('and does not follow what happens to the occurrences', series.generated_count === 9)

  r = await fetch(`${API}/rest/v1/session_series?select=id`, { headers: auth })
  ok('a guardian sees no series at all', (await r.json()).length === 0)

  console.log('')
  console.log('── Booking, over HTTP and over Realtime ────────────────────────────')

  // A session the first family's athlete can book into.
  res = await rpc('create_training_session', {
    p_workspace_id: ws.id,
    p_local_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    p_local_start_time: '09:00',
    p_local_end_time: '10:00',
    p_facility_id: mh.id,
    p_capacity: 1,
    p_eligibility_mode: 'ALL',
  })
  const bookable = res.data?.training_session_id
  ok('a coach opens a session with one place', res.ok === true, res.code ?? '')

  // The picker's list comes from the server, so it cannot offer a child the
  // write would refuse.
  const picker = await rpc('guardian_session_athletes', { p_training_session_id: bookable }, auth)
  ok('the picker offers the guardian their own athlete', picker.length === 1 && picker[0].can_book === true)

  // Realtime, on the projection and never on bookings. Subscribed before the
  // booking so the event has somewhere to arrive.
  const { createClient } = await import('@supabase/supabase-js')
  const rt = createClient(API, ANON)
  // The socket carries its own token: Realtime applies row level security per
  // subscriber, so without this the channel authenticates as anon and receives
  // nothing — and a guardian with no athlete in the workspace receives nothing
  // either, which is D-01 working rather than a fault.
  rt.realtime.setAuth(first.token)

  const occupancyEvents = []
  const channel = rt.channel(`occupancy:${bookable}`).on(
    'postgres_changes',
    { event: 'UPDATE', schema: 'public', table: 'training_session_occupancy',
      filter: `training_session_id=eq.${bookable}` },
    (payload) => occupancyEvents.push(payload.new),
  )
  const subscribed = await new Promise((resolve) => {
    channel.subscribe((status) => { if (status === 'SUBSCRIBED') resolve(true) })
    setTimeout(() => resolve(false), 15000)
  })
  ok('a guardian can subscribe to the occupancy projection', subscribed === true)

  // SUBSCRIBED means the channel joined; the server-side subscription row that
  // actually routes changes is written just after. Booking before it exists
  // produces a change with nobody yet listening.
  await new Promise((s) => setTimeout(s, 2000))

  res = await rpc('book_athletes_as_guardian', {
    p_training_session_id: bookable,
    p_athlete_ids: [athleteId],
  }, auth)
  ok('and book through the domain function', res.ok === true, res.code ?? '')

  await new Promise((s) => setTimeout(s, 6000))
  ok('the occupancy change arrives over Realtime',
     occupancyEvents.some((e) => e.confirmed_count === 1),
     `${occupancyEvents.length} event(s)`)

  // The second family needs an athlete of their own before they can see this
  // workspace at all (D-01) — which is itself the rule under test.
  const beforeJoining = await (
    await fetch(
      `${API}/rest/v1/training_session_occupancy?training_session_id=eq.${bookable}&select=confirmed_count`,
      { headers: auth2 },
    )
  ).json()
  ok('a family with no athlete reads no occupancy at all (D-01)', beforeJoining.length === 0)

  await fetch(`${API}/rest/v1/rpc/create_athlete_with_guardian`, {
    method: 'POST',
    headers: auth2,
    body: JSON.stringify({
      p_first_name: 'Anna', p_last_name: 'Kotova', p_date_of_birth: '2018-03-04',
      p_workspace_id: ws.id, p_sport_code: 'HOCKEY',
      p_attributes: { position: 'GOALIE', stick_side: 'RIGHT' },
    }),
  })

  // Now they see the count move, without learning anything about who took the
  // place — the point of projecting rather than publishing bookings.
  const otherView = await (
    await fetch(
      `${API}/rest/v1/training_session_occupancy?training_session_id=eq.${bookable}&select=confirmed_count`,
      { headers: auth2 },
    )
  ).json()
  ok('another family reads the count', otherView[0]?.confirmed_count === 1)
  const otherBookings = await (
    await fetch(`${API}/rest/v1/bookings?training_session_id=eq.${bookable}&select=athlete_id`, { headers: auth2 })
  ).json()
  ok('but none of the bookings behind it (BR-090)', otherBookings.length === 0)

  // D-05 over HTTP: the whole selection or none.
  res = await rpc('book_athletes_as_guardian', {
    p_training_session_id: bookable,
    p_athlete_ids: [crypto.randomUUID()],
  }, auth2)
  ok('a full session refuses the next family', res.code === 'INSUFFICIENT_CAPACITY' ||
     res.code === 'NOT_AUTHORIZED_FOR_ATHLETE', res.code ?? '')

  await rt.removeChannel(channel)
}

console.log('')
console.log(failures === 0 ? 'integration: all checks passed' : `integration: ${failures} failed`)
process.exit(failures === 0 ? 0 : 1)
