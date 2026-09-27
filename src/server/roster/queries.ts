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
