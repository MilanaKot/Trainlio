import { HOCKEY_POSITIONS, STICK_SIDES } from '@/lib/enums/hockey'
import type { HockeyPosition, StickSide } from '@/lib/enums/hockey'

/**
 * Athlete validation.
 *
 * Deliberately duplicates rules the database already enforces. SQL is the
 * authority (principle 5); this exists so a parent sees which field is wrong
 * before a round trip, and so the same rules are unit-testable without a
 * database. The duplication is only safe because both are tested against the
 * same acceptance criteria — if they ever disagree, the database wins.
 */

export const MAX_NAME_LENGTH = 100
export const MAX_JERSEY_LENGTH = 10
export const EARLIEST_DATE_OF_BIRTH = '1900-01-01'

export type AthleteFieldError =
  | 'FIRST_NAME_REQUIRED'
  | 'LAST_NAME_REQUIRED'
  | 'NAME_TOO_LONG'
  | 'DATE_OF_BIRTH_REQUIRED'
  | 'DATE_OF_BIRTH_IN_FUTURE'
  | 'DATE_OF_BIRTH_TOO_EARLY'
  | 'DATE_OF_BIRTH_MALFORMED'
  | 'POSITION_REQUIRED'
  | 'STICK_SIDE_REQUIRED'
  | 'JERSEY_TOO_LONG'

export type AthleteInput = {
  firstName: string
  lastName: string
  dateOfBirth: string
  position: string
  stickSide: string
  clubName?: string | undefined
  teamOrCategory?: string | undefined
  jerseyNumber?: string | undefined
}

export type ValidationResult =
  | { ok: true; value: ValidatedAthlete }
  | { ok: false; errors: Partial<Record<keyof AthleteInput, AthleteFieldError>> }

export type ValidatedAthlete = {
  firstName: string
  lastName: string
  dateOfBirth: string
  attributes: { position: HockeyPosition; stick_side: StickSide }
  clubName: string | null
  teamOrCategory: string | null
  jerseyNumber: string | null
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function blankToNull(value: string | undefined): string | null {
  const trimmed = (value ?? '').trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * `today` is a parameter rather than a call to `new Date()` so the
 * future-date rule is testable, and so the caller decides which day it is —
 * on the server that is the workspace's day, not the browser's.
 */
export function validateAthlete(input: AthleteInput, today: string): ValidationResult {
  const errors: Partial<Record<keyof AthleteInput, AthleteFieldError>> = {}

  const firstName = input.firstName.trim()
  const lastName = input.lastName.trim()

  if (firstName.length === 0) errors.firstName = 'FIRST_NAME_REQUIRED'
  else if (firstName.length > MAX_NAME_LENGTH) errors.firstName = 'NAME_TOO_LONG'

  if (lastName.length === 0) errors.lastName = 'LAST_NAME_REQUIRED'
  else if (lastName.length > MAX_NAME_LENGTH) errors.lastName = 'NAME_TOO_LONG'

  const dateOfBirth = input.dateOfBirth.trim()
  if (dateOfBirth.length === 0) {
    errors.dateOfBirth = 'DATE_OF_BIRTH_REQUIRED'
  } else if (!ISO_DATE.test(dateOfBirth) || Number.isNaN(Date.parse(`${dateOfBirth}T00:00:00Z`))) {
    errors.dateOfBirth = 'DATE_OF_BIRTH_MALFORMED'
  } else if (dateOfBirth > today) {
    errors.dateOfBirth = 'DATE_OF_BIRTH_IN_FUTURE'
  } else if (dateOfBirth <= EARLIEST_DATE_OF_BIRTH) {
    errors.dateOfBirth = 'DATE_OF_BIRTH_TOO_EARLY'
  }

  // AC-013 / AC-014: only the configured values. The same list is enforced by
  // the database trigger, which also rejects any attribute key outside it.
  if (!isHockeyPosition(input.position)) errors.position = 'POSITION_REQUIRED'
  if (!isStickSide(input.stickSide)) errors.stickSide = 'STICK_SIDE_REQUIRED'

  const jerseyNumber = blankToNull(input.jerseyNumber)
  if (jerseyNumber && jerseyNumber.length > MAX_JERSEY_LENGTH) {
    errors.jerseyNumber = 'JERSEY_TOO_LONG'
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors }

  return {
    ok: true,
    value: {
      firstName,
      lastName,
      dateOfBirth,
      // Exactly the two keys the sport defines. Anything else is rejected by
      // the database, so the shape is built here rather than passed through.
      attributes: {
        position: input.position as HockeyPosition,
        stick_side: input.stickSide as StickSide,
      },
      clubName: blankToNull(input.clubName),
      teamOrCategory: blankToNull(input.teamOrCategory),
      jerseyNumber,
    },
  }
}

export function isHockeyPosition(value: string): value is HockeyPosition {
  return (HOCKEY_POSITIONS as readonly string[]).includes(value)
}

export function isStickSide(value: string): value is StickSide {
  return (STICK_SIDES as readonly string[]).includes(value)
}

/** `Ivan Kotov` */
export function fullName(athlete: { first_name: string; last_name: string }): string {
  return `${athlete.first_name} ${athlete.last_name}`
}
