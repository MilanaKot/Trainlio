import { describe, expect, it } from 'vitest'
import { attendanceTone, barTone, bucketKeys, bucketLabel, percent } from '@/lib/domain/stats'

describe('statistics (K20, K20b)', () => {
  it('rounds a percentage and has none without a whole', () => {
    expect(percent(3, 6)).toBe(50)
    expect(percent(2, 3)).toBe(67)
    expect(percent(0, 0)).toBeNull()
  })

  it('colours the lowest attendance red under 60 % and orange under 80 %', () => {
    expect(attendanceTone(50)).toBe('danger')
    expect(attendanceTone(63)).toBe('warning')
    expect(attendanceTone(80)).toBe('ink')
    expect(barTone(79)).toBe('warning')
    expect(barTone(80)).toBe('success')
  })

  it('labels the weeks of a month and the months of a season', () => {
    expect(['1', '2', '3', '4'].map((key) => bucketLabel(key, 30))).toEqual([
      '1.–7.',
      '8.–14.',
      '15.–21.',
      '22.–30.',
    ])
    expect(bucketLabel('2026-11', 30)).toBe('lis')
  })

  it('lists a season from August to July', () => {
    const keys = bucketKeys('season', 2026)
    expect(keys[0]).toBe('2026-08')
    expect(keys[4]).toBe('2026-12')
    expect(keys[5]).toBe('2027-01')
    expect(keys[11]).toBe('2027-07')
  })
})
