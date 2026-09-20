import { describe, expect, it } from 'vitest'
import {
  attribution,
  blockedReason,
  rosterOccupancy,
  splitCandidates,
  splitRoster,
} from '@/lib/domain/roster'
import type { CandidateRow, RosterRow } from '@/lib/domain/roster'

function entry(overrides: Partial<RosterRow> = {}): RosterRow {
  return {
    status: 'CONFIRMED',
    createdByRole: 'USER',
    capacityOverride: false,
    ...overrides,
  }
}

function candidate(overrides: Partial<CandidateRow> = {}): CandidateRow {
  return { eligibility: 'ELIGIBLE', bookingStatus: null, canAdd: true, ...overrides }
}

describe('splitting the roster', () => {
  // BR-044: both kinds of cancellation are preserved, and neither belongs in
  // the list of who is coming.
  it('keeps only confirmed bookings in the attendance list', () => {
    const entries = [
      entry(),
      entry({ status: 'CANCELLED_BY_COACH' }),
      entry({ status: 'CANCELLED_BY_USER' }),
    ]
    const { confirmed, inactive } = splitRoster(entries)
    expect(confirmed).toHaveLength(1)
    expect(inactive.map((e) => e.status)).toEqual(['CANCELLED_BY_COACH', 'CANCELLED_BY_USER'])
  })

  it('preserves the history rather than dropping it', () => {
    const entries = [entry({ status: 'CANCELLED_BY_COACH' })]
    const { confirmed, inactive } = splitRoster(entries)
    expect(confirmed).toHaveLength(0)
    expect(inactive).toHaveLength(1)
  })
})

describe('occupancy as the coach sees it', () => {
  it('counts only confirmed bookings (AC-043)', () => {
    expect(rosterOccupancy([entry(), entry({ status: 'CANCELLED_BY_USER' })], 10).confirmed).toBe(1)
  })

  // AC-050: a coach override produces 11 / 10, and the display must say so
  // rather than clamping to the capacity.
  it('reports past capacity instead of clamping', () => {
    const occupancy = rosterOccupancy(
      Array.from({ length: 11 }, () => entry()),
      10,
    )
    expect(occupancy.confirmed).toBe(11)
    expect(occupancy.overCapacity).toBe(true)
  })

  it('a full session is not yet over capacity', () => {
    expect(
      rosterOccupancy(
        Array.from({ length: 10 }, () => entry()),
        10,
      ).overCapacity,
    ).toBe(false)
  })
})

describe('attribution (BR-092)', () => {
  it('distinguishes a guardian booking from a coach addition', () => {
    expect(attribution(entry({ createdByRole: 'USER' }))).toBe('GUARDIAN')
    expect(attribution(entry({ createdByRole: 'COACH' }))).toBe('STAFF')
  })

  // The roster label must not say "a parent booked this" for an admin action.
  it('treats every staff role as staff', () => {
    expect(attribution(entry({ createdByRole: 'WORKSPACE_ADMIN' }))).toBe('STAFF')
    expect(attribution(entry({ createdByRole: 'PLATFORM_ADMIN' }))).toBe('STAFF')
  })
})

describe('why an athlete cannot be added', () => {
  it('gives no reason for one who can be', () => {
    expect(blockedReason(candidate())).toBeNull()
  })

  // The eligibility function correctly calls an already-booked athlete
  // ELIGIBLE: they meet the session's rules, they simply already hold a place.
  // Reporting that verdict would read as nonsense next to a disabled entry.
  it('reports an already-booked athlete as booked, not as eligible', () => {
    expect(blockedReason(candidate({ bookingStatus: 'CONFIRMED', canAdd: false }))).toBe(
      'ALREADY_BOOKED',
    )
  })

  it('passes through the server verdict otherwise', () => {
    expect(
      blockedReason(candidate({ eligibility: 'BIRTH_YEAR_OUT_OF_RANGE', canAdd: false })),
    ).toBe('BIRTH_YEAR_OUT_OF_RANGE')
    expect(blockedReason(candidate({ eligibility: 'ATHLETE_INACTIVE', canAdd: false }))).toBe(
      'ATHLETE_INACTIVE',
    )
  })

  // D-06 is a guardian-side block only: a coach removal is exactly what a coach
  // undoes, so the candidate stays addable.
  it('does not block an athlete a coach previously removed', () => {
    expect(blockedReason(candidate({ bookingStatus: 'CANCELLED_BY_COACH' }))).toBeNull()
  })
})

describe('splitting the candidates', () => {
  it('separates who may be added from who may not', () => {
    const { available, blocked } = splitCandidates([
      candidate(),
      candidate({ canAdd: false, eligibility: 'NO_WORKSPACE_SPORT_PROFILE' }),
    ])
    expect(available).toHaveLength(1)
    expect(blocked).toHaveLength(1)
  })

  // Unlike the guardian picker, the coach's keeps the blocked ones so the
  // reason is visible: a name that silently never appears is harder to
  // diagnose than one shown with "Chybí hokejový profil".
  it('does not discard the blocked ones', () => {
    const candidates = [candidate({ canAdd: false, eligibility: 'ATHLETE_INACTIVE' })]
    const { available, blocked } = splitCandidates(candidates)
    expect(available).toEqual([])
    expect(blocked).toEqual(candidates)
  })
})
