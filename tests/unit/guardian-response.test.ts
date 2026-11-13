import { describe, expect, it } from 'vitest'
import {
  ABSENCE_REASON_LIMIT,
  canRespond,
  chipPrefix,
  currentWithdrawals,
  isLate,
  validAbsenceReason,
} from '@/lib/domain/guardian-response'

describe('the reason for Nepůjde (G6g)', () => {
  it('is required: empty or whitespace only is refused', () => {
    expect(validAbsenceReason('')).toBe(false)
    expect(validAbsenceReason('   \n ')).toBe(false)
  })

  it('counts after trimming, up to 200 characters', () => {
    expect(validAbsenceReason('x'.repeat(ABSENCE_REASON_LIMIT))).toBe(true)
    expect(validAbsenceReason(`  ${'x'.repeat(ABSENCE_REASON_LIMIT)}  `)).toBe(true)
    expect(validAbsenceReason('x'.repeat(ABSENCE_REASON_LIMIT + 1))).toBe(false)
  })

  it('a chip prefills `{chip} – `, which is already a valid reason', () => {
    expect(chipPrefix('Nemoc')).toBe('Nemoc – ')
    expect(validAbsenceReason(chipPrefix('Nemoc'))).toBe(true)
  })
})

describe('when a family can answer (decision 53)', () => {
  const s = { startAt: '2026-10-04T20:00:00Z', status: 'OPEN' as const }
  const booking = { status: 'CONFIRMED' as const }

  it('until the start, past the cancellation deadline too', () => {
    expect(canRespond(booking, s, new Date('2026-10-04T19:59:59Z'))).toBe(true)
    expect(canRespond(booking, s, new Date('2026-10-04T20:00:00Z'))).toBe(false)
  })

  it('never on a withdrawn or removed booking, or a cancelled training', () => {
    const early = new Date('2026-10-01T00:00:00Z')
    expect(canRespond({ status: 'CANCELLED_BY_USER' }, s, early)).toBe(false)
    expect(canRespond({ status: 'CANCELLED_BY_COACH' }, s, early)).toBe(false)
    expect(canRespond(booking, { ...s, status: 'CANCELLED' }, early)).toBe(false)
  })
})

describe('a late withdrawal (Pozdě, D-02)', () => {
  const start = '2026-10-04T20:00:00Z'

  it('is on time at exactly the deadline, late a second after', () => {
    expect(isLate(start, 12, new Date('2026-10-04T08:00:00Z'))).toBe(false)
    expect(isLate(start, 12, new Date('2026-10-04T08:00:01Z'))).toBe(true)
  })

  it('reads the deadline rather than assuming twelve hours', () => {
    expect(isLate(start, 24, new Date('2026-10-03T20:00:00Z'))).toBe(false)
    expect(isLate(start, 24, new Date('2026-10-03T20:00:01Z'))).toBe(true)
  })
})

describe('the withdrawals K13 shows', () => {
  const row = (
    sessionId: string,
    bookingStatus: 'CONFIRMED' | 'CANCELLED_BY_USER' | 'CANCELLED_BY_COACH',
    cancelledAt: string | null = null,
    status: 'OPEN' | 'CANCELLED' = 'OPEN',
  ) => ({ sessionId, bookingStatus, cancelledAt, status })

  it('keeps the latest per training, none once rebooked, none on a cancelled training', () => {
    const result = currentWithdrawals([
      row('a', 'CANCELLED_BY_USER', '2026-10-01T10:00:00Z'),
      row('a', 'CANCELLED_BY_USER', '2026-10-02T10:00:00Z'),
      row('b', 'CANCELLED_BY_USER', '2026-10-01T10:00:00Z'),
      row('b', 'CONFIRMED'),
      row('c', 'CANCELLED_BY_USER', '2026-10-01T10:00:00Z', 'CANCELLED'),
      row('d', 'CANCELLED_BY_COACH', '2026-10-01T10:00:00Z'),
    ])
    expect(result.map((r) => [r.sessionId, r.cancelledAt])).toEqual([['a', '2026-10-02T10:00:00Z']])
  })
})
