import { describe, expect, it } from 'vitest'
import { MAX_LOGO_BYTES, checkLogo, logoPath, logoUrl } from '@/lib/domain/logo'

const UUID = '11111111-2222-3333-4444-555555555555'
const WORKSPACE = '99999999-8888-7777-6666-555555555555'

describe('accepting a club mark (AC-277)', () => {
  it('takes the three formats the bucket takes', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
      expect(checkLogo({ size: 1000, type })).toBeNull()
    }
  })

  it('refuses anything else, whatever it is called', () => {
    expect(checkLogo({ size: 1000, type: 'image/svg+xml' })).toBe('LOGO_TYPE_NOT_ALLOWED')
    expect(checkLogo({ size: 1000, type: 'application/pdf' })).toBe('LOGO_TYPE_NOT_ALLOWED')
  })

  it('refuses a file over a megabyte, and takes one exactly at it', () => {
    expect(checkLogo({ size: MAX_LOGO_BYTES + 1, type: 'image/png' })).toBe('LOGO_TOO_LARGE')
    expect(checkLogo({ size: MAX_LOGO_BYTES, type: 'image/png' })).toBeNull()
  })

  it('refuses an empty file before anything else', () => {
    expect(checkLogo({ size: 0, type: 'image/png' })).toBe('LOGO_EMPTY')
  })
})

describe('the storage path (AC-277)', () => {
  // The path is authorization: the policy reads the second segment as the
  // workspace and requires an administrator of it.
  it('names the workspace folder', () => {
    expect(logoPath(WORKSPACE, 'image/png', UUID)).toBe(`logos/${WORKSPACE}/${UUID}.png`)
  })

  it('uses the extension of the type, not of whatever was uploaded', () => {
    expect(logoPath(WORKSPACE, 'image/jpeg', UUID)).toBe(`logos/${WORKSPACE}/${UUID}.jpg`)
    expect(logoPath(WORKSPACE, 'image/webp', UUID)).toBe(`logos/${WORKSPACE}/${UUID}.webp`)
  })

  it('refuses to build a path for a type the bucket would reject', () => {
    expect(() => logoPath(WORKSPACE, 'image/gif', UUID)).toThrow()
  })
})

describe('the public URL (AC-277)', () => {
  it('is absolute, so a mail client can fetch it', () => {
    expect(logoUrl('https://x.supabase.co', `logos/${WORKSPACE}/a.png`)).toBe(
      `https://x.supabase.co/storage/v1/object/public/workspace-logos/logos/${WORKSPACE}/a.png`,
    )
  })

  it('does not double the slash when the base carries one', () => {
    expect(logoUrl('https://x.supabase.co/', 'logos/a/b.png')).toBe(
      'https://x.supabase.co/storage/v1/object/public/workspace-logos/logos/a/b.png',
    )
  })

  it('is nothing at all for a club with no mark', () => {
    expect(logoUrl('https://x.supabase.co', null)).toBeNull()
  })
})
