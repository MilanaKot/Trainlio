import { describe, expect, it } from 'vitest'
import { formatPhone, normalisePhone } from '@/lib/domain/phone'

describe('normalisePhone', () => {
  it('accepts the number as a person actually writes it', () => {
    expect(normalisePhone('+420 123 456 789')).toEqual({ ok: true, value: '+420123456789' })
    expect(normalisePhone('+420-123-456-789')).toEqual({ ok: true, value: '+420123456789' })
    expect(normalisePhone('+420 (123) 456 789')).toEqual({ ok: true, value: '+420123456789' })
    // A non-breaking space is what a paste from a contacts app often carries.
    expect(normalisePhone('+420 123 456 789')).toEqual({
      ok: true,
      value: '+420123456789',
    })
  })

  it('treats a blank field as a valid answer, because the number is optional', () => {
    expect(normalisePhone('')).toEqual({ ok: true, value: null })
    expect(normalisePhone('   ')).toEqual({ ok: true, value: null })
  })

  it('tells a missing country code apart from a bad number', () => {
    // A Czech parent typing their own number this way has made a different
    // mistake from one who typed nonsense, and gets a different sentence.
    expect(normalisePhone('777 123 456')).toEqual({ ok: false, reason: 'MISSING_COUNTRY_CODE' })
    expect(normalisePhone('00420123456789')).toEqual({ ok: false, reason: 'MISSING_COUNTRY_CODE' })
    expect(normalisePhone('+420 123 abc')).toEqual({ ok: false, reason: 'FORMAT' })
    expect(normalisePhone('+0123456789')).toEqual({ ok: false, reason: 'FORMAT' })
    expect(normalisePhone('+42')).toEqual({ ok: false, reason: 'FORMAT' })
    expect(normalisePhone(`+${'9'.repeat(16)}`)).toEqual({ ok: false, reason: 'FORMAT' })
  })

  it('produces only what the database will accept', () => {
    // The same expression the column's CHECK constraint uses (migration 22).
    const column = /^\+[1-9][0-9]{7,14}$/
    for (const input of ['+420 123 456 789', '+1 202 555 0143', '+44 20 7946 0958']) {
      const result = normalisePhone(input)
      expect(result.ok).toBe(true)
      if (result.ok && result.value !== null) expect(column.test(result.value)).toBe(true)
    }
  })
})

describe('formatPhone', () => {
  it('groups the digits for someone about to dial them', () => {
    expect(formatPhone('+420123456789')).toBe('+420 123 456 789')
  })

  it('does not pretend to know where a country code ends', () => {
    // Splitting the code needs a dial-code table. Guessing three digits turns
    // a +1 number into "+120 255 501 43", which reads as a different country.
    // Grouping the whole number instead only ever inserts spaces.
    expect(formatPhone('+12025550143')).toBe('+12 025 550 143')
    expect(formatPhone('+12025550143').replace(/\s/g, '')).toBe('+12025550143')
  })

  it('returns anything it does not recognise untouched, rather than mangling it', () => {
    expect(formatPhone('not a number')).toBe('not a number')
  })

  it('survives a round trip', () => {
    const stored = '+420123456789'
    expect(normalisePhone(formatPhone(stored))).toEqual({ ok: true, value: stored })
  })
})
