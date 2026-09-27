import { describe, expect, it } from 'vitest'
import {
  formatDateGroup,
  formatDateShort,
  formatDateTime,
  formatDeadline,
  relativeDayLabel,
} from '@/lib/time/workspace-time'

const PRAGUE = 'Europe/Prague'

describe('date formatting (DESIGN_SYSTEM §7)', () => {
  it('writes a date group heading with the month spelled out', () => {
    expect(formatDateGroup(new Date('2026-09-27T07:00:00Z'), PRAGUE)).toBe('Neděle 27. září')
  })

  it('abbreviates the weekday to the two letters the design pins', () => {
    expect(formatDateShort(new Date('2026-09-27T07:00:00Z'), PRAGUE)).toBe('Ne 27. 9.')
    expect(formatDateShort(new Date('2026-09-29T07:00:00Z'), PRAGUE)).toBe('Út 29. 9.')
    expect(formatDateShort(new Date('2026-10-01T07:00:00Z'), PRAGUE)).toBe('Čt 1. 10.')
  })

  it('lowercases the weekday in a deadline, which sits inside a sentence', () => {
    expect(formatDeadline(new Date('2026-10-03T19:00:00Z'), PRAGUE)).toBe('so 3. 10. 21:00')
  })

  it('formats the instant a booking was made', () => {
    expect(formatDateTime(new Date('2026-09-27T16:42:00Z'), PRAGUE)).toBe('27. 9. 18:42')
  })

  it('reads the weekday in the workspace timezone, not the device one', () => {
    // 23:30 UTC on a Sunday is already Monday in Prague, and the heading a
    // parent reads must say Monday.
    expect(formatDateShort(new Date('2026-09-27T23:30:00Z'), PRAGUE)).toBe('Po 28. 9.')
  })
})

describe('relativeDayLabel', () => {
  const now = new Date('2026-09-27T09:00:00Z')

  it('names today and tomorrow, and nothing else', () => {
    expect(relativeDayLabel(new Date('2026-09-27T16:00:00Z'), now, PRAGUE)).toBe('TODAY')
    expect(relativeDayLabel(new Date('2026-09-28T16:00:00Z'), now, PRAGUE)).toBe('TOMORROW')
    expect(relativeDayLabel(new Date('2026-09-29T16:00:00Z'), now, PRAGUE)).toBe(null)
    expect(relativeDayLabel(new Date('2026-09-26T16:00:00Z'), now, PRAGUE)).toBe(null)
  })

  it('crosses a month end', () => {
    const lastOfSeptember = new Date('2026-09-30T09:00:00Z')
    expect(relativeDayLabel(new Date('2026-10-01T16:00:00Z'), lastOfSeptember, PRAGUE)).toBe(
      'TOMORROW',
    )
  })

  it('means the next calendar day, not twenty-four hours later', () => {
    // Czech clocks go back on 25 October 2026, so that night is 25 hours long.
    // A training on the 25th is still "tomorrow" seen from the 24th.
    const beforeTheChange = new Date('2026-10-24T12:00:00Z')
    expect(relativeDayLabel(new Date('2026-10-25T08:00:00Z'), beforeTheChange, PRAGUE)).toBe(
      'TOMORROW',
    )
  })
})
