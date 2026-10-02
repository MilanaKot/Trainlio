import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BookingActions } from '@/components/booking/booking-actions'
import { ToastProvider } from '@/components/ui/toast'
import type { MyBooking, RemovedByCoach } from '@/server/bookings/queries'

vi.mock('@/server/bookings/actions', () => ({
  cancelBooking: async () => ({ ok: true }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}))

const PRAGUE = 'Europe/Prague'
const NOW = new Date('2026-10-01T08:00:00Z')

const session = {
  id: 's1',
  startAt: '2026-10-11T15:30:00Z',
  endAt: '2026-10-11T16:30:00Z',
  status: 'OPEN' as const,
  capacity: 10,
  confirmedCount: 4,
  locationName: 'Příbram',
  facilityCode: 'VH',
  facilityName: 'Velká hala',
  changingRoom: 'Šatna 2',
  publicNotes: null,
  eligibilityMode: 'ALL' as const,
  birthYearFrom: null,
  birthYearTo: null,
  mainCoachName: 'Jan Novák',
  significantChangedAt: null,
  significantChange: null,
  myBookedCount: 1,
}

const removed: MyBooking = {
  bookingId: 'b1',
  athleteId: 'a1',
  athleteName: 'Ivan Kotov',
  athleteFirstName: 'Ivan',
  athleteLastName: 'Kotov',
  bookingCreatedAt: '2026-09-20T10:00:00Z',
  status: 'CANCELLED_BY_COACH',
  eligibilityNarrowedAt: null,
  changeSeenAt: null,
  cancelledAt: '2026-09-28T09:15:00Z',
  cancelledByName: 'Milan Filipi',
  coachMessage: null,
  session,
}

function renderFooter(removedBy: RemovedByCoach | null) {
  return render(
    <ToastProvider>
      <BookingActions
        booking={removed}
        timezone={PRAGUE}
        deadlineHours={12}
        now={NOW}
        removedBy={removedBy}
      />
    </ToastProvider>,
  )
}

/**
 * §G6d, D-06. The parent cannot put the athlete back, so the footer is the
 * coach instead of an action — and the only thing that varies is whether that
 * coach gave a number.
 */
describe('the footer of a booking the coach removed (AC-042a, AC-281)', () => {
  it('names who can re-book, and offers the coach to ring', () => {
    renderFooter({ profileId: 'c1', displayName: 'Milan Filipi', phone: '777111222' })

    expect(screen.getByText('Znovu přihlásit může jen trenér')).toBeInTheDocument()
    expect(screen.getByText('Milan Filipi · 777 111 222')).toBeInTheDocument()

    const call = screen.getByRole('link', { name: 'Zavolat Milan Filipi' })
    expect(call).toHaveAttribute('href', 'tel:777111222')
    expect(screen.getByRole('link', { name: 'Napsat SMS Milan Filipi' })).toHaveAttribute(
      'href',
      'sms:777111222',
    )
  })

  // Never a disabled "Zavolat": the screen cannot keep that promise, and the
  // line above it already says who to ask.
  it('shows the name alone when the coach gave no number', () => {
    renderFooter({ profileId: 'c1', displayName: 'Milan Filipi', phone: null })

    expect(screen.getByText('Znovu přihlásit může jen trenér')).toBeInTheDocument()
    expect(screen.getByText('Milan Filipi')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Zavolat/ })).toBeNull()
    expect(screen.queryByRole('link', { name: /SMS/ })).toBeNull()
  })

  // The contact comes from a function that answers for this booking only; when
  // it says nothing, the name recorded on the booking still does.
  it('falls back to the name on the booking', () => {
    renderFooter(null)

    expect(screen.getByText('Znovu přihlásit může jen trenér')).toBeInTheDocument()
    expect(screen.getByText('Milan Filipi')).toBeInTheDocument()
  })

  it('offers no withdrawal: there is nothing left to withdraw from', () => {
    renderFooter(null)
    expect(screen.queryByRole('button', { name: 'Odhlásit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Přihlásit' })).toBeNull()
  })
})
