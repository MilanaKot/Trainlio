import { describe, expect, it } from 'vitest'
import { validateAthlete, fullName, isHockeyPosition, isStickSide } from '@/lib/domain/athlete'
import { HOCKEY_POSITIONS, STICK_SIDES } from '@/lib/enums/hockey'

const TODAY = '2026-09-20'

function input(overrides: Partial<Parameters<typeof validateAthlete>[0]> = {}) {
  return {
    firstName: 'Ivan',
    lastName: 'Kotov',
    dateOfBirth: '2017-10-23',
    position: 'CENTER',
    stickSide: 'LEFT',
    ...overrides,
  }
}

describe('athlete validation', () => {
  it('accepts a complete profile and trims it', () => {
    const result = validateAthlete(input({ firstName: '  Ivan ', clubName: '  HC Příbram ' }), TODAY)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.firstName).toBe('Ivan')
    expect(result.value.clubName).toBe('HC Příbram')
  })

  it('builds exactly the two attribute keys the sport defines', () => {
    const result = validateAthlete(input(), TODAY)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // The database rejects any other key, so the shape is constructed rather
    // than passed through from the form.
    expect(Object.keys(result.value.attributes).sort()).toEqual(['position', 'stick_side'])
  })

  it('turns blank optional fields into null, not empty strings', () => {
    const result = validateAthlete(input({ clubName: '   ', jerseyNumber: '' }), TODAY)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.clubName).toBeNull()
    expect(result.value.jerseyNumber).toBeNull()
  })

  it('requires both names', () => {
    const blank = validateAthlete(input({ firstName: '  ', lastName: '' }), TODAY)
    expect(blank.ok).toBe(false)
    if (blank.ok) return
    expect(blank.errors.firstName).toBe('FIRST_NAME_REQUIRED')
    expect(blank.errors.lastName).toBe('LAST_NAME_REQUIRED')
  })

  it('rejects a date of birth in the future', () => {
    const result = validateAthlete(input({ dateOfBirth: '2026-09-21' }), TODAY)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.dateOfBirth).toBe('DATE_OF_BIRTH_IN_FUTURE')
  })

  it('accepts a date of birth of today', () => {
    expect(validateAthlete(input({ dateOfBirth: TODAY }), TODAY).ok).toBe(true)
  })

  it('rejects a malformed date', () => {
    const result = validateAthlete(input({ dateOfBirth: '23. 10. 2017' }), TODAY)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.dateOfBirth).toBe('DATE_OF_BIRTH_MALFORMED')
  })

  // AC-013 / AC-014. The same lists the database trigger enforces.
  it('accepts every configured position and stick side', () => {
    for (const position of HOCKEY_POSITIONS) {
      expect(validateAthlete(input({ position }), TODAY).ok).toBe(true)
    }
    for (const stickSide of STICK_SIDES) {
      expect(validateAthlete(input({ stickSide }), TODAY).ok).toBe(true)
    }
  })

  it('rejects a position or stick side outside those lists', () => {
    const position = validateAthlete(input({ position: 'STRIKER' }), TODAY)
    expect(position.ok).toBe(false)
    if (!position.ok) expect(position.errors.position).toBe('POSITION_REQUIRED')

    const stick = validateAthlete(input({ stickSide: 'SIDEWAYS' }), TODAY)
    expect(stick.ok).toBe(false)
    if (!stick.ok) expect(stick.errors.stickSide).toBe('STICK_SIDE_REQUIRED')
  })

  it('reports every bad field at once rather than one per round trip', () => {
    const result = validateAthlete(
      input({ firstName: '', dateOfBirth: '', position: 'X', stickSide: 'Y' }),
      TODAY,
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(Object.keys(result.errors).sort()).toEqual([
      'dateOfBirth',
      'firstName',
      'position',
      'stickSide',
    ])
  })
})

describe('type guards', () => {
  it('narrow to the configured values only', () => {
    expect(isHockeyPosition('GOALIE')).toBe(true)
    expect(isHockeyPosition('goalie')).toBe(false)
    expect(isStickSide('UNKNOWN')).toBe(true)
    expect(isStickSide('')).toBe(false)
  })
})

describe('fullName', () => {
  it('joins the core record', () => {
    expect(fullName({ first_name: 'Ivan', last_name: 'Kotov' })).toBe('Ivan Kotov')
  })
})
