/**
 * How full a training is, as the interface has to say it (DESIGN_SYSTEM §6.4).
 *
 * A pure function rather than a branch inside the meter, because the same
 * answer drives three different things — the segment colour, the hint above
 * the card, and which button the footer shows — and they must not be able to
 * disagree about whether a session is full.
 */
export type CapacityState = 'open' | 'lastPlaces' | 'full' | 'closed' | 'over'

/** The share of a session that must be taken before it counts as nearly full. */
const LAST_PLACES_RATIO = 0.8

export function capacityState(
  booked: number,
  capacity: number,
  registrationOpen: boolean,
): CapacityState {
  // Closed wins over everything: a parent cannot act on any of the others, so
  // colouring a closed session as "nearly full" would be an invitation.
  if (!registrationOpen) return 'closed'

  // BR-033: a coach may put an athlete in by hand past the limit. It is a
  // supported state, never an error, so it is neither red nor "full".
  if (booked > capacity) return 'over'
  if (booked >= capacity) return 'full'
  if (capacity > 0 && booked >= capacity * LAST_PLACES_RATIO) return 'lastPlaces'

  return 'open'
}

/** Places a guardian can still take. Never negative, even over capacity. */
export function remainingPlaces(booked: number, capacity: number): number {
  return Math.max(0, capacity - booked)
}

/** How far past the limit a coach went, for the neutral `+N` pill. */
export function overCapacityBy(booked: number, capacity: number): number {
  return Math.max(0, booked - capacity)
}
