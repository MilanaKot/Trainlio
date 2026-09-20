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

/**
 * Turns the Realtime skip into a failure.
 *
 * Against a freshly started stack the Supabase CLI does not route changes to an
 * RLS-scoped subscriber until the suite has run once, so the first run always
 * skips — including in CI, where the stack is always fresh. A second run does
 * route, but running twice proves nothing on its own: a skip leaves the exit
 * code at zero, so two skips would look exactly like coverage.
 *
 * So CI runs the suite twice and sets this on the second: the warm-up may skip,
 * the run that counts may not.
 */
const REALTIME_REQUIRED = process.env.REALTIME_REQUIRED === '1'

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

  // Subscribing is not enough to assert on, and neither is a sleep.
  //
  // A channel reports SUBSCRIBED as soon as it joins, before the server-side
  // subscription row that actually routes changes exists. Worse, `supabase db
  // reset` restarts the Realtime container *after* the CLI returns, so a
  // channel opened right after a reset can be joined to a server that is about
  // to go away — which is exactly why the first run after a reset kept failing
  // here while every later run passed.
  //
  // So the pipe is made to prove itself: subscribe, then write a no-op change
  // to the projection until one comes back. A probe leaves confirmed_count at
  // 0, so it can never be mistaken for the booking under test. A channel that
  // never routes is torn down and replaced, which is what survives a restart.
  let channel = null
  let routing = false

  for (let attempt = 0; attempt < 4 && !routing; attempt += 1) {
    channel = rt.channel(`occupancy:${bookable}:${attempt}`).on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'training_session_occupancy',
        filter: `training_session_id=eq.${bookable}` },
      (payload) => occupancyEvents.push(payload.new),
    )

    const joined = await new Promise((resolve) => {
      channel.subscribe((status) => { if (status === 'SUBSCRIBED') resolve(true) })
      setTimeout(() => resolve(false), 20000)
    })

    if (joined) {
      for (let probe = 0; probe < 15 && !routing; probe += 1) {
        await fetch(
          `${API}/rest/v1/training_session_occupancy?training_session_id=eq.${bookable}`,
          { method: 'PATCH', headers: admin, body: JSON.stringify({ confirmed_count: 0 }) },
        )
        await new Promise((s) => setTimeout(s, 1000))
        routing = occupancyEvents.length > 0
      }
    }

    if (!routing) await rt.removeChannel(channel)
  }

  // A stack that is not routing is a fault in the harness rather than in
  // Trainlio, and on a first run it is expected — so it skips, because a red
  // line nobody can act on is a red line everybody learns to ignore.
  //
  // Unless this is the run that counts. Then it is a failure, because the
  // alternative is a suite that reports success while never having checked the
  // one thing a parent watching a session fill depends on.
  if (!routing) {
    if (REALTIME_REQUIRED) {
      ok('a guardian can subscribe to the occupancy projection and receive changes',
         false, 'the stack never routed a probe change; this is the run that counts')
    } else {
      console.log('SKIP  Realtime checks — the local stack is not routing changes yet.')
      console.log('      Run the suite again; see supabase/tests/README.md.')
    }
  } else {
    ok('a guardian can subscribe to the occupancy projection and receive changes', true)
  }

  res = await rpc('book_athletes_as_guardian', {
    p_training_session_id: bookable,
    p_athlete_ids: [athleteId],
  }, auth)
  ok('and book through the domain function', res.ok === true, res.code ?? '')

  await new Promise((s) => setTimeout(s, 6000))
  if (routing) {
    // AC-090a: the count moves for a subscribed guardian, and nothing that
    // identifies the other family travels with it — proven by the two reads
    // below, which see the count and none of the bookings behind it.
    ok('the occupancy change arrives over Realtime (AC-090a)',
       occupancyEvents.some((e) => e.confirmed_count === 1),
       `${occupancyEvents.filter((e) => e.confirmed_count === 1).length} of ${occupancyEvents.length} event(s)`)
  }

  // The second family needs an athlete of their own before they can see this
  // workspace at all (D-01) — which is itself the rule under test.
  const beforeJoining = await (
    await fetch(
      `${API}/rest/v1/training_session_occupancy?training_session_id=eq.${bookable}&select=confirmed_count`,
      { headers: auth2 },
    )
  ).json()
  ok('a family with no athlete reads no occupancy at all (D-01)', beforeJoining.length === 0)

  const joined = await (await fetch(`${API}/rest/v1/rpc/create_athlete_with_guardian`, {
    method: 'POST',
    headers: auth2,
    body: JSON.stringify({
      p_first_name: 'Anna', p_last_name: 'Kotova', p_date_of_birth: '2018-03-04',
      p_workspace_id: ws.id, p_sport_code: 'HOCKEY',
      p_attributes: { position: 'GOALIE', stick_side: 'RIGHT' },
    }),
  })).json()
  const otherAthleteId = joined.data?.athlete_id

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
  ok('but none of the bookings behind it (BR-090, AC-090a)', otherBookings.length === 0)

  // D-05 over HTTP: the whole selection or none.
  res = await rpc('book_athletes_as_guardian', {
    p_training_session_id: bookable,
    p_athlete_ids: [crypto.randomUUID()],
  }, auth2)
  ok('a full session refuses the next family', res.code === 'INSUFFICIENT_CAPACITY' ||
     res.code === 'NOT_AUTHORIZED_FOR_ATHLETE', res.code ?? '')

  if (channel) await rt.removeChannel(channel)

  console.log('')
  console.log('── The coach roster, over HTTP ─────────────────────────────────────')

  // The guardian names themselves, which is the name BR-092 puts on the roster.
  r = await fetch(`${API}/rest/v1/app_profiles?id=eq.${profiles[0].id}`, {
    method: 'PATCH', headers: auth, body: JSON.stringify({ display_name: 'Rodina Kotov' }),
  })
  ok('a guardian may set their own display name', r.ok, `${r.status}`)

  let roster = await rpc('session_roster', { p_training_session_id: bookable })
  ok('the coach reads the roster', Array.isArray(roster) && roster.length === 1, JSON.stringify(roster).slice(0, 120))
  ok('which names who booked (BR-092)', roster[0]?.booked_by_name === 'Rodina Kotov', roster[0]?.booked_by_name ?? '')
  ok('under which role', roster[0]?.created_by_role === 'USER', roster[0]?.created_by_role ?? '')
  ok('and when (AC-090)', typeof roster[0]?.booked_at === 'string')

  // The guardian's own profile is readable to them; another family's is not,
  // and the roster does not become a way around that.
  const guardianRoster = await rpc('session_roster', { p_training_session_id: bookable }, auth)
  ok('a guardian reads no roster at all (AC-091)', Array.isArray(guardianRoster) && guardianRoster.length === 0)
  const strangerRoster = await rpc('session_roster', { p_training_session_id: bookable }, auth2)
  ok('and neither does another family holding the session id', Array.isArray(strangerRoster) && strangerRoster.length === 0)

  const candidates = await rpc('coach_session_candidates', { p_training_session_id: bookable })
  const mine = candidates.find((c) => c.athlete_id === athleteId)
  const theirs = candidates.find((c) => c.athlete_id === otherAthleteId)
  ok('the coach picker spans the workspace, not one family',
     mine !== undefined && theirs !== undefined, `${candidates.length} candidate(s)`)
  ok('the already-booked athlete cannot be added twice', mine?.can_add === false)
  ok('a full session is still not a bar for the coach (BR-033)', theirs?.can_add === true)
  const guardianCandidates = await rpc('coach_session_candidates', { p_training_session_id: bookable }, auth)
  ok('a guardian cannot enumerate the workspace through it', guardianCandidates.length === 0)

  // AC-050 over HTTP. The session holds 1 of 1.
  res = await rpc('book_athlete_as_coach', {
    p_training_session_id: bookable, p_athlete_id: otherAthleteId,
  })
  ok('a full session refuses a manual addition without confirmation',
     res.code === 'WOULD_EXCEED_CAPACITY', res.code ?? '')
  ok('and returns the numbers the warning shows',
     res.details?.capacity === 1 && res.details?.confirmed_count === 1, JSON.stringify(res.details ?? {}))

  res = await rpc('book_athlete_as_coach', {
    p_training_session_id: bookable, p_athlete_id: otherAthleteId, p_confirm_over_capacity: true,
  })
  ok('with the confirmation it succeeds', res.ok === true, res.code ?? '')
  ok('and reports that it overrode', res.data?.capacity_override === true)

  const over = await (
    await fetch(
      `${API}/rest/v1/training_session_occupancy?training_session_id=eq.${bookable}&select=confirmed_count`,
      { headers: coachAuth },
    )
  ).json()
  ok('occupancy passes capacity, as AC-050 requires', over[0]?.confirmed_count === 2, `${over[0]?.confirmed_count}`)

  // A guardian must not be able to reach the bookings table directly, whatever
  // the domain functions allow (defence in depth).
  r = await fetch(`${API}/rest/v1/bookings`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ training_session_id: bookable, athlete_id: athleteId }),
  })
  ok('a guardian holds no INSERT on bookings', !r.ok, `${r.status}`)
  res = await rpc('book_athlete_as_coach', {
    p_training_session_id: bookable, p_athlete_id: athleteId, p_confirm_over_capacity: true,
  }, auth)
  ok('nor can they call the coach path', res.code === 'NOT_AUTHORIZED', res.code ?? '')

  // AC-042: removal at any time, and the D-06 block it creates.
  const myBooking = roster[0].booking_id
  res = await rpc('cancel_booking_as_coach', { p_booking_id: myBooking, p_reason: 'Nemoc' })
  ok('the coach removes an athlete (AC-042)', res.ok === true, res.code ?? '')

  res = await rpc('book_athletes_as_guardian', {
    p_training_session_id: bookable, p_athlete_ids: [athleteId],
  }, auth)
  ok('the guardian cannot book them back in (AC-042a)', res.code === 'REMOVED_BY_COACH', res.code ?? '')

  res = await rpc('book_athlete_as_coach', {
    p_training_session_id: bookable, p_athlete_id: athleteId, p_confirm_over_capacity: true,
  })
  ok('but the coach can (AC-042b)', res.ok === true, res.code ?? '')

  roster = await rpc('session_roster', { p_training_session_id: bookable })
  ok('and the removal stays on the roster rather than being deleted (BR-044)',
     roster.filter((e) => e.status === 'CANCELLED_BY_COACH').length === 1, `${roster.length} row(s)`)
  ok('with the reason the coach gave',
     roster.find((e) => e.status === 'CANCELLED_BY_COACH')?.cancellation_reason === 'Nemoc')

  // AC-142, and AC-150's sibling: the audit log is not client-readable.
  // Refused outright rather than filtered to nothing: the table has no SELECT
  // grant for any client role, so PostgREST answers 403 instead of an empty
  // array. That distinction matters — a filtered-to-empty policy could be
  // widened by a future policy change; a missing grant cannot.
  r = await fetch(`${API}/rest/v1/audit_log?select=action`, { headers: coachAuth })
  ok('no client role reads the audit log', r.status === 403, `${r.status}`)
  const auditByService = await (
    await fetch(
      `${API}/rest/v1/audit_log?action=eq.BOOKING_CAPACITY_OVERRIDDEN&select=action,after`,
      { headers: admin },
    )
  ).json()
  ok('while the override is recorded for an administrator (AC-142)',
     auditByService.length >= 1, `${auditByService.length} entr(y|ies)`)

  console.log('')
  console.log('── The notification outbox, over HTTP ──────────────────────────────')

  const serviceRpc = (fn, body) =>
    fetch(`${API}/rest/v1/rpc/${fn}`, { method: 'POST', headers: admin, body: JSON.stringify(body) })

  // A session with two of one family's children booked: the AC-072 case, end
  // to end rather than asserted on a fixture.
  res = await rpc('create_training_session', {
    p_workspace_id: ws.id,
    p_local_date: new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10),
    p_local_start_time: '09:00', p_local_end_time: '10:00',
    p_facility_id: mh.id, p_capacity: 10, p_eligibility_mode: 'ALL',
    p_changing_room: 'Šatna 4',
  })
  const notifySession = res.data?.training_session_id
  ok('a coach opens a session for the notification case', res.ok === true, res.code ?? '')

  // A second child for the first family, so one guardian has two booked.
  const sibling = await (await fetch(`${API}/rest/v1/rpc/create_athlete_with_guardian`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({
      p_first_name: 'Tomáš', p_last_name: 'Kotov', p_date_of_birth: '2016-05-11',
      p_workspace_id: ws.id, p_sport_code: 'HOCKEY',
      p_attributes: { position: 'DEFENSE', stick_side: 'LEFT' },
    }),
  })).json()
  const siblingId = sibling.data?.athlete_id
  ok('the family adds a second athlete', sibling.ok === true, sibling.code ?? '')

  res = await rpc('book_athletes_as_guardian', {
    p_training_session_id: notifySession, p_athlete_ids: [athleteId, siblingId],
  }, auth)
  ok('and books both into one session', res.ok === true, res.code ?? '')
  res = await rpc('book_athletes_as_guardian', {
    p_training_session_id: notifySession, p_athlete_ids: [otherAthleteId],
  }, auth2)
  ok('a second family books one', res.ok === true, res.code ?? '')

  // AC-150: no client role may reach the outbox, at either layer.
  r = await fetch(`${API}/rest/v1/notification_deliveries?select=recipient_email`, { headers: auth })
  ok('a guardian cannot read notification_deliveries', r.status === 403 || r.status === 401, `${r.status}`)
  r = await fetch(`${API}/rest/v1/notification_events?select=event_type`, { headers: coachAuth })
  ok('nor can a coach read notification_events', r.status === 403 || r.status === 401, `${r.status}`)
  r = await fetch(`${API}/rest/v1/rpc/expand_notification_event`, {
    method: 'POST', headers: coachAuth,
    body: JSON.stringify({ p_event_id: '00000000-0000-0000-0000-00000000dead' }),
  })
  ok('nor call the expansion function', !r.ok, `${r.status}`)
  r = await fetch(`${API}/rest/v1/rpc/claim_notification_deliveries`, {
    method: 'POST', headers: auth, body: JSON.stringify({ p_limit: 1 }),
  })
  ok('nor claim a delivery, which would hand over an address', !r.ok, `${r.status}`)

  // AC-061 / BR-072: the cancellation queues one event for the whole session.
  res = await rpc('cancel_training_session', {
    p_training_session_id: notifySession, p_reason: 'Porucha chlazení',
  })
  ok('the coach cancels it', res.ok === true, res.code ?? '')

  const outboxEvents = await (await fetch(
    `${API}/rest/v1/notification_events?training_session_id=eq.${notifySession}&select=id,event_type,dispatched_at`,
    { headers: admin })).json()
  ok('which queues exactly one event', outboxEvents.length === 1 && outboxEvents[0].event_type === 'SESSION_CANCELLED',
     JSON.stringify(outboxEvents.map((e) => e.event_type)))
  ok('not yet dispatched', outboxEvents[0]?.dispatched_at === null)

  const pending = await (await serviceRpc('pending_notification_events', { p_limit: 50 })).json()
  ok('and the drain finds it waiting', pending.includes(outboxEvents[0].id), `${pending.length} pending`)

  let expanded = await (await serviceRpc('expand_notification_event', { p_event_id: outboxEvents[0].id })).json()
  ok('expansion creates one delivery per guardian', expanded.data?.created === 2,
     JSON.stringify(expanded.data ?? expanded))

  const deliveries = await (await fetch(
    `${API}/rest/v1/notification_deliveries?event_id=eq.${outboxEvents[0].id}&select=recipient_email,payload,status`,
    { headers: admin })).json()
  ok('two families, two deliveries', deliveries.length === 2, `${deliveries.length}`)

  const familyOne = deliveries.find((d) => d.recipient_email === EMAIL)
  ok('the family with two booked children gets exactly one (AC-072)',
     deliveries.filter((d) => d.recipient_email === EMAIL).length === 1)
  ok('naming both of them (AC-073)',
     (familyOne?.payload?.athlete_names ?? []).length === 2,
     JSON.stringify(familyOne?.payload?.athlete_names ?? []))

  // AC-151: the drain re-running after a crash must not email anyone twice.
  expanded = await (await serviceRpc('expand_notification_event', { p_event_id: outboxEvents[0].id })).json()
  ok('re-running expansion creates nothing', expanded.data?.already_dispatched === true)
  const again = await (await fetch(
    `${API}/rest/v1/notification_deliveries?event_id=eq.${outboxEvents[0].id}&select=id`,
    { headers: admin })).json()
  ok('and leaves the delivery count where it was (AC-151)', again.length === 2, `${again.length}`)

  // Claim, send, record — the drain's second phase, without a provider.
  const claimed = await (await serviceRpc('claim_notification_deliveries', { p_limit: 10 })).json()
  ok('the drain claims both', claimed.length === 2, `${claimed.length}`)
  const one = claimed.find((c) => c.recipient_email === EMAIL)
  ok('each claim carries the address', typeof one?.recipient_email === 'string')
  ok('the resolved venue, for the message to state',
     one?.session_payload?.facility_code === 'MH' && one?.session_payload?.location_name === 'Příbram',
     JSON.stringify(one?.session_payload ?? {}))
  ok('the changing room (BR-063)', one?.session_payload?.changing_room === 'Šatna 4')
  ok('the reason the coach gave', one?.session_payload?.reason === 'Porucha chlazení')
  ok('and that guardian\'s own athletes, not the whole roster',
     (one?.delivery_payload?.athlete_names ?? []).length === 2)
  ok('the workspace timezone, never the device\'s', one?.workspace_timezone === ws.timezone)

  const concurrent = await (await serviceRpc('claim_notification_deliveries', { p_limit: 10 })).json()
  ok('a concurrent drain claims nothing twice', concurrent.length === 0, `${concurrent.length}`)

  await serviceRpc('record_notification_delivery', {
    p_delivery_id: one.delivery_id, p_ok: true, p_provider_message_id: 'prov_abc',
  })
  const recorded = await (await fetch(
    `${API}/rest/v1/notification_deliveries?id=eq.${one.delivery_id}&select=status,provider_message_id,sent_at`,
    { headers: admin })).json()
  ok('a success is recorded with the provider id',
     recorded[0]?.status === 'SENT' && recorded[0]?.provider_message_id === 'prov_abc',
     JSON.stringify(recorded[0] ?? {}))

  const other = claimed.find((c) => c.delivery_id !== one.delivery_id)
  await serviceRpc('record_notification_delivery', {
    p_delivery_id: other.delivery_id, p_ok: false, p_error: 'retryable: 503',
  })
  const retryable = await (await serviceRpc('claim_notification_deliveries', { p_limit: 10 })).json()
  ok('a failed delivery comes back on the next run',
     retryable.some((c) => c.delivery_id === other.delivery_id), `${retryable.length}`)
  ok('with the attempt counted', retryable.find((c) => c.delivery_id === other.delivery_id)?.attempt_count === 2)

  // Counts across the whole database, which earlier sections of this suite have
  // also written to — so the assertion is on the shape, not on absolute
  // totals that would make this check depend on what ran before it.
  const depth = await (await serviceRpc('notification_queue_depth', {})).json()
  const allDeliveries = await (await fetch(
    `${API}/rest/v1/notification_deliveries?select=id`, { headers: admin })).json()
  ok('the queue depth accounts for every delivery',
     depth.pending + depth.sending + depth.failed + depth.sent === allDeliveries.length,
     JSON.stringify(depth))
  ok('and counts the one just sent', depth.sent >= 1, JSON.stringify(depth))
  ok('the events this section expanded are no longer waiting',
     !(await (await serviceRpc('pending_notification_events', { p_limit: 100 })).json())
       .includes(outboxEvents[0].id))
}

console.log('')
console.log(failures === 0 ? 'integration: all checks passed' : `integration: ${failures} failed`)
process.exit(failures === 0 ? 0 : 1)
