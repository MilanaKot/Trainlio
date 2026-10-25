/**
 * Fill the local club with something to look at.
 *
 *   pnpm demo vas@email.cz
 *
 * The address is yours: sign in through the application once first, so the
 * profile exists, and this makes you the club's coach and administrator. Then
 * it adds families, children, a fortnight of trainings and the bookings on
 * them, so every screen has real rows in it instead of an empty state.
 *
 * `--empty` stops after the role. That is the other thing worth looking at:
 * the club on the day it is handed over, where every screen is an empty state
 * and the first training has to be created before anything else exists.
 *
 * Local stack only. It writes with the service-role key, which bypasses row
 * level security entirely, and it refuses to run against anything that is not
 * 127.0.0.1 — that key belongs in Vercel's environment and nowhere near a
 * script you run by hand.
 *
 * Not wired to `[db.seed]` on purpose: `supabase/tests/fixtures.sql` is what
 * the suites count rows in, and a demo club in there would break them.
 */
import { readFileSync } from 'node:fs'

const DEFAULT_URL = 'http://127.0.0.1:54321'
const DEFAULT_SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const email = process.argv[2]
const staffOnly = process.argv.includes('--empty')
if (!email || email.startsWith('--')) {
  console.error('usage: pnpm demo <your-email> [--empty]')
  console.error('  <your-email>  the address you signed in with')
  console.error('  --empty       make them staff and create nothing else')
  process.exit(1)
}

/** `.env.local` if it is there, so a stack on other ports still works. */
function fromEnvFile(key) {
  try {
    const line = readFileSync('.env.local', 'utf8')
      .split('\n')
      .find((one) => one.startsWith(`${key}=`))
    return line?.slice(key.length + 1).trim()
  } catch {
    return undefined
  }
}

const STACK = process.env.SUPABASE_URL ?? fromEnvFile('NEXT_PUBLIC_SUPABASE_URL') ?? DEFAULT_URL
const SERVICE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  fromEnvFile('SUPABASE_SERVICE_ROLE_KEY') ??
  DEFAULT_SERVICE

if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(STACK)) {
  console.error(`Refusing to write demo data to ${STACK}. This is for the local stack only.`)
  process.exit(1)
}

const headers = {
  apikey: SERVICE,
  authorization: `Bearer ${SERVICE}`,
  'content-type': 'application/json',
}

async function get(path) {
  const response = await fetch(`${STACK}/rest/v1/${path}`, { headers })
  if (!response.ok) throw new Error(`GET ${path}: ${response.status} ${await response.text()}`)
  return response.json()
}

async function insert(table, rows, { returning = 'representation' } = {}) {
  const response = await fetch(`${STACK}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...headers, prefer: `return=${returning}` },
    body: JSON.stringify(rows),
  })
  if (!response.ok) throw new Error(`POST ${table}: ${response.status} ${await response.text()}`)
  return returning === 'representation' ? response.json() : []
}

/**
 * The instant a wall clock in Prague points at.
 *
 * The workspace reasons in local time and stores instants; the device this
 * runs on is probably UTC. Formatting the naive instant in the club's timezone
 * gives the offset to subtract.
 */
function pragueInstant(localDate, localTime) {
  const naive = new Date(`${localDate}T${localTime}:00Z`)
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Prague',
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(naive)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  )
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  )
  return new Date(naive.getTime() - (asUtc - naive.getTime())).toISOString()
}

/** `YYYY-MM-DD`, n days from today. */
function day(offset) {
  const at = new Date(Date.now() + offset * 86_400_000)
  return at.toISOString().slice(0, 10)
}

// ── Who you are ────────────────────────────────────────────────────────────
const users = await (
  await fetch(`${STACK}/auth/v1/admin/users?page=1&per_page=1000`, { headers })
).json()
const user = users.users?.find((one) => one.email?.toLowerCase() === email.toLowerCase())
if (!user) {
  console.error(
    `No account for ${email}.\n` +
      `Sign in once at http://127.0.0.1:3000/prihlaseni (the code arrives in Mailpit,\n` +
      `http://127.0.0.1:54324) and run this again.`,
  )
  process.exit(1)
}

const [me] = await get(`app_profiles?auth_user_id=eq.${user.id}&select=id,display_name`)
if (!me) throw new Error(`Signed in, but no profile for ${email}. Has the trigger run?`)

const [workspace] = await get('workspaces?select=id,name,primary_sport_id&limit=1')
const facilities = await get('facilities?select=id,code,location_id')
const hall = (code) => facilities.find((one) => one.code === code)

// Your name, if nobody has given you one — every screen shows the coach.
if (!me.display_name) {
  await fetch(`${STACK}/rest/v1/app_profiles?id=eq.${me.id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ first_name: 'Milan', last_name: 'Filipi' }),
  })
}

for (const role of ['COACH', 'WORKSPACE_ADMIN']) {
  await fetch(`${STACK}/rest/v1/workspace_members`, {
    method: 'POST',
    headers: { ...headers, prefer: 'resolution=ignore-duplicates' },
    body: JSON.stringify({ workspace_id: workspace.id, profile_id: me.id, role }),
  })
}

// A number, so a parent whose child you remove has somebody to ring (§G6d).
await fetch(`${STACK}/rest/v1/staff_contacts`, {
  method: 'POST',
  headers: { ...headers, prefer: 'resolution=merge-duplicates' },
  body: JSON.stringify({ profile_id: me.id, phone: '777 654 321' }),
})

if (staffOnly) {
  console.log(`
${email} is now the coach and administrator of ${workspace.name}, and the club
is empty — no families, no trainings, nothing booked. This is the club on the
day it is handed over.

  application  http://127.0.0.1:3000
  inbox        http://127.0.0.1:54324
`)
  process.exit(0)
}

// ── The families ───────────────────────────────────────────────────────────
const FAMILIES = [
  { parent: ['Hana', 'Procházková'], child: ['Eliška', 'Procházková'], born: 2017, pos: 'CENTER' },
  { parent: ['Petr', 'Svoboda'], child: ['Tomáš', 'Svoboda'], born: 2016, pos: 'LEFT_WING' },
  { parent: ['Jana', 'Dvořáková'], child: ['Adam', 'Dvořák'], born: 2018, pos: 'GOALIE' },
  { parent: ['Marek', 'Novotný'], child: ['Filip', 'Novotný'], born: 2017, pos: 'DEFENSE' },
  { parent: ['Lucie', 'Veselá'], child: ['Nela', 'Veselá'], born: 2018, pos: 'RIGHT_WING' },
]

const athletes = []
for (const family of FAMILIES) {
  const [guardian] = await insert('app_profiles', {
    first_name: family.parent[0],
    last_name: family.parent[1],
    phone: `777${String(100000 + Math.floor(Math.random() * 899999))}`,
  })
  const [athlete] = await insert('athletes', {
    first_name: family.child[0],
    last_name: family.child[1],
    date_of_birth: `${family.born}-04-02`,
  })
  await insert('guardian_athlete_access', { profile_id: guardian.id, athlete_id: athlete.id })
  const [profile] = await insert('athlete_sport_profiles', {
    athlete_id: athlete.id,
    sport_id: workspace.primary_sport_id,
    attributes: { position: family.pos, stick_side: 'LEFT' },
  })
  await insert('workspace_athlete_memberships', {
    workspace_id: workspace.id,
    athlete_id: athlete.id,
    athlete_sport_profile_id: profile.id,
    sport_id: workspace.primary_sport_id,
  })
  athletes.push({ id: athlete.id, guardian: guardian.id, name: family.child.join(' ') })
}

// ── A fortnight of trainings ───────────────────────────────────────────────
const PLAN = [
  { offset: -6, start: '17:00', end: '18:00', hall: 'MH', room: 'Šatna 4', booked: 4 },
  { offset: -2, start: '09:00', end: '10:00', hall: 'VH', room: 'Šatna 1', booked: 3 },
  { offset: 1, start: '17:00', end: '18:00', hall: 'MH', room: 'Šatna 4', booked: 4 },
  { offset: 3, start: '17:00', end: '18:30', hall: 'MH', room: 'Šatna 4', booked: 2 },
  { offset: 5, start: '09:00', end: '10:30', hall: 'VH', room: 'Šatna 1', booked: 5, capacity: 5 },
  { offset: 8, start: '17:00', end: '18:00', hall: 'MH', room: 'Šatna 4', booked: 1 },
  { offset: 10, start: '17:00', end: '18:00', hall: 'MH', room: 'Šatna 2', booked: 0 },
  { offset: 12, start: '09:00', end: '10:00', hall: 'VH', room: 'Šatna 1', booked: 0 },
]

let bookings = 0
for (const slot of PLAN) {
  const date = day(slot.offset)
  const facility = hall(slot.hall)
  const [session] = await insert('training_sessions', {
    workspace_id: workspace.id,
    sport_id: workspace.primary_sport_id,
    location_id: facility.location_id,
    facility_id: facility.id,
    main_coach_profile_id: me.id,
    start_at: pragueInstant(date, slot.start),
    end_at: pragueInstant(date, slot.end),
    capacity: slot.capacity ?? 10,
    status: 'OPEN',
    created_by: me.id,
    eligibility_mode: 'ALL',
    changing_room: slot.room,
    public_notes: slot.offset === 1 ? 'Vezměte si chrániče a láhev s pitím.' : null,
  })
  await insert('training_session_coaches', {
    training_session_id: session.id,
    profile_id: me.id,
    role: 'MAIN',
  })

  for (const athlete of athletes.slice(0, slot.booked)) {
    await insert(
      'bookings',
      {
        training_session_id: session.id,
        athlete_id: athlete.id,
        created_by: athlete.guardian,
        created_by_role: 'USER',
      },
      { returning: 'minimal' },
    )
    bookings += 1
  }
}

console.log(`
Demo data is in ${workspace.name}.

  you          ${email} — coach and administrator, phone 777 654 321
  families     ${FAMILIES.length}, one child each
  trainings    ${PLAN.length} (two of them already over, one full)
  bookings     ${bookings}

  application  http://127.0.0.1:3000
  inbox        http://127.0.0.1:54324

Everything else is the application's own: sign in as a parent with any other
address and the code will be in the inbox too.
`)
