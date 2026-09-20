import type { EligibilityMode } from '@/types/database'

/**
 * Session form validation.
 *
 * Mirrors the rules the RPC enforces so a coach sees which field is wrong
 * before a round trip. SQL remains the authority.
 */
export const MIN_CAPACITY = 1
export const MAX_CAPACITY = 200
export const MIN_BIRTH_YEAR = 1900
export const MAX_BIRTH_YEAR = 2100

export type SessionFieldError =
  | 'DATE_REQUIRED'
  | 'TIME_REQUIRED'
  | 'INVALID_TIME_RANGE'
  | 'FACILITY_REQUIRED'
  | 'CAPACITY_OUT_OF_RANGE'
  | 'BIRTH_YEARS_REQUIRED'
  | 'INVALID_BIRTH_YEAR_RANGE'

export type SessionInput = {
  localDate: string
  localStartTime: string
  localEndTime: string
  facilityId: string
  capacity: string
  eligibilityMode: string
  birthYearFrom: string
  birthYearTo: string
  changingRoom?: string | undefined
  publicNotes?: string | undefined
  internalNotes?: string | undefined
  mainCoachProfileId?: string | undefined
}

export type ValidatedSession = {
  localDate: string
  localStartTime: string
  localEndTime: string
  facilityId: string
  capacity: number
  eligibilityMode: EligibilityMode
  birthYearFrom: number | null
  birthYearTo: number | null
  changingRoom: string | null
  publicNotes: string | null
  internalNotes: string | null
  mainCoachProfileId: string | null
}

export type SessionValidation =
  | { ok: true; value: ValidatedSession }
  | { ok: false; errors: Partial<Record<keyof SessionInput, SessionFieldError>> }

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^\d{2}:\d{2}(:\d{2})?$/

function blankToNull(value: string | undefined): string | null {
  const trimmed = (value ?? '').trim()
  return trimmed.length > 0 ? trimmed : null
}

export function validateSession(input: SessionInput): SessionValidation {
  const errors: Partial<Record<keyof SessionInput, SessionFieldError>> = {}

  if (!ISO_DATE.test(input.localDate)) errors.localDate = 'DATE_REQUIRED'
  if (!TIME.test(input.localStartTime)) errors.localStartTime = 'TIME_REQUIRED'
  if (!TIME.test(input.localEndTime)) errors.localEndTime = 'TIME_REQUIRED'

  // Compared as wall-clock strings, which is what they are. No Date is
  // constructed here: the conversion to an instant happens on the server, in
  // the workspace timezone.
  if (!errors.localStartTime && !errors.localEndTime && input.localEndTime <= input.localStartTime) {
    errors.localEndTime = 'INVALID_TIME_RANGE'
  }

  if (input.facilityId.trim().length === 0) errors.facilityId = 'FACILITY_REQUIRED'

  const capacityText = input.capacity.trim()
  const capacity = capacityText.length > 0 ? Number(capacityText) : Number.NaN
  if (!Number.isInteger(capacity) || capacity < MIN_CAPACITY || capacity > MAX_CAPACITY) {
    errors.capacity = 'CAPACITY_OUT_OF_RANGE'
  }

  const byRange = input.eligibilityMode === 'BIRTH_YEAR_RANGE'
  let from: number | null = null
  let to: number | null = null

  if (byRange) {
    // Number('') is 0, not NaN, so an empty field would otherwise pass the
    // integer check and be reported as an out-of-range year rather than a
    // missing one.
    const fromText = input.birthYearFrom.trim()
    const toText = input.birthYearTo.trim()

    if (fromText.length === 0 || toText.length === 0) {
      errors.birthYearFrom = 'BIRTH_YEARS_REQUIRED'
    } else {
      from = Number(fromText)
      to = Number(toText)

      if (!Number.isInteger(from) || !Number.isInteger(to)) {
        errors.birthYearFrom = 'BIRTH_YEARS_REQUIRED'
      } else if (from < MIN_BIRTH_YEAR || to > MAX_BIRTH_YEAR || from > to) {
        errors.birthYearFrom = 'INVALID_BIRTH_YEAR_RANGE'
      }
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors }

  return {
    ok: true,
    value: {
      localDate: input.localDate,
      localStartTime: input.localStartTime,
      localEndTime: input.localEndTime,
      facilityId: input.facilityId,
      capacity,
      eligibilityMode: byRange ? 'BIRTH_YEAR_RANGE' : 'ALL',
      // Cleared rather than kept when the mode is ALL, so a stale range cannot
      // survive in the row and confuse a later edit.
      birthYearFrom: byRange ? from : null,
      birthYearTo: byRange ? to : null,
      changingRoom: blankToNull(input.changingRoom),
      publicNotes: blankToNull(input.publicNotes),
      internalNotes: blankToNull(input.internalNotes),
      mainCoachProfileId: blankToNull(input.mainCoachProfileId),
    },
  }
}

/** `2017–2018`, `2018`, or the all-athletes label. */
export function eligibilityLabel(
  mode: EligibilityMode,
  from: number | null,
  to: number | null,
  allLabel: string,
): string {
  if (mode === 'ALL' || from === null || to === null) return allLabel
  return from === to ? String(from) : `${from}–${to}`
}
