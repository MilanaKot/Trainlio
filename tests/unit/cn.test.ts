import { describe, expect, it } from 'vitest'
import { cn } from '@/lib/utils'

/**
 * These exist because the bug they describe shipped and was invisible.
 *
 * tailwind-merge knows Tailwind's own font sizes and treats every other
 * `text-*` as a colour. The design system names its sizes — `text-body`,
 * `text-row`, `text-page` — so the merger saw a colour conflict wherever a
 * component set both, and dropped whichever came first. Filled buttons lost
 * their white text and rendered near-black on cobalt and on red; badges lost
 * their size instead. No type check, lint rule or snapshot catches it.
 */
const FONT_SIZES = [
  'text-page',
  'text-hero',
  'text-form-title',
  'text-sheet-title',
  'text-count',
  'text-date',
  'text-body',
  'text-row',
  'text-meta',
  'text-hint',
  'text-caption',
  'text-badge',
] as const

describe('cn', () => {
  it.each(FONT_SIZES)('keeps a colour and %s together', (size) => {
    const result = cn('text-white', size)
    expect(result).toContain('text-white')
    expect(result).toContain(size)
  })

  it('still lets one size replace another', () => {
    expect(cn('text-body', 'text-row')).toBe('text-row')
  })

  it('still lets one colour replace another', () => {
    expect(cn('text-white', 'text-muted')).toBe('text-muted')
  })

  it('keeps the whole of a filled button intact', () => {
    // The exact combination that rendered 2.73:1 on the destructive button.
    const result = cn('bg-danger text-white', 'h-13 text-body font-bold')
    expect(result).toContain('bg-danger')
    expect(result).toContain('text-white')
    expect(result).toContain('text-body')
  })

  it('leaves Tailwind own sizes working as before', () => {
    expect(cn('text-white', 'text-sm')).toBe('text-white text-sm')
  })
})
