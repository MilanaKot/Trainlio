import { describe, expect, it } from 'vitest'
import {
  MAX_LOGO_BYTES,
  MIN_LOGO_PIXELS,
  checkChosenLogo,
  checkStoredLogo,
  logoPath,
  logoUrl,
  pngSize,
} from '@/lib/domain/logo'

const UUID = '11111111-2222-3333-4444-555555555555'
const WORKSPACE = '99999999-8888-7777-6666-555555555555'

/** A PNG header, which is all the size check reads. */
function png(width: number, height: number, signature = true): Uint8Array {
  const bytes = new Uint8Array(24)
  bytes.set(signature ? [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] : [0, 0, 0, 0, 0, 0, 0, 0])
  bytes.set([0, 0, 0, 13], 8)
  bytes.set(
    [...'IHDR'].map((c) => c.charCodeAt(0)),
    12,
  )
  new DataView(bytes.buffer).setUint32(16, width)
  new DataView(bytes.buffer).setUint32(20, height)
  return bytes
}

describe('the file an administrator picks (admin/SPEC.md file rules)', () => {
  it('takes the three the adjust sheet knows how to rasterise', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/svg+xml']) {
      expect(checkChosenLogo({ size: 1000, type })).toBeNull()
    }
  })

  it('refuses anything else, whatever it is called', () => {
    expect(checkChosenLogo({ size: 1000, type: 'image/gif' })).toBe('LOGO_TYPE_NOT_ALLOWED')
    expect(checkChosenLogo({ size: 1000, type: 'application/pdf' })).toBe('LOGO_TYPE_NOT_ALLOWED')
  })

  it('refuses a file over two megabytes, and takes one exactly at it', () => {
    expect(checkChosenLogo({ size: MAX_LOGO_BYTES + 1, type: 'image/png' })).toBe('LOGO_TOO_LARGE')
    expect(checkChosenLogo({ size: MAX_LOGO_BYTES, type: 'image/png' })).toBeNull()
  })

  it('refuses an empty file before anything else', () => {
    expect(checkChosenLogo({ size: 0, type: 'image/png' })).toBe('LOGO_EMPTY')
  })
})

describe('the bytes that reach the bucket', () => {
  const ok = png(512, 512)

  it('takes the sheet’s own output', () => {
    expect(checkStoredLogo({ size: ok.length, type: 'image/png' }, ok)).toBeNull()
  })

  // The browser rasterises an SVG before uploading. One that arrives anyway
  // skipped the sheet, and a stored SVG is a script served from our origin.
  it('refuses an SVG even though the picker offered one', () => {
    expect(checkStoredLogo({ size: 100, type: 'image/svg+xml' }, ok)).toBe('LOGO_TYPE_NOT_ALLOWED')
    expect(checkStoredLogo({ size: 100, type: 'image/jpeg' }, ok)).toBe('LOGO_TYPE_NOT_ALLOWED')
  })

  // The declared type is a claim; the header is the evidence.
  it('refuses bytes that are not the PNG they say they are', () => {
    const lying = png(512, 512, false)
    expect(checkStoredLogo({ size: lying.length, type: 'image/png' }, lying)).toBe(
      'LOGO_TYPE_NOT_ALLOWED',
    )
  })

  it('refuses a mark smaller than the square it is drawn in', () => {
    const small = png(MIN_LOGO_PIXELS - 1, MIN_LOGO_PIXELS)
    expect(checkStoredLogo({ size: small.length, type: 'image/png' }, small)).toBe('LOGO_TOO_SMALL')
    const exact = png(MIN_LOGO_PIXELS, MIN_LOGO_PIXELS)
    expect(checkStoredLogo({ size: exact.length, type: 'image/png' }, exact)).toBeNull()
  })
})

describe('reading a PNG header', () => {
  it('reads both dimensions, big-endian', () => {
    expect(pngSize(png(1024, 300))).toEqual({ width: 1024, height: 300 })
  })

  it('is nothing for a file too short to hold a header', () => {
    expect(pngSize(new Uint8Array(10))).toBeNull()
  })

  it('is nothing for a JPEG', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(20).fill(0)])
    expect(pngSize(jpeg)).toBeNull()
  })
})

describe('the storage path (AC-277)', () => {
  // The path is authorization: the policy reads the second segment as the
  // workspace and requires an administrator of it.
  it('names the workspace folder, and always a PNG', () => {
    expect(logoPath(WORKSPACE, UUID)).toBe(`logos/${WORKSPACE}/${UUID}.png`)
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

  it('carries when the mark last changed, so no cache outlives it', () => {
    expect(logoUrl('https://x.supabase.co', 'logos/a/b.png', '2026-09-28T10:00:00Z')).toBe(
      'https://x.supabase.co/storage/v1/object/public/workspace-logos/logos/a/b.png?v=2026-09-28T10%3A00%3A00Z',
    )
  })

  it('is nothing at all for a club with no mark', () => {
    expect(logoUrl('https://x.supabase.co', null)).toBeNull()
    expect(logoUrl('https://x.supabase.co', null, '2026-09-28T10:00:00Z')).toBeNull()
  })
})
