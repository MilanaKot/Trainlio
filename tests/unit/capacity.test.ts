import { describe, expect, it } from 'vitest'
import { capacityState, overCapacityBy, remainingPlaces } from '@/lib/domain/capacity'

describe('capacityState (DESIGN_SYSTEM §6.4)', () => {
  it('is open while there is room to spare', () => {
    expect(capacityState(0, 10, true)).toBe('open')
    expect(capacityState(7, 10, true)).toBe('open')
  })

  it('warns from four fifths, which is where the hint appears', () => {
    expect(capacityState(8, 10, true)).toBe('lastPlaces')
    expect(capacityState(9, 10, true)).toBe('lastPlaces')
  })

  it('is full at the limit, not before it', () => {
    expect(capacityState(10, 10, true)).toBe('full')
  })

  it('reports a coach override as its own state, never as an error', () => {
    expect(capacityState(11, 10, true)).toBe('over')
    expect(overCapacityBy(11, 10)).toBe(1)
  })

  it('reads closed before anything else', () => {
    // A parent can act on none of the other states once registration is shut,
    // so "nearly full" there would be an invitation to do nothing.
    expect(capacityState(8, 10, false)).toBe('closed')
    expect(capacityState(10, 10, false)).toBe('closed')
    expect(capacityState(12, 10, false)).toBe('closed')
  })

  it('survives a session with no capacity at all', () => {
    expect(capacityState(0, 0, true)).toBe('full')
  })

  it('never offers a negative number of places', () => {
    expect(remainingPlaces(3, 10)).toBe(7)
    expect(remainingPlaces(12, 10)).toBe(0)
    expect(overCapacityBy(3, 10)).toBe(0)
  })
})
