import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { maybeRow, rows } from '@/server/query-result'
import { splitByTime } from '@/lib/domain/booking'
import type { EligibilityMode, SessionStatus, BookingStatus } from '@/types/database'

export type GuardianSession = {
  id: string
  startAt: string
  endAt: string
  status: SessionStatus
  capacity: number
  confirmedCount: number
  locationName: string
  facilityCode: string
  changingRoom: string | null
  publicNotes: string | null
  eligibilityMode: EligibilityMode
  birthYearFrom: number | null
  birthYearTo: number | null
  mainCoachName: string | null
  significantChangedAt: string | null
  /** How many of this guardian's athletes hold a confirmed booking. */
  myBookedCount: number
}

export type PickerAthlete = {
  athleteId: string
  firstName: string
  lastName: string
  eligibility: string
  bookingStatus: BookingStatus | null
  removedByCoach: boolean
  canBook: boolean
}

export type MyBooking = {
  bookingId: string
  athleteId: string
  athleteName: string
  bookingCreatedAt: string
  status: BookingStatus
  eligibilityNarrowedAt: string | null
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
  eligibility_mode, birth_year_from, birth_year_to, significant_changed_at,
  facilities ( code ),
  locations ( name ),
  app_profiles!training_sessions_main_coach_profile_id_fkey ( display_name ),
  training_session_occupancy ( confirmed_count ),
  bookings ( id, status, athlete_id, created_at, eligibility_narrowed_at,
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
  facilities: { code: string } | null
  locations: { name: string } | null
  app_profiles: { display_name: string | null } | null
  training_session_occupancy: { confirmed_count: number } | null
  bookings: {
    id: string
    status: BookingStatus
    athlete_id: string
    created_at: string
    eligibility_narrowed_at: string | null
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
    changingRoom: row.changing_room,
    publicNotes: row.public_notes,
    eligibilityMode: row.eligibility_mode,
    birthYearFrom: row.birth_year_from,
    birthYearTo: row.birth_year_to,
    mainCoachName: row.app_profiles?.display_name ?? null,
    significantChangedAt: row.significant_changed_at,
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

  return rows('guardian_session_athletes', result).map((row) => ({
    athleteId: row.athlete_id,
    firstName: row.first_name,
    lastName: row.last_name,
    eligibility: row.eligibility,
    bookingStatus: row.booking_status,
    removedByCoach: row.removed_by_coach,
    canBook: row.can_book,
  }))
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
        bookingCreatedAt: booking.created_at,
        status: booking.status,
        eligibilityNarrowedAt: booking.eligibility_narrowed_at,
        session,
      })
    }
  }

  return splitByTime(all, now)
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
