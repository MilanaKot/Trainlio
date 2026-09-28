import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { rows } from '@/server/query-result'
import type { BookingStatus, BookingCreatorRole } from '@/types/database'

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

export type BookingGuardian = {
  profileId: string
  displayName: string | null
  phone: string | null
}

/**
 * Who to call about one booking (AC-254, coach/SPEC.md §K2).
 *
 * Every active guardian of the athlete, not whoever happened to book: two
 * parents share a child, and the one who tapped the button is not necessarily
 * the one at the rink.
 *
 * Through a domain function because a guardian's profile is deliberately not
 * coach-readable. The function returns the name and the number for this one
 * booking, to a coach of this one workspace, instead of the policy being
 * widened to every family in it.
 */
export async function getBookingGuardians(bookingId: string): Promise<BookingGuardian[]> {
  const supabase = await createClient()
  const result = await supabase.rpc('booking_guardians', { p_booking_id: bookingId })

  return rows('booking_guardians', result).map((row) => ({
    profileId: row.profile_id,
    displayName: row.display_name,
    phone: row.phone,
  }))
}

export type WorkspaceAthlete = {
  id: string
  firstName: string
  lastName: string
  birthYear: number
  isActive: boolean
  positionCode: string | null
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
export async function listWorkspaceAthletes(): Promise<WorkspaceAthlete[]> {
  const supabase = await createClient()

  const result = await supabase
    .from('athletes')
    .select(
      'id, first_name, last_name, date_of_birth, is_active, athlete_sport_profiles ( attributes )',
    )
    .order('last_name')
    .order('first_name')

  return rows('listWorkspaceAthletes', result).map((row) => {
    const profile = (row.athlete_sport_profiles ?? [])[0] as { attributes?: unknown } | undefined
    const attributes =
      typeof profile?.attributes === 'object' && profile.attributes !== null
        ? (profile.attributes as Record<string, unknown>)
        : {}

    return {
      id: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      birthYear: Number(row.date_of_birth.slice(0, 4)),
      isActive: row.is_active,
      positionCode: typeof attributes.position === 'string' ? attributes.position : null,
    }
  })
}
