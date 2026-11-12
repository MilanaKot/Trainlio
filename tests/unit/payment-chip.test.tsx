import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PaymentChip } from '@/components/ui/payment-chip'

/** DESIGN_SYSTEM §6.35. */
describe('PaymentChip', () => {
  it('says `Zaplaceno` with a tick when paid', () => {
    const { container } = render(<PaymentChip paid />)
    expect(screen.getByText('Zaplaceno')).toBeInTheDocument()
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('says `Nezaplaceno`, without a tick, when not', () => {
    const { container } = render(<PaymentChip paid={false} />)
    expect(screen.getByText('Nezaplaceno')).toBeInTheDocument()
    expect(container.querySelector('svg')).toBeNull()
  })

  // Always words: a bare mark on a roster would read as attendance.
  it('is never only a mark', () => {
    for (const paid of [true, false]) {
      const { container, unmount } = render(<PaymentChip paid={paid} />)
      expect(container.textContent?.trim()).not.toBe('')
      unmount()
    }
  })

  it('keeps the tick out of the accessible name', () => {
    const { container } = render(<PaymentChip paid />)
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })
})
