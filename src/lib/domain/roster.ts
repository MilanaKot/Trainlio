import type { BookingCreatorRole, BookingStatus } from '@/types/database'

/**
 * Coach roster rules, mirrored from the server for display only.
 *
 * Nothing here authorizes anything and nothing here decides whether a booking
 * is accepted: `book_athlete_as_coach` and `cancel_booking_as_coach` re-check
 * every one of these. They exist so the roster reads as a roster — who is
 * coming first, the history behind a disclosure — rather than as the raw table.
 */

export type RosterRow = {
  status: BookingStatus
  createdByRole: BookingCreatorRole
  capacityOverride: boolean
}

export type CandidateRow = {
  eligibility: string
  bookingStatus: BookingStatus | null
  canAdd: boolean
}

/**
 * BR-044: cancelled bookings are preserved, not deleted, so the roster carries
 * rows for athletes who are not coming. The first list must be exactly who is,
 * which is what a coach reads at the rink.
 */
export function splitRoster<T extends RosterRow>(entries: T[]): { confirmed: T[]; inactive: T[] } {
  return {
    confirmed: entries.filter((e) => e.status === 'CONFIRMED'),
    inactive: entries.filter((e) => e.status !== 'CONFIRMED'),
  }
}

/**
 * The count a coach sees. Occupancy may exceed capacity, because a coach may
 * override it (BR-033, AC-050); it is never clamped, since "11 / 10" is the
 * fact the coach needs.
 */
export function rosterOccupancy(
  entries: RosterRow[],
  capacity: number,
): { confirmed: number; capacity: number; overCapacity: boolean } {
  const confirmed = splitRoster(entries).confirmed.length
  return { confirmed, capacity, overCapacity: confirmed > capacity }
}

/** BR-092: the roster says who made the booking, and under which role. */
export function attribution(entry: RosterRow): 'GUARDIAN' | 'STAFF' {
  return entry.createdByRole === 'USER' ? 'GUARDIAN' : 'STAFF'
}

/**
 * Why the coach cannot add this athlete.
 *
 * An athlete already holding a place is reported as such rather than as
 * `ELIGIBLE`, which is what the eligibility function correctly says about
 * them — the eligibility rule and the duplicate rule are different rules, and
 * only the second one is true here.
 */
export function blockedReason(candidate: CandidateRow): string | null {
  if (candidate.canAdd) return null
  if (candidate.bookingStatus === 'CONFIRMED') return 'ALREADY_BOOKED'
  return candidate.eligibility
}

export function splitCandidates<T extends CandidateRow>(
  candidates: T[],
): { available: T[]; blocked: T[] } {
  return {
    available: candidates.filter((c) => c.canAdd),
    blocked: candidates.filter((c) => !c.canAdd),
  }
}

/**
 * Name search that ignores diacritics (coach/SPEC.md §K7).
 *
 * A coach hunting for "Řezníček" on a phone types "rez". Czech names are full
 * of marks that are awkward on a keyboard and beside the point when searching,
 * so both sides are folded before comparing. It filters a list the server
 * already decided; eligibility is never a matter of spelling.
 */
export function matchesName(fullName: string, query: string): boolean {
  const fold = (value: string) =>
    value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLocaleLowerCase('cs-CZ')

  const needle = fold(query.trim())
  return needle === '' || fold(fullName).includes(needle)
}

export type AdditionOutcome = {
  ok: boolean
  code?: string | undefined
  capacity?: number | undefined
  confirmedCount?: number | undefined
}

export type SequencedAdditions =
  | { ok: true; added: number }
  | {
      ok: false
      added: number
      remaining: string[]
      code: string
      capacity?: number | undefined
      confirmedCount?: number | undefined
    }

/**
 * Add several athletes, one after another, stopping at the first refusal
 * (coach/SPEC.md §K7, D-05).
 *
 * Deliberately not atomic, unlike a guardian's booking. A coach adding three
 * athletes to a session with two places has made three separate decisions, and
 * the sensible outcome is two added and one question asked — not all three
 * refused. What succeeded stays, and what is left is reported so the dialog
 * can speak about those rather than the ones already in.
 */
export async function sequenceAdditions(
  athleteIds: readonly string[],
  addOne: (athleteId: string) => Promise<AdditionOutcome>,
): Promise<SequencedAdditions> {
  let added = 0

  for (const [index, athleteId] of athleteIds.entries()) {
    const result = await addOne(athleteId)

    if (!result.ok) {
      return {
        ok: false,
        added,
        remaining: athleteIds.slice(index),
        code: result.code ?? 'generic',
        ...(result.capacity !== undefined ? { capacity: result.capacity } : {}),
        ...(result.confirmedCount !== undefined ? { confirmedCount: result.confirmedCount } : {}),
      }
    }

    added += 1
  }

  return { ok: true, added }
}
