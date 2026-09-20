import { describe, expect, it } from 'vitest'
import {
  ALLOWED_PHOTO_TYPES,
  MAX_PHOTO_BYTES,
  checkPhoto,
  photoBelongsToAthlete,
  photoPath,
} from '@/lib/domain/photo'

const ATHLETE = '11111111-2222-3333-4444-555555555555'
const UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

describe('photo validation', () => {
  it('accepts each allowed type', () => {
    for (const type of ALLOWED_PHOTO_TYPES) {
      expect(checkPhoto({ size: 1024, type })).toBeNull()
    }
  })

  it('rejects anything else', () => {
    expect(checkPhoto({ size: 1024, type: 'image/gif' })).toBe('PHOTO_TYPE_NOT_ALLOWED')
    expect(checkPhoto({ size: 1024, type: 'application/pdf' })).toBe('PHOTO_TYPE_NOT_ALLOWED')
  })

  it('rejects an oversized file at the boundary', () => {
    expect(checkPhoto({ size: MAX_PHOTO_BYTES, type: 'image/png' })).toBeNull()
    expect(checkPhoto({ size: MAX_PHOTO_BYTES + 1, type: 'image/png' })).toBe('PHOTO_TOO_LARGE')
  })

  it('rejects an empty file', () => {
    expect(checkPhoto({ size: 0, type: 'image/png' })).toBe('PHOTO_EMPTY')
  })
})

describe('photo paths', () => {
  // The path is not cosmetic: storage policies read the second segment as the
  // athlete id, and a CHECK constraint pins the shape to three segments.
  it('builds athletes/{athleteId}/{uuid}.{ext}', () => {
    expect(photoPath(ATHLETE, 'image/jpeg', UUID)).toBe(`athletes/${ATHLETE}/${UUID}.jpg`)
    expect(photoPath(ATHLETE, 'image/png', UUID)).toBe(`athletes/${ATHLETE}/${UUID}.png`)
    expect(photoPath(ATHLETE, 'image/webp', UUID)).toBe(`athletes/${ATHLETE}/${UUID}.webp`)
  })

  it('has exactly three segments, as the constraint requires', () => {
    expect(photoPath(ATHLETE, 'image/png', UUID).split('/')).toHaveLength(3)
  })

  it('refuses a type it cannot map to an extension', () => {
    expect(() => photoPath(ATHLETE, 'image/gif', UUID)).toThrow()
  })

  it('recognises a path belonging to the athlete', () => {
    expect(photoBelongsToAthlete(`athletes/${ATHLETE}/${UUID}.png`, ATHLETE)).toBe(true)
  })

  // photo_path is guardian-writable, so a crafted value must not be able to
  // point a delete at another athlete's object.
  it('rejects a path pointing at another athlete', () => {
    const other = '99999999-9999-9999-9999-999999999999'
    expect(photoBelongsToAthlete(`athletes/${other}/${UUID}.png`, ATHLETE)).toBe(false)
  })

  it('rejects traversal and wrong-depth paths', () => {
    expect(photoBelongsToAthlete(`athletes/${ATHLETE}/../${UUID}.png`, ATHLETE)).toBe(false)
    expect(photoBelongsToAthlete(`athletes/${ATHLETE}`, ATHLETE)).toBe(false)
    expect(photoBelongsToAthlete(`other/${ATHLETE}/${UUID}.png`, ATHLETE)).toBe(false)
  })
})
