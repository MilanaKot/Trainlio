import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { orgDisplayName, orgInitials } from '@/lib/domain/org'
import { OrgLogo } from '@/components/ui/org-logo'
import type { Organization } from '@/lib/domain/org'

function org(overrides: Partial<Organization> = {}): Organization {
  return {
    id: 'ws',
    name: 'Hokejová škola Příbram',
    shortName: null,
    logoUrl: null,
    logoBackground: 'white',
    ...overrides,
  }
}

describe('the monogram that stands in for a mark (DESIGN_SYSTEM §6.23)', () => {
  it('takes the first letters of the first two words', () => {
    expect(orgInitials('Hokejová škola Příbram')).toBe('HŠ')
    expect(orgInitials('Sportovní klub Dobříš')).toBe('SK')
  })

  // Stripping the accent would be the product misspelling the club's name.
  it('keeps Czech diacritics rather than folding them to ASCII', () => {
    expect(orgInitials('Škoda Plzeň')).toBe('ŠP')
    expect(orgInitials('čeps řízení')).toBe('ČŘ')
  })

  it('gives a one-word name its first two letters', () => {
    expect(orgInitials('Slavia')).toBe('SL')
    expect(orgInitials('šumava')).toBe('ŠU')
  })

  it('is unmoved by the spacing somebody typed', () => {
    expect(orgInitials('   Hokejová    škola   Příbram  ')).toBe('HŠ')
    expect(orgInitials('\n Slavia \t')).toBe('SL')
  })

  it('is empty for an empty name, rather than a stray character', () => {
    expect(orgInitials('')).toBe('')
    expect(orgInitials('    ')).toBe('')
  })

  it('does not cut a character in half', () => {
    // One code point, two UTF-16 units: slice(0, 2) on the string would return
    // half of it and render as a replacement character.
    expect(orgInitials('𝒜')).toBe('𝒜')
  })
})

describe('the name where the full one does not fit', () => {
  it('is the short name the club chose', () => {
    expect(orgDisplayName(org({ shortName: 'HŠ Příbram' }))).toBe('HŠ Příbram')
  })

  it('is the full name when they chose none — never an abbreviation of ours', () => {
    expect(orgDisplayName(org())).toBe('Hokejová škola Příbram')
  })
})

describe('OrgLogo', () => {
  it('draws the monogram when the club has no mark', () => {
    render(<OrgLogo org={org()} size={36} />)
    expect(screen.getByText('HŠ')).toBeInTheDocument()
    expect(document.querySelector('img')).toBeNull()
  })

  it('draws the mark when it has one', () => {
    render(<OrgLogo org={org({ logoUrl: 'https://x/logo.png' })} size={72} standsAlone />)
    const image = screen.getByRole('img')
    expect(image).toHaveAttribute('alt', 'Hokejová škola Příbram')
  })

  // §6.23: the name is printed next to it on G1 and on the sign-in screen, so
  // the mark repeats it rather than adding anything.
  it('says nothing twice when the name is beside it', () => {
    const { container } = render(<OrgLogo org={org({ logoUrl: 'https://x/logo.png' })} />)
    expect(container.querySelector('img')).toHaveAttribute('alt', '')
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('hides a monogram that would only repeat the name beside it', () => {
    const { container } = render(<OrgLogo org={org()} />)
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true')
  })

  it('names the club when the monogram is all there is', () => {
    render(<OrgLogo org={org()} standsAlone />)
    expect(screen.getByRole('img', { name: 'Hokejová škola Příbram' })).toBeInTheDocument()
  })

  // A parent on a train with a half-loaded page should see the club, not a
  // torn page.
  it('falls back to the monogram when the mark fails to load', () => {
    const { container } = render(<OrgLogo org={org({ logoUrl: 'https://x/gone.png' })} />)
    const image = container.querySelector('img')
    expect(image).not.toBeNull()
    fireEvent.error(image as HTMLImageElement)
    expect(screen.getByText('HŠ')).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
  })

  it('puts a white-background mark on a plate and a transparent one bare', () => {
    const { container: plated } = render(
      <OrgLogo org={org({ logoUrl: 'https://x/logo.png' })} size={56} />,
    )
    expect(plated.firstElementChild?.getAttribute('style')).toContain('inset 0 0 0 1px')

    const { container: bare } = render(
      <OrgLogo
        org={org({ logoUrl: 'https://x/logo.png', logoBackground: 'transparent' })}
        size={56}
      />,
    )
    expect(bare.firstElementChild?.getAttribute('style')).not.toContain('inset')
  })
})
