import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { PlaceChip } from '@/components/ui/place-chip'

const base = {
  town: 'Příbram',
  facilityCode: 'MH',
  changingRoom: '4',
  eligibilityMode: 'BIRTH_YEAR_RANGE' as const,
  birthYearFrom: 2017,
  birthYearTo: 2018,
}

describe('PlaceChip (DESIGN_SYSTEM §6.33)', () => {
  it('reads as the place and the group on one line, the hall by its code', () => {
    const { container } = render(<PlaceChip {...base} />)
    expect(container.textContent).toBe('Příbram · MH · Šatna 4 · Ročníky 2017–2018')
  })

  it('carries no icon and nothing to interact with', () => {
    const { container } = render(<PlaceChip {...base} />)
    expect(container.querySelector('svg, img, button, a, [tabindex]')).toBeNull()
  })

  it('says `Všichni` when there is no year limit', () => {
    const { container } = render(
      <PlaceChip {...base} eligibilityMode="ALL" birthYearFrom={null} birthYearTo={null} />,
    )
    expect(container.textContent).toBe('Příbram · MH · Šatna 4 · Všichni')
  })

  it('leaves out the changing room when there is none', () => {
    const { container } = render(<PlaceChip {...base} changingRoom={null} />)
    expect(container.textContent).toBe('Příbram · MH · Ročníky 2017–2018')
    expect(container.textContent).not.toContain('Šatna')
  })

  it('keeps every part whole, so a phone wraps only between them', () => {
    const { container } = render(<PlaceChip {...base} />)
    const parts = [...container.querySelectorAll('span')].map((span) => span.textContent)
    expect(parts).toEqual(['Příbram', 'MH', 'Šatna 4', 'Ročníky 2017–2018'])
    for (const span of container.querySelectorAll('span')) {
      expect(span.className).toContain('whitespace-nowrap')
    }
  })
})
