import type { BookingStatus, SessionStatus } from '@/types/database'
import type { SignificantChange } from '@/server/bookings/queries'
import { formatDateGroup, formatTimeRange } from '@/lib/time/workspace-time'

/**
 * How one booking reads in "Moje tréninky" (guardian/SPEC.md §G4, §G4b, §G5,
 * DESIGN_SYSTEM §6.6).
 *
 * Four appearances, one of which is "nothing happened". Kept as a function
 * rather than a chain of ternaries in the card, because the order of the rules
 * is the substance: which one wins decides what a parent is told.
 */

export type BookingCardVariant = 'normal' | 'removedByCoach' | 'selfCancelled' | 'cancelledSession'

export function bookingCardVariant(
  booking: { status: BookingStatus },
  session: { status: SessionStatus },
): BookingCardVariant {
  // The booking's own fate outranks the training's. A parent whose child the
  // coach took off is not in the training, so whether it later went ahead or
  // was called off is not their news — and they were never sent the
  // cancellation e-mail either, which goes to confirmed bookings only.
  if (booking.status === 'CANCELLED_BY_COACH') return 'removedByCoach'
  if (booking.status === 'CANCELLED_BY_USER') return 'selfCancelled'
  if (session.status === 'CANCELLED') return 'cancelledSession'
  return 'normal'
}

export type ChangedField = 'DATE' | 'TIME' | 'LOCATION' | 'FACILITY' | 'MAIN_COACH'

export type ChangeRow = {
  field: ChangedField
  previous: string
  current: string
}

/**
 * What a parent is shown about a change, as before/after pairs.
 *
 * Ordered by what a parent rearranges their week around: a different day
 * first, then a different time, then where. A field whose previous value was
 * not recorded is dropped rather than rendered as an empty "Původně" — an
 * older row, written before migration 28, must not produce a half-sentence.
 */
const FIELD_ORDER: ChangedField[] = ['DATE', 'TIME', 'LOCATION', 'FACILITY', 'MAIN_COACH']

export function changeRows(
  change: SignificantChange | null,
  session: {
    startAt: string
    endAt: string
    locationName: string
    facilityCode: string
    mainCoachName: string | null
  },
  timeZone: string,
): ChangeRow[] {
  if (change === null) return []

  const start = new Date(session.startAt)
  const end = new Date(session.endAt)
  const previousStart = change.previous.start_at ? new Date(change.previous.start_at) : null
  const previousEnd = change.previous.end_at ? new Date(change.previous.end_at) : null

  const rows: ChangeRow[] = []

  for (const field of FIELD_ORDER) {
    if (!change.fields.includes(field)) continue

    switch (field) {
      case 'DATE':
        if (previousStart) {
          rows.push({
            field,
            previous: formatDateGroup(previousStart, timeZone),
            current: formatDateGroup(start, timeZone),
          })
        }
        break
      case 'TIME':
        if (previousStart && previousEnd) {
          rows.push({
            field,
            previous: formatTimeRange(previousStart, previousEnd, timeZone),
            current: formatTimeRange(start, end, timeZone),
          })
        }
        break
      case 'LOCATION':
        if (change.previous.location_name) {
          rows.push({
            field,
            previous: change.previous.location_name,
            current: session.locationName,
          })
        }
        break
      case 'FACILITY':
        if (change.previous.facility_code) {
          rows.push({
            field,
            previous: change.previous.facility_code,
            current: session.facilityCode,
          })
        }
        break
      case 'MAIN_COACH':
        if (change.previous.main_coach_name && session.mainCoachName) {
          rows.push({
            field,
            previous: change.previous.main_coach_name,
            current: session.mainCoachName,
          })
        }
        break
    }
  }

  return rows
}
