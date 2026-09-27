import { describe, expect, it } from 'vitest'
import { formatPhone, normalisePhone } from '@/lib/domain/phone'

describe('normalisePhone', () => {
  it('takes the number as a Czech parent writes it, with no předvolba', () => {
    // The point of the whole relaxation: a form that refuses this is telling
    // someone their own telephone number is wrong.
    expect(normalisePhone('777 123 456')).toEqual({ ok: true, value: '777123456' })
    expect(normalisePhone('777123456')).toEqual({ ok: true, value: '777123456' })
    expect(normalisePhone('602 12 34 56')).toEqual({ ok: true, value: '602123456' })
  })

  it('still takes the international form, held to E.164', () => {
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

  it('refuses what is not a number at all', () => {
    expect(normalisePhone('+420 123 abc')).toEqual({ ok: false })
    expect(normalisePhone('zavolejte mi')).toEqual({ ok: false })
    expect(normalisePhone('12345')).toEqual({ ok: false })
    expect(normalisePhone(`+${'9'.repeat(16)}`)).toEqual({ ok: false })
    // A plus means the international form, and that one is strict.
    expect(normalisePhone('+0123456789')).toEqual({ ok: false })
  })

  it('produces only what the database will accept', () => {
    // The same expression the column's CHECK constraint uses (migration 22).
    const column = /^(\+[1-9][0-9]{7,14}|[0-9]{6,15})$/
    for (const input of ['777 123 456', '+420 123 456 789', '+1 202 555 0143', '00420123456789']) {
      const result = normalisePhone(input)
      expect(result.ok).toBe(true)
      if (result.ok && result.value !== null) expect(column.test(result.value)).toBe(true)
    }
  })
})

describe('formatPhone', () => {
  it('groups the digits for someone about to dial them', () => {
    expect(formatPhone('777123456')).toBe('777 123 456')
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

  it('survives a round trip, in both shapes', () => {
    for (const stored of ['777123456', '+420123456789']) {
      expect(normalisePhone(formatPhone(stored))).toEqual({ ok: true, value: stored })
    }
  })
})
