import { describe, expect, it } from 'vitest'
import { bookingCardVariant, changeRows } from '@/lib/domain/booking-card'
import type { SignificantChange } from '@/server/bookings/queries'

const PRAGUE = 'Europe/Prague'

const session = {
  startAt: '2026-10-11T15:30:00Z',
  endAt: '2026-10-11T16:30:00Z',
  locationName: 'Příbram',
  facilityCode: 'VH',
  mainCoachName: 'Jan Novák',
}

describe('which card a booking gets (AC-271)', () => {
  it('is normal while nothing has happened to it', () => {
    expect(bookingCardVariant({ status: 'CONFIRMED' }, { status: 'OPEN' })).toBe('normal')
  })

  it('reports a cancelled training', () => {
    expect(bookingCardVariant({ status: 'CONFIRMED' }, { status: 'CANCELLED' })).toBe(
      'cancelledSession',
    )
  })

  it('reports the parent’s own withdrawal', () => {
    expect(bookingCardVariant({ status: 'CANCELLED_BY_USER' }, { status: 'OPEN' })).toBe(
      'selfCancelled',
    )
  })

  // The booking's own fate outranks the training's: a parent whose child was
  // taken off is not in it, and never got the cancellation e-mail either.
  it('says the coach removed the athlete even when the training was later called off', () => {
    expect(bookingCardVariant({ status: 'CANCELLED_BY_COACH' }, { status: 'CANCELLED' })).toBe(
      'removedByCoach',
    )
  })

  it('keeps the parent’s own withdrawal theirs, whatever happened after', () => {
    expect(bookingCardVariant({ status: 'CANCELLED_BY_USER' }, { status: 'CANCELLED' })).toBe(
      'selfCancelled',
    )
  })
})

describe('what a parent is told changed', () => {
  const change = (over: Partial<SignificantChange> = {}): SignificantChange => ({
    changed_at: '2026-09-26T12:10:00Z',
    fields: ['TIME'],
    previous: { start_at: '2026-10-11T15:00:00Z', end_at: '2026-10-11T16:00:00Z' },
    ...over,
  })

  it('gives the time it was and the time it is', () => {
    expect(changeRows(change(), session, PRAGUE)).toEqual([
      { field: 'TIME', previous: '17:00–18:00', current: '17:30–18:30' },
    ])
  })

  it('has nothing to say about a session nobody changed', () => {
    expect(changeRows(null, session, PRAGUE)).toEqual([])
  })

  // What a parent rearranges their week around comes first, whatever order the
  // database happened to record.
  it('puts the day before the clock and the clock before the place', () => {
    const rows = changeRows(
      change({
        fields: ['MAIN_COACH', 'FACILITY', 'TIME', 'DATE'],
        previous: {
          start_at: '2026-10-04T15:00:00Z',
          end_at: '2026-10-04T16:00:00Z',
          facility_code: 'MH',
          main_coach_name: 'Milan Filipi',
        },
      }),
      session,
      PRAGUE,
    )
    expect(rows.map((r) => r.field)).toEqual(['DATE', 'TIME', 'FACILITY', 'MAIN_COACH'])
    expect(rows[0]).toEqual({
      field: 'DATE',
      previous: 'Neděle 4. října',
      current: 'Neděle 11. října',
    })
    expect(rows[2]).toEqual({ field: 'FACILITY', previous: 'MH', current: 'VH' })
  })

  // A row written before migration 28 carries no previous value. Half a
  // sentence — "Původně" followed by nothing — is worse than silence.
  it('drops a field whose previous value was never recorded', () => {
    const rows = changeRows(
      change({ fields: ['FACILITY', 'TIME'], previous: { facility_code: 'MH' } }),
      session,
      PRAGUE,
    )
    expect(rows.map((r) => r.field)).toEqual(['FACILITY'])
  })

  it('formats in the workspace timezone, not the reader’s', () => {
    const rows = changeRows(change(), session, 'UTC')
    expect(rows[0]).toEqual({ field: 'TIME', previous: '15:00–16:00', current: '15:30–16:30' })
  })
})
