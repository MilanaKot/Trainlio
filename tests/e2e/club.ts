import { expect, type APIRequestContext } from '@playwright/test'
import {
  apiUser,
  freshPerson,
  type TestPerson,
  freshAthlete,
  type TestAthlete,
  asUser,
  pickRoom,
  dateInput,
  grantCoach,
  grantWorkspaceRole,
  profileFor,
  uniqueEmail,
  MAILPIT,
  SERVICE,
  STACK,
  joinClub,
  approveAthlete,
} from './helpers'

/**
 * A club to test the coach's rights on (decision 33): shared by the
 * permissions and payment specs, which need the same administrator, view-only
 * coach, trainings and booked families.
 */

export type Rpc = { ok?: boolean; code?: string; data?: { training_session_id?: string } }

export async function rpc(token: string, name: string, body: object): Promise<Rpc> {
  const response = await fetch(`${STACK}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: asUser(token),
    body: JSON.stringify(body),
  })
  return (await response.json()) as Rpc
}

export async function facility(token: string, code: string): Promise<string> {
  const rows = (await (
    await fetch(`${STACK}/rest/v1/facilities?select=id,code`, { headers: asUser(token) })
  ).json()) as { id: string; code: string }[]
  return rows.find((row) => row.code === code)?.id ?? ''
}

/**
 * An administrator, a coach without the permission, and two trainings: one the
 * administrator leads with that coach assisting, one that coach leads.
 */
export async function club(run: number) {
  const chief = await freshPerson()
  const viewer = await freshPerson()
  const adminEmail = uniqueEmail('spravce.opravneni')
  const viewerEmail = uniqueEmail('asistent.opravneni')
  // API users: only the browser signs in through a code (see apiUser).
  const adminToken = await apiUser(adminEmail)
  const viewerToken = await apiUser(viewerEmail)

  const { workspaceId, profileId: adminId } = await grantWorkspaceRole(
    adminEmail,
    'WORKSPACE_ADMIN',
  )
  const { profileId: viewerId } = await grantCoach(viewerEmail)

  await fetch(`${STACK}/rest/v1/app_profiles?id=eq.${viewerId}`, {
    method: 'PATCH',
    headers: {
      apikey: SERVICE,
      authorization: `Bearer ${SERVICE}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ first_name: viewer.firstName, last_name: viewer.lastName }),
  })
  await fetch(`${STACK}/rest/v1/app_profiles?id=eq.${adminId}`, {
    method: 'PATCH',
    headers: {
      apikey: SERVICE,
      authorization: `Bearer ${SERVICE}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ first_name: chief.firstName, last_name: chief.lastName }),
  })

  const restricted = await rpc(adminToken, 'set_member_can_edit_trainings', {
    p_workspace_id: workspaceId,
    p_profile_id: viewerId,
    p_value: false,
  })
  expect(restricted.ok, `restricting failed: ${restricted.code}`).toBe(true)

  const mh = await facility(adminToken, 'MH')
  const training = async (room: string, mainCoach: string, internal: string | null) => {
    const created = await rpc(adminToken, 'create_training_session', {
      p_workspace_id: workspaceId,
      p_local_date: dateInput(19),
      p_local_start_time: '17:00',
      p_local_end_time: '18:00',
      p_facility_id: mh,
      p_capacity: 10,
      p_eligibility_mode: 'ALL',
      p_changing_room: room,
      p_internal_notes: internal,
      p_main_coach_profile_id: mainCoach,
    })
    expect(created.ok, `create failed: ${created.code}`).toBe(true)
    return created.data?.training_session_id ?? ''
  }

  const assisted = await training(pickRoom(), adminId, `Interní pro asistenta ${run}`)
  const led = await training(pickRoom(), viewerId, null)

  const assistants = await rpc(adminToken, 'set_session_assistants', {
    p_training_session_id: assisted,
    p_profile_ids: [viewerId],
  })
  expect(assistants.ok).toBe(true)

  return {
    workspaceId,
    /** The administrator's and the view-only coach's names, as screens print them. */
    adminName: chief.name,
    viewerName: viewer.name,
    adminEmail,
    adminToken,
    adminId,
    viewerEmail,
    viewerToken,
    viewerId,
    mh,
    assisted,
    led,
  }
}

/**
 * A child with a parent who has a phone, booked onto the training. Each one
 * different — name, year, position, stick (`freshAthlete`).
 */
export async function bookedChild(sessionId: string): Promise<{
  name: string
  athlete: TestAthlete
  parent: TestPerson
  parentEmail: string
  parentToken: string
  bookingId: string
}> {
  const athlete = await freshAthlete()
  const parent = await freshPerson()
  const parentEmail = uniqueEmail('rodic.opravneni')
  const token = await apiUser(parentEmail)
  await fetch(`${STACK}/rest/v1/app_profiles?id=eq.${await profileFor(parentEmail)}`, {
    method: 'PATCH',
    headers: {
      apikey: SERVICE,
      authorization: `Bearer ${SERVICE}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      first_name: parent.firstName,
      last_name: parent.lastName,
      phone: '777333444',
    }),
  })
  await joinClub(token)
  const workspaces = (await (
    await fetch(`${STACK}/rest/v1/rpc/joinable_workspaces`, {
      method: 'POST',
      headers: asUser(token),
      body: '{}',
    })
  ).json()) as { id: string }[]
  const created = (await (
    await fetch(`${STACK}/rest/v1/rpc/create_athlete_with_guardian`, {
      method: 'POST',
      headers: asUser(token),
      body: JSON.stringify({
        p_first_name: athlete.firstName,
        p_last_name: athlete.lastName,
        p_date_of_birth: athlete.dateOfBirth,
        p_workspace_id: workspaces[0]?.id,
        p_sport_code: 'HOCKEY',
        p_attributes: { position: athlete.position, stick_side: athlete.stickSide },
      }),
    })
  ).json()) as { ok?: boolean; data?: { athlete_id?: string } }
  await approveAthlete(created.data?.athlete_id)
  expect(created.ok).toBe(true)
  const booked = await rpc(token, 'book_athletes_as_guardian', {
    p_training_session_id: sessionId,
    p_athlete_ids: [created.data?.athlete_id],
  })
  expect(booked.ok, `booking failed: ${booked.code}`).toBe(true)
  const bookings = (await (
    await fetch(
      `${STACK}/rest/v1/bookings?select=id&training_session_id=eq.${sessionId}&athlete_id=eq.${created.data?.athlete_id}`,
      { headers: asUser(token) },
    )
  ).json()) as { id: string }[]
  return {
    name: athlete.name,
    athlete,
    parent,
    parentEmail,
    parentToken: token,
    bookingId: bookings[0]?.id ?? '',
  }
}

/**
 * Empties the outbox the way production does: the cron route — turned until
 * it has nothing left to send, as the five-minute schedule would. One turn
 * sends twenty, and a long run leaves enough administrators behind for E11 to
 * fill several (migration 50).
 */
export async function deliver(request: APIRequestContext) {
  const secret = process.env.CRON_SECRET ?? 'local-development-secret-value'
  for (let turn = 0; turn < 40; turn += 1) {
    const response = await request.get('/api/notifications/drain', {
      headers: { authorization: `Bearer ${secret}` },
    })
    expect(response.ok(), 'the drain route answered').toBe(true)
    const report = (await response.json().catch(() => ({}))) as { attempted?: number }
    if (!report.attempted) return
  }
}

export async function mailTo(address: string, subject: RegExp, attempts = 20): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const box = (await (await fetch(`${MAILPIT}/api/v1/messages?limit=200`)).json()) as {
      messages?: { Subject: string; To?: { Address: string }[] }[]
    }
    if (
      box.messages?.some(
        (one) => one.To?.some((to) => to.Address === address) && subject.test(one.Subject),
      )
    ) {
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return false
}

/**
 * Moves a training in time with the service key. Nothing in the product moves
 * a training into the past, and the cases below need one under way and one
 * three months old.
 */
export async function moveTo(sessionId: string, startOffsetMinutes: number, lengthMinutes = 60) {
  const start = new Date(Date.now() + startOffsetMinutes * 60_000)
  const end = new Date(start.getTime() + lengthMinutes * 60_000)
  const response = await fetch(`${STACK}/rest/v1/training_sessions?id=eq.${sessionId}`, {
    method: 'PATCH',
    headers: {
      apikey: SERVICE,
      authorization: `Bearer ${SERVICE}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ start_at: start.toISOString(), end_at: end.toISOString() }),
  })
  expect(response.ok, 'moving the training').toBe(true)
}
