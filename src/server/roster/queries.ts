import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { maybeRow, rows } from '@/server/query-result'
import type { BookingStatus, BookingCreatorRole, SessionStatus } from '@/types/database'

export type RosterEntry = {
  bookingId: string
  athleteId: string
  firstName: string
  lastName: string
  birthYear: number | null
  positionCode: string | null
  stickSideCode: string | null
  jerseyNumber: string | null
  clubName: string | null
  status: BookingStatus
  createdByRole: BookingCreatorRole
  bookedByName: string | null
  bookedAt: string
  capacityOverride: boolean
  cancelledAt: string | null
  cancellationReason: string | null
  /** Handoff v3.3, decision 34: when it was marked paid, and by whom. */
  paidAt: string | null
  paidByName: string | null
  /** Decision 35: staff only — the roster function is coach-gated. */
  coachNote: string | null
  /** Decision 36: what the parent was sent, and when, and by whom. */
  parentMessage: string | null
  parentMessageSentAt: string | null
  parentMessageSentByName: string | null
  /** v3.4, decision 40: Byl / Nebyl, null until somebody marks it. */
  attendance: 'PRESENT' | 'ABSENT' | null
}

export type CandidateAthlete = {
  athleteId: string
  firstName: string
  lastName: string
  birthYear: number | null
  positionCode: string | null
  eligibility: string
  bookingStatus: BookingStatus | null
  canAdd: boolean
}

/**
 * The roster (BR-092, AC-090).
 *
 * Read through a domain function rather than a table query. The coach needs the
 * name of the guardian who made each booking, and `app_profiles` is readable
 * only for your own profile or for visible workspace staff — a guardian's
 * profile is deliberately not coach-readable. The function returns that one
 * name for this one purpose instead of the policy being widened.
 */
export async function getSessionRoster(sessionId: string): Promise<RosterEntry[]> {
  const supabase = await createClient()
  const result = await supabase.rpc('session_roster', {
    p_training_session_id: sessionId,
  })

  return rows('session_roster', result).map((row) => ({
    bookingId: row.booking_id,
    athleteId: row.athlete_id,
    firstName: row.first_name,
    lastName: row.last_name,
    birthYear: row.birth_year,
    positionCode: row.position_code,
    stickSideCode: row.stick_side_code,
    jerseyNumber: row.jersey_number,
    clubName: row.club_name,
    status: row.status,
    createdByRole: row.created_by_role,
    bookedByName: row.booked_by_name,
    bookedAt: row.booked_at,
    capacityOverride: row.capacity_override,
    cancelledAt: row.cancelled_at,
    cancellationReason: row.cancellation_reason,
    paidAt: row.paid_at,
    paidByName: row.paid_by_name,
    coachNote: row.coach_note,
    parentMessage: row.parent_message,
    parentMessageSentAt: row.parent_message_sent_at,
    parentMessageSentByName: row.parent_message_sent_by_name,
    attendance: row.attendance,
  }))
}

/**
 * Who the coach may add.
 *
 * Unlike the guardian picker this keeps the ineligible athletes, with their
 * reason: a coach adding a child by hand needs to know why a name is
 * unavailable, because "wrong birth year" and "already booked" call for
 * different actions.
 */
export async function listCandidates(sessionId: string): Promise<CandidateAthlete[]> {
  const supabase = await createClient()
  const result = await supabase.rpc('coach_session_candidates', {
    p_training_session_id: sessionId,
  })

  return rows('coach_session_candidates', result).map((row) => ({
    athleteId: row.athlete_id,
    firstName: row.first_name,
    lastName: row.last_name,
    birthYear: row.birth_year,
    positionCode: row.position_code,
    eligibility: row.eligibility,
    bookingStatus: row.booking_status,
    canAdd: row.can_add,
  }))
}

export type CoachAthlete = {
  id: string
  firstName: string
  lastName: string
  birthYear: number
  dateOfBirth: string
  isActive: boolean
  photoPath: string | null
  positionCode: string | null
  stickSideCode: string | null
  jerseyNumber: string | null
  clubName: string | null
  teamName: string | null
  /** Confirmed, not cancelled, still ahead — the figure §K12 puts on the row. */
  upcomingCount: number
  /** Matched by the search, because a coach often remembers the parent (§K12). */
  guardianNames: string[]
}

export type AthleteGuardian = {
  profileId: string
  displayName: string | null
  relationshipCode: string
  phone: string | null
  email: string | null
  /** K13r `přihlašuje na tréninky`: has booked this athlete. */
  books: boolean
}

export type CoachAthleteSession = {
  sessionId: string
  startAt: string
  endAt: string
  status: SessionStatus
  facilityCode: string | null
  changingRoom: string | null
  mainCoachId: string | null
  bookingId: string
  bookingStatus: BookingStatus
  /** v3.4: what K2 shows for this booking, per training (K13). */
  attendance: 'PRESENT' | 'ABSENT' | null
  paidAt: string | null
  coachNote: string | null
  parentMessage: string | null
  parentMessageSentAt: string | null
}

/**
 * Everyone the coach's club trains (coach/SPEC.md: the `Sportovci` tab, whose
 * content this round of the design does not specify).
 *
 * Read from the table rather than through a function, because the row policy
 * already answers exactly this question: `coach_can_see_athlete` is active
 * membership of a workspace this person coaches. A guardian running the same
 * query gets their own children and nobody else's.
 */
export async function listCoachAthletes(workspaceId: string): Promise<CoachAthlete[]> {
  const supabase = await createClient()

  const result = await supabase.rpc('coach_athletes', { p_workspace_id: workspaceId })

  return rows('coach_athletes', result).map((row) => {
    const attributes =
      typeof row.attributes === 'object' && row.attributes !== null
        ? (row.attributes as Record<string, unknown>)
        : {}

    return {
      id: row.athlete_id,
      firstName: row.first_name,
      lastName: row.last_name,
      birthYear: Number(row.date_of_birth.slice(0, 4)),
      dateOfBirth: row.date_of_birth,
      isActive: row.is_active,
      photoPath: row.photo_path,
      positionCode: typeof attributes.position === 'string' ? attributes.position : null,
      stickSideCode: typeof attributes.stick_side === 'string' ? attributes.stick_side : null,
      jerseyNumber: typeof attributes.jersey_number === 'string' ? attributes.jersey_number : null,
      clubName: typeof attributes.club === 'string' ? attributes.club : null,
      teamName: typeof attributes.team === 'string' ? attributes.team : null,
      upcomingCount: row.upcoming_count,
      guardianNames: row.guardian_names ?? [],
    }
  })
}

/**
 * The family of one athlete (§K13).
 *
 * `booking_guardians` answers the same question for one booking, and
 * deliberately so (migration 22). This is the other half: an athlete opened on
 * purpose, by the staff of a club the child actually trains at — including an
 * athlete who is booked into nothing, which is exactly the one a coach needs to
 * ring about.
 */
export async function getAthleteGuardians(athleteId: string): Promise<AthleteGuardian[]> {
  const supabase = await createClient()

  return rows(
    'athlete_guardians',
    await supabase.rpc('athlete_guardians', { p_athlete_id: athleteId }),
  ).map((row) => ({
    profileId: row.profile_id,
    displayName: row.display_name,
    relationshipCode: row.relationship_code,
    phone: row.phone,
    email: row.email,
    books: row.books,
  }))
}

/** This athlete's trainings at this club, newest first (§K13). */
export async function listAthleteSessions(
  workspaceId: string,
  athleteId: string,
): Promise<CoachAthleteSession[]> {
  const supabase = await createClient()

  return rows(
    'coach_athlete_sessions',
    await supabase.rpc('coach_athlete_sessions', {
      p_workspace_id: workspaceId,
      p_athlete_id: athleteId,
    }),
  ).map((row) => ({
    sessionId: row.training_session_id,
    startAt: row.start_at,
    endAt: row.end_at,
    status: row.status,
    facilityCode: row.facility_code,
    changingRoom: row.changing_room,
    mainCoachId: row.main_coach_profile_id,
    bookingId: row.booking_id,
    bookingStatus: row.booking_status,
    attendance: row.attendance,
    paidAt: row.paid_at,
    coachNote: row.coach_note,
    parentMessage: row.parent_message,
    parentMessageSentAt: row.parent_message_sent_at,
  }))
}

/**
 * The staff's note about an athlete (§K13, D-13).
 *
 * Its own table with a staff-only policy, so a guardian session reading it gets
 * no rows — not a null column (migration 35).
 */
export async function getAthleteInternalNote(
  workspaceId: string,
  athleteId: string,
): Promise<string | null> {
  const supabase = await createClient()

  const result = await supabase
    .from('athlete_internal_notes')
    .select('notes')
    .eq('workspace_id', workspaceId)
    .eq('athlete_id', athleteId)
    .maybeSingle()

  return maybeRow('getAthleteInternalNote', result)?.notes ?? null
}
