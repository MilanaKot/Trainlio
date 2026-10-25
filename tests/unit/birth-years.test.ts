import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { birthYears } from '@/components/session/training-fields'

describe('the birth years a training can be limited to', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-25T12:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('starts three years back and ends where it always has', () => {
    const years = birthYears()
    expect(years[0]).toBe(2023)
    expect(years.at(-1)).toBe(2002)
    expect(years).not.toContain(2024)
  })

  it("keeps a training's own year when the list no longer offers it", () => {
    const years = birthYears(['2025', '2018'])
    expect(years[0]).toBe(2025)
    expect(years.filter((year) => year === 2018)).toHaveLength(1)
  })

  it('ignores a range that is not set yet', () => {
    expect(birthYears(['', ''])).toEqual(birthYears())
  })
})
