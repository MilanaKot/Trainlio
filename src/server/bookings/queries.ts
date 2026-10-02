import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { maybeRow, rows } from '@/server/query-result'
import { splitByTime } from '@/lib/domain/booking'
import type { EligibilityMode, SessionStatus, BookingStatus } from '@/types/database'

/**
 * The most recent significant change, as migration 28 records it.
 *
 * Snapshotted values, not references: a hall that was renamed or a coach who
 * left must not rewrite what a parent was told the training used to be.
 */
export type SignificantChange = {
  changed_at: string
  fields: ('DATE' | 'TIME' | 'LOCATION' | 'FACILITY' | 'MAIN_COACH')[]
  previous: {
    start_at?: string
    end_at?: string
    location_name?: string
    facility_code?: string
    facility_name?: string
    main_coach_name?: string
  }
}

export type GuardianSession = {
  id: string
  startAt: string
  endAt: string
  status: SessionStatus
  capacity: number
  confirmedCount: number
  locationName: string
  facilityCode: string
  /** `Malá hala`, so the detail screen can spell the code out (§G6). */
  facilityName: string
  changingRoom: string | null
  publicNotes: string | null
  eligibilityMode: EligibilityMode
  birthYearFrom: number | null
  birthYearTo: number | null
  mainCoachName: string | null
  significantChangedAt: string | null
  /** What moved and what it was before (§G4, §G6). */
  significantChange: SignificantChange | null
  /** How many of this guardian's athletes hold a confirmed booking. */
  myBookedCount: number
}

export type PickerAthlete = {
  athleteId: string
  firstName: string
  lastName: string
  /** The sheet shows the birth year beside every name (guardian/SPEC.md §G2). */
  dateOfBirth: string
  eligibility: string
  bookingStatus: BookingStatus | null
  removedByCoach: boolean
  canBook: boolean
}

export type MyBooking = {
  bookingId: string
  athleteId: string
  athleteName: string
  /** Kept apart as well, because an avatar wants two initials, not a split. */
  athleteFirstName: string
  athleteLastName: string
  bookingCreatedAt: string
  status: BookingStatus
  eligibilityNarrowedAt: string | null
  /** When this guardian last opened the booking after a change (§G4). */
  changeSeenAt: string | null
  /** Set when the coach took this athlete off the training (§G4b). */
  cancelledAt: string | null
  cancelledByName: string | null
  /** The coach's message to this parent, if they wrote one (§G6d). */
  coachMessage: string | null
  session: GuardianSession
}

/**
 * Guardian-facing session columns.
 *
 * `internal_notes` is absent — it is a different table with a staff-only
 * policy, so it cannot appear here even by mistake (D-13). `changing_room` and
 * `public_notes` are on the session row and are guardian-visible (D-12).
 *
 * The main coach is embedded through a *named* relationship. A bare
 * `app_profiles ( display_name )` is ambiguous and PostgREST refuses it:
 * training_sessions holds three foreign keys into app_profiles (created_by,
 * cancelled_by, and the main-coach mirror). The refusal is a query error, and
 * because a failed query returns no rows it renders as "no sessions at all" —
 * which is how it went unnoticed until an end-to-end flow booked a real
 * session and found the list empty.
 */

const SESSION_COLUMNS = `
  id, start_at, end_at, status, capacity, changing_room, public_notes,
  eligibility_mode, birth_year_from, birth_year_to,
  significant_changed_at, significant_change,
  facilities ( code, name ),
  locations ( name ),
  app_profiles!training_sessions_main_coach_profile_id_fkey ( display_name ),
  training_session_occupancy ( confirmed_count ),
  bookings ( id, status, athlete_id, created_at, eligibility_narrowed_at, change_seen_at,
    cancelled_at, cancellation_reason,
    app_profiles!bookings_cancelled_by_fkey ( display_name ),
             athletes ( first_name, last_name ) )
`

type Row = {
  id: string
  start_at: string
  end_at: string
  status: SessionStatus
  capacity: number
  changing_room: string | null
  public_notes: string | null
  eligibility_mode: EligibilityMode
  birth_year_from: number | null
  birth_year_to: number | null
  significant_changed_at: string | null
  significant_change: SignificantChange | null
  facilities: { code: string; name: string } | null
  locations: { name: string } | null
  app_profiles: { display_name: string | null } | null
  training_session_occupancy: { confirmed_count: number } | null
  bookings: {
    id: string
    status: BookingStatus
    athlete_id: string
    created_at: string
    eligibility_narrowed_at: string | null
    change_seen_at: string | null
    cancelled_at: string | null
    cancellation_reason: string | null
    app_profiles: { display_name: string | null } | null
    athletes: { first_name: string; last_name: string } | null
  }[]
}

function toSession(row: Row): GuardianSession {
  return {
    id: row.id,
    startAt: row.start_at,
    endAt: row.end_at,
    status: row.status,
    capacity: row.capacity,
    // The count comes from the projection, which is the only booking-derived
    // figure a guardian may read: the booking rows below are filtered by the
    // row policy to this family's own (BR-090, BR-091).
    confirmedCount: row.training_session_occupancy?.confirmed_count ?? 0,
    locationName: row.locations?.name ?? '',
    facilityCode: row.facilities?.code ?? '',
    facilityName: row.facilities?.name ?? '',
    changingRoom: row.changing_room,
    publicNotes: row.public_notes,
    eligibilityMode: row.eligibility_mode,
    birthYearFrom: row.birth_year_from,
    birthYearTo: row.birth_year_to,
    mainCoachName: row.app_profiles?.display_name ?? null,
    significantChangedAt: row.significant_changed_at,
    significantChange: row.significant_change,
    myBookedCount: (row.bookings ?? []).filter((b) => b.status === 'CONFIRMED').length,
  }
}

/**
 * Sessions a guardian may book into: future, not cancelled, in a workspace
 * where one of their athletes is a member.
 *
 * No workspace filter is written here. The row policy already restricts this
 * to workspaces where the guardian has an athlete, and excludes DRAFT (D-01),
 * so a forgotten clause cannot widen the result.
 */
export async function listBookableSessions(): Promise<GuardianSession[]> {
  const supabase = await createClient()

  const result = await supabase
    .from('training_sessions')
    .select(SESSION_COLUMNS)
    .gte('end_at', new Date().toISOString())
    .neq('status', 'CANCELLED')
    .order('start_at')

  return (rows('listBookableSessions', result) as unknown as Row[]).map(toSession)
}

export async function getGuardianSession(sessionId: string): Promise<GuardianSession | null> {
  const supabase = await createClient()
  const result = await supabase
    .from('training_sessions')
    .select(SESSION_COLUMNS)
    .eq('id', sessionId)
    .maybeSingle()

  const row = maybeRow('getGuardianSession', result)
  return row ? toSession(row as unknown as Row) : null
}

/** The picker's list, produced by the same rule the booking path enforces. */
export async function listPickerAthletes(sessionId: string): Promise<PickerAthlete[]> {
  const supabase = await createClient()
  const result = await supabase.rpc('guardian_session_athletes', {
    p_training_session_id: sessionId,
  })

  return rows('guardian_session_athletes', result).map(toPickerAthlete)
}

/**
 * The same, for a whole list of trainings in one call (migration 32).
 *
 * The training list renders a picker per card. One call per card is one round
 * trip per card, which a club with forty trainings on the board turns into
 * forty — enough to exhaust the connections before the page renders. The
 * database answers all of them at once, with the same function behind it.
 */
export async function listPickerAthletesFor(
  sessionIds: string[],
): Promise<Map<string, PickerAthlete[]>> {
  const bySession = new Map<string, PickerAthlete[]>(sessionIds.map((id) => [id, []]))
  if (sessionIds.length === 0) return bySession

  const supabase = await createClient()
  const result = await supabase.rpc('guardian_session_athletes_many', {
    p_training_session_ids: sessionIds,
  })

  for (const row of rows('guardian_session_athletes_many', result)) {
    bySession.get(row.training_session_id)?.push(toPickerAthlete(row))
  }

  return bySession
}

function toPickerAthlete(row: {
  athlete_id: string
  first_name: string
  last_name: string
  date_of_birth: string
  eligibility: string
  booking_status: PickerAthlete['bookingStatus']
  removed_by_coach: boolean
  can_book: boolean
}): PickerAthlete {
  return {
    athleteId: row.athlete_id,
    firstName: row.first_name,
    lastName: row.last_name,
    dateOfBirth: row.date_of_birth,
    eligibility: row.eligibility,
    bookingStatus: row.booking_status,
    removedByCoach: row.removed_by_coach,
    canBook: row.can_book,
  }
}

/**
 * Every booking this guardian's athletes hold, split by whether the session has
 * finished.
 *
 * D-04: Upcoming and Past derive from `end_at`, not from a COMPLETED status, so
 * nothing depends on a scheduled job. Cancelled future sessions stay in
 * Upcoming (AC-122) — the parent needs to see that the training is off.
 */
export async function listMyBookings(): Promise<{ upcoming: MyBooking[]; past: MyBooking[] }> {
  const supabase = await createClient()
  const now = new Date()

  const result = await supabase.from('training_sessions').select(SESSION_COLUMNS).order('start_at')

  const all: MyBooking[] = []

  for (const row of rows('listMyBookings', result) as unknown as Row[]) {
    const session = toSession(row)
    for (const booking of row.bookings ?? []) {
      const athlete = booking.athletes
      all.push({
        bookingId: booking.id,
        athleteId: booking.athlete_id,
        athleteName: athlete ? `${athlete.first_name} ${athlete.last_name}` : '',
        athleteFirstName: athlete?.first_name ?? '',
        athleteLastName: athlete?.last_name ?? '',
        bookingCreatedAt: booking.created_at,
        status: booking.status,
        eligibilityNarrowedAt: booking.eligibility_narrowed_at,
        changeSeenAt: booking.change_seen_at,
        cancelledAt: booking.cancelled_at,
        cancelledByName: booking.app_profiles?.display_name ?? null,
        coachMessage: booking.cancellation_reason,
        session,
      })
    }
  }

  return splitByTime(all, now)
}

/**
 * One booking, by id.
 *
 * Built on the same read as the list rather than a filter on an embedded
 * resource. A guardian's bookings are a handful of rows, the row policy
 * already limits the read to their own family, and an `!inner` filter on an
 * embedded table is the kind of PostgREST query that fails quietly and renders
 * as "not found".
 */
export async function getMyBooking(bookingId: string): Promise<MyBooking | null> {
  const { upcoming, past } = await listMyBookings()
  return [...upcoming, ...past].find((b) => b.bookingId === bookingId) ?? null
}

/**
 * The workspace's own cancellation deadline, for rendering the disabled state.
 *
 * Read rather than assumed: it is a workspace setting whose MVP value happens
 * to be 12 hours (D-03). The server computes the real comparison regardless.
 */
export async function getCancellationDeadlineHours(): Promise<number> {
  const supabase = await createClient()
  const result = await supabase
    .from('workspaces')
    .select('cancellation_deadline_hours')
    .limit(1)
    .maybeSingle()

  return maybeRow('getCancellationDeadlineHours', result)?.cancellation_deadline_hours ?? 12
}

export type RemovedByCoach = {
  profileId: string
  displayName: string | null
  phone: string | null
}

/**
 * The coach to ring about a booking they removed (§G6d, handoff v3 decision 28).
 *
 * The number is not on the coach's profile and no client session can read the
 * table that holds it (migration 33). `removed_booking_coach` answers for one
 * booking, and only while that booking is a coach's removal — so this returns
 * null on a normal booking even though the same screen renders it.
 */
export async function getRemovedBookingCoach(bookingId: string): Promise<RemovedByCoach | null> {
  const supabase = await createClient()

  const coach = rows(
    'getRemovedBookingCoach',
    await supabase.rpc('removed_booking_coach', { p_booking_id: bookingId }),
  )[0]

  if (!coach) return null

  return {
    profileId: coach.profile_id,
    displayName: coach.display_name,
    phone: coach.phone,
  }
}
