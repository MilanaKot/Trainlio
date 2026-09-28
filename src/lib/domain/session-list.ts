import type { SessionAvailability } from '@/lib/domain/booking'

/**
 * The guardian training list: how a day is grouped, and which footer a card
 * gets (guardian/SPEC.md §G1).
 *
 * The footer table is six rules in priority order and it decides three things
 * at once — the button, whether it is pressable, and what is written beside
 * it. Kept as one pure function so those three cannot disagree, and so the
 * order is asserted rather than implied by the order of JSX branches.
 *
 * None of it authorizes anything. `canBook` is the server's own verdict,
 * already computed by `guardian_session_athletes`, and the booking function
 * re-checks every part of it. This decides what a parent sees, never what they
 * may do.
 */

/** The parts of a picker athlete this file reasons about. */
export type FooterCandidate = {
  eligibility: string
  bookingStatus: string | null
  removedByCoach: boolean
  canBook: boolean
}

export type BlockedReason =
  /** No athletes registered at all — the empty state above the list explains it. */
  | 'noAthletes'
  /** Every eligible athlete is already booked into this training. */
  | 'noOtherAthlete'
  /** D-06: the coach took an athlete off, and a guardian cannot put them back. */
  | 'removedByCoach'
  /** The design's own wording: none of them matches the birth years. */
  | 'birthYears'
  /** Something else blocks them — a missing sport profile, a deactivated athlete. */
  | 'notEligible'

export type CardFooter =
  | { kind: 'closed' }
  | { kind: 'full' }
  | { kind: 'book'; variant: 'primary' | 'secondary' }
  | { kind: 'blocked'; reason: BlockedReason }

export function cardFooter(
  availability: SessionAvailability,
  athletes: readonly FooterCandidate[],
): CardFooter {
  // Closed outranks everything, including full: a parent cannot act on either,
  // and "Obsazeno" on a training nobody can join any more would be a reason
  // that is not the reason.
  if (availability !== 'BOOKABLE' && availability !== 'FULL') return { kind: 'closed' }
  if (availability === 'FULL') return { kind: 'full' }

  const bookable = athletes.filter((a) => a.canBook)
  const booked = athletes.filter((a) => a.bookingStatus === 'CONFIRMED')

  if (booked.length > 0) {
    return bookable.length > 0
      ? { kind: 'book', variant: 'secondary' }
      : { kind: 'blocked', reason: 'noOtherAthlete' }
  }

  if (bookable.length > 0) return { kind: 'book', variant: 'primary' }

  return { kind: 'blocked', reason: blockedReason(athletes) }
}

/**
 * Why nobody can be booked.
 *
 * The design writes one sentence here — "none of your athletes matches the
 * birth years" — but that is only true when the birth years are what blocks
 * them. Telling a parent their child is the wrong age when the coach removed
 * them, or when the sport profile is missing, would send them to fix something
 * that is not broken.
 */
function blockedReason(athletes: readonly FooterCandidate[]): BlockedReason {
  if (athletes.length === 0) return 'noAthletes'
  if (athletes.some((a) => a.removedByCoach)) return 'removedByCoach'

  const blocked = athletes.filter((a) => !a.canBook)
  if (blocked.every((a) => a.eligibility === 'BIRTH_YEAR_OUT_OF_RANGE')) return 'birthYears'

  return 'notEligible'
}

/** Names for the `Přihlášen: {name}` chips, in the order the picker returns. */
export function bookedNames(
  athletes: readonly (FooterCandidate & { firstName: string; lastName: string })[],
): string[] {
  return athletes
    .filter((a) => a.bookingStatus === 'CONFIRMED')
    .map((a) => `${a.firstName} ${a.lastName}`)
}

/**
 * Consecutive sessions on the same local day, in the order given.
 *
 * Grouped on the workspace timezone's calendar date rather than the device's:
 * a training at 23:30 in Prague is tomorrow for a parent in London, and the
 * heading a parent reads has to be the one the coach meant.
 */
export function groupByLocalDay<T>(
  items: readonly T[],
  localDateKeyOf: (item: T) => string,
): { key: string; items: T[] }[] {
  const groups: { key: string; items: T[] }[] = []

  for (const item of items) {
    const key = localDateKeyOf(item)
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.items.push(item)
    else groups.push({ key, items: [item] })
  }

  return groups
}
