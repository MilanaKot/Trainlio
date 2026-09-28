import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BookingCard } from '@/components/booking/booking-card'
import { ToastProvider } from '@/components/ui/toast'
import type { MyBooking } from '@/server/bookings/queries'

vi.mock('@/server/bookings/actions', () => ({
  cancelBooking: async () => ({ ok: true }),
  markBookingChangeSeen: async () => undefined,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}))

const PRAGUE = 'Europe/Prague'
const NOW = new Date('2026-10-01T08:00:00Z')

const session = (over = {}) => ({
  id: 's1',
  startAt: '2026-10-11T15:30:00Z',
  endAt: '2026-10-11T16:30:00Z',
  status: 'OPEN' as const,
  capacity: 10,
  confirmedCount: 4,
  locationName: 'Příbram',
  facilityCode: 'VH',
  changingRoom: 'Šatna 2',
  publicNotes: null,
  eligibilityMode: 'ALL' as const,
  birthYearFrom: null,
  birthYearTo: null,
  mainCoachName: 'Jan Novák',
  significantChangedAt: null,
  significantChange: null,
  myBookedCount: 1,
  ...over,
})

const booking = (over: Partial<MyBooking> = {}): MyBooking => ({
  bookingId: 'b1',
  athleteId: 'a1',
  athleteName: 'Ivan Kotov',
  athleteFirstName: 'Ivan',
  athleteLastName: 'Kotov',
  bookingCreatedAt: '2026-09-20T10:00:00Z',
  status: 'CONFIRMED',
  eligibilityNarrowedAt: null,
  changeSeenAt: null,
  cancelledAt: null,
  cancelledByName: null,
  coachMessage: null,
  session: session(),
  ...over,
})

function renderCard(b: MyBooking, now = NOW) {
  return render(
    <ToastProvider>
      <ul>
        <BookingCard booking={b} timezone={PRAGUE} deadlineHours={12} now={now} />
      </ul>
    </ToastProvider>,
  )
}

describe('a booking a parent can still withdraw from (AC-271)', () => {
  it('offers the button with the deadline beside it', () => {
    renderCard(booking())
    // 17:30 on Sunday, minus the workspace's twelve hours.
    expect(screen.getByText('Odhlásit lze do ne 11. 10. 05:30')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Odhlásit' })).toBeEnabled()
  })

  // D-02: the button goes, the explanation stays. The server evaluates the
  // deadline on database time either way.
  it('explains itself once the deadline has passed', () => {
    renderCard(booking(), new Date('2026-10-11T10:00:00Z'))
    expect(screen.getByText('Odhlášení již není možné. Kontaktujte trenéra.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Odhlásit' })).toBeDisabled()
  })

  it('asks before withdrawing, naming the child and the training', async () => {
    renderCard(booking())
    await userEvent.click(screen.getByRole('button', { name: 'Odhlásit' }))

    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent('Odhlásit Ivan Kotov?')
    expect(dialog).toHaveTextContent('Neděle 11. října')
    expect(dialog).toHaveTextContent('17:30–18:30')
    expect(dialog).toHaveTextContent('Ponechat')
  })
})

describe('a booking something happened to (AC-271)', () => {
  it('says the coach removed the athlete, and who and when', () => {
    renderCard(
      booking({
        status: 'CANCELLED_BY_COACH',
        cancelledAt: '2026-10-02T09:15:00Z',
        cancelledByName: 'Jan Novák',
      }),
    )
    expect(screen.getByText('Odhlášeno trenérem')).toBeInTheDocument()
    expect(screen.getByText('Odhlásil Jan Novák · 2. 10. 11:15')).toBeInTheDocument()
    // D-06: a guardian cannot put them back, so no button pretends otherwise.
    expect(screen.getByText('Pro opětovné přihlášení kontaktujte trenéra.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Odhlásit' })).toBeNull()
  })

  it('reports a cancelled training and says it did not happen', () => {
    renderCard(booking({ session: session({ status: 'CANCELLED' }) }))
    expect(screen.getByText('Zrušeno trenérem')).toBeInTheDocument()
    expect(screen.getByText('Trénink se nekonal · Příbram · VH · Šatna 2')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Odhlásit' })).toBeNull()
  })

  it('keeps a parent’s own withdrawal neutral', () => {
    renderCard(
      booking({
        status: 'CANCELLED_BY_USER',
        cancelledAt: '2026-10-02T09:15:00Z',
        cancelledByName: 'Rodina Kotov',
      }),
    )
    expect(screen.getByText('Odhlášeno')).toBeInTheDocument()
    expect(screen.getByText('Odhlásil Rodina Kotov · 2. 10. 11:15')).toBeInTheDocument()
  })
})

describe('a booking whose training moved (AC-270)', () => {
  const moved = () =>
    booking({
      session: session({
        significantChangedAt: '2026-09-26T12:10:00Z',
        significantChange: {
          changed_at: '2026-09-26T12:10:00Z',
          fields: ['TIME'],
          previous: { start_at: '2026-10-11T15:00:00Z', end_at: '2026-10-11T16:00:00Z' },
        },
      }),
    })

  it('shows the badge and what it used to be', () => {
    renderCard(moved())
    expect(screen.getByText('Změněno')).toBeInTheDocument()
    expect(screen.getByText(/Původně 17:00–18:00/)).toBeInTheDocument()
    // The new time is what the card states as fact.
    expect(screen.getByText('17:30–18:30')).toBeInTheDocument()
  })

  // D-11: a parent who booked after the change was never affected by it.
  it('says nothing to a parent who booked after it', () => {
    const late = moved()
    renderCard(booking({ ...late, bookingCreatedAt: '2026-09-27T09:00:00Z' }))
    expect(screen.queryByText('Změněno')).toBeNull()
  })

  // §G4: the badge is the "new to you" flag, and opening the booking clears it.
  it('says nothing once this parent has looked', () => {
    const seen = moved()
    renderCard(booking({ ...seen, changeSeenAt: '2026-09-26T13:00:00Z' }))
    expect(screen.queryByText('Změněno')).toBeNull()
  })
})
