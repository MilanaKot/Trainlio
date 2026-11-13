import { describe, expect, it } from 'vitest'
import { safeNext } from '@/lib/safe-next'

describe('the path after a Google sign-in (AC-320)', () => {
  it('keeps a path on this site', () => {
    expect(safeNext('/moje-treninky')).toBe('/moje-treninky')
    expect(safeNext('/trener/abc?tab=zpravy')).toBe('/trener/abc?tab=zpravy')
  })

  it('goes home for anything that could leave the site', () => {
    for (const value of [
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      'javascript:alert(1)',
      '/\nevil',
      '',
      null,
      undefined,
    ]) {
      expect(safeNext(value)).toBe('/')
    }
  })
})
