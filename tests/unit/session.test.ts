import { describe, expect, it } from 'vitest'
import { eligibilityLabel, validateSession, type SessionInput } from '@/lib/domain/session'

function input(overrides: Partial<SessionInput> = {}): SessionInput {
  return {
    localDate: '2026-10-04',
    localStartTime: '09:00',
    localEndTime: '10:00',
    facilityId: 'facility-1',
    capacity: '10',
    eligibilityMode: 'BIRTH_YEAR_RANGE',
    birthYearFrom: '2016',
    birthYearTo: '2018',
    ...overrides,
  }
}

describe('session validation', () => {
  it('accepts a complete session', () => {
    const result = validateSession(input())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.capacity).toBe(10)
    expect(result.value.birthYearFrom).toBe(2016)
  })

  it('rejects an end at or before the start', () => {
    for (const end of ['09:00', '08:59']) {
      const result = validateSession(input({ localEndTime: end }))
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.errors.localEndTime).toBe('INVALID_TIME_RANGE')
    }
  })

  // Times are compared as wall-clock strings. No Date is built here: the
  // conversion to an instant happens on the server in the workspace timezone.
  it('compares times as wall clock, not as instants', () => {
    expect(validateSession(input({ localStartTime: '23:00', localEndTime: '23:30' })).ok).toBe(true)
  })

  it('rejects a capacity outside the allowed range', () => {
    for (const capacity of ['0', '201', '', 'ten', '1.5']) {
      const result = validateSession(input({ capacity }))
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.errors.capacity).toBe('CAPACITY_OUT_OF_RANGE')
    }
    expect(validateSession(input({ capacity: '1' })).ok).toBe(true)
    expect(validateSession(input({ capacity: '200' })).ok).toBe(true)
  })

  // Number('') is 0, so a blank field must be caught before conversion or it
  // reports as an out-of-range year instead of a missing one.
  it('requires both birth years when the range mode is chosen', () => {
    for (const overrides of [
      { birthYearFrom: '', birthYearTo: '' },
      { birthYearFrom: '2016', birthYearTo: '' },
      { birthYearFrom: '  ', birthYearTo: '2018' },
      { birthYearFrom: 'abc', birthYearTo: '2018' },
    ]) {
      const result = validateSession(input(overrides))
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.errors.birthYearFrom).toBe('BIRTH_YEARS_REQUIRED')
    }
  })

  it('rejects an inverted birth-year range', () => {
    const result = validateSession(input({ birthYearFrom: '2018', birthYearTo: '2016' }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.birthYearFrom).toBe('INVALID_BIRTH_YEAR_RANGE')
  })

  // A stale range left on the row would silently reappear on the next edit.
  it('clears the birth years when the mode is ALL', () => {
    const result = validateSession(
      input({ eligibilityMode: 'ALL', birthYearFrom: '2016', birthYearTo: '2018' }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.eligibilityMode).toBe('ALL')
    expect(result.value.birthYearFrom).toBeNull()
    expect(result.value.birthYearTo).toBeNull()
  })

  it('turns blank optional fields into null', () => {
    const result = validateSession(
      input({ changingRoom: '  ', publicNotes: '', internalNotes: ' ' }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.changingRoom).toBeNull()
    expect(result.value.publicNotes).toBeNull()
    expect(result.value.internalNotes).toBeNull()
  })

  it('requires a facility', () => {
    const result = validateSession(input({ facilityId: '' }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.facilityId).toBe('FACILITY_REQUIRED')
  })
})

describe('eligibility label', () => {
  it('renders a range, a single year, or the all-athletes label', () => {
    expect(eligibilityLabel('BIRTH_YEAR_RANGE', 2017, 2018, 'Všichni')).toBe('2017–2018')
    expect(eligibilityLabel('BIRTH_YEAR_RANGE', 2018, 2018, 'Všichni')).toBe('2018')
    expect(eligibilityLabel('ALL', null, null, 'Všichni')).toBe('Všichni')
    // A range mode with missing years must not render "null–null".
    expect(eligibilityLabel('BIRTH_YEAR_RANGE', null, null, 'Všichni')).toBe('Všichni')
  })
})
