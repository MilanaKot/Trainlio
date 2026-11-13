import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BookingCard } from '@/components/booking/booking-card'
import { ToastProvider } from '@/components/ui/toast'
import type { MyBooking } from '@/server/bookings/queries'

const actions = vi.hoisted(() => ({
  confirmGoing: vi.fn(async () => ({ ok: true })),
  cancelWithReason: vi.fn(async () => ({ ok: true })),
}))

vi.mock('@/server/bookings/actions', () => ({
  ...actions,
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
  paid: false,
  parentMessage: null,
  response: null,
  absenceReason: null,
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

describe('a booking the family has not answered yet (v3.7, guardian test 11)', () => {
  it('asks to confirm, with the deadline and both answers', () => {
    renderCard(booking())
    expect(screen.getByText('Potvrďte účast')).toBeInTheDocument()
    // 17:30 on Sunday, minus the workspace's twelve hours.
    expect(screen.getByText('Odhlásit lze do ne 11. 10. 05:30')).toBeInTheDocument()
    const group = screen.getByRole('group', { name: 'Účast' })
    expect(group).toHaveTextContent('Půjde')
    expect(group).toHaveTextContent('Nepůjde')
  })

  it('saves Půjde at once, without a dialog', async () => {
    renderCard(booking())
    await userEvent.click(screen.getByRole('button', { name: 'Půjde' }))
    expect(actions.confirmGoing).toHaveBeenCalledWith('b1')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  // Decision 53: past the deadline Nepůjde still works, and says it is late.
  it('keeps both answers past the deadline, and warns that it is late', () => {
    renderCard(booking(), new Date('2026-10-11T10:00:00Z'))
    expect(
      screen.getByText('Po termínu odhlášení uvidí trenér omluvu jako pozdní.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Nepůjde' })).toBeEnabled()
  })

  it('offers nothing once the training has started (guardian test 13)', () => {
    renderCard(booking(), new Date('2026-10-11T15:31:00Z'))
    expect(screen.queryByRole('group', { name: 'Účast' })).toBeNull()
    expect(screen.queryByText('Potvrďte účast')).toBeNull()
  })
})

describe('a booking the family confirmed (G4)', () => {
  const going = () => booking({ response: { sentAt: '2026-10-01T07:00:00Z', byName: 'Eva' } })

  it('says so, and keeps Nepůjde as the way out', () => {
    renderCard(going())
    expect(screen.getByText('Půjde · potvrzeno')).toBeInTheDocument()
    expect(screen.queryByText('Potvrďte účast')).toBeNull()
    expect(screen.getByRole('button', { name: 'Nepůjde' })).toBeEnabled()
  })

  it('opens the reason sheet rather than withdrawing', async () => {
    renderCard(going())
    await userEvent.click(screen.getByRole('button', { name: 'Nepůjde' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Proč Ivan nepůjde?')
    expect(actions.cancelWithReason).not.toHaveBeenCalled()
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
    // §G4b, D-06: the footer names who can re-book instead of offering a
    // button that would always fail, and there is no button at all on the card.
    expect(screen.getByText('Znovu přihlásit může jen trenér')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Odhlásit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Přihlásit' })).toBeNull()
  })

  it('reports a cancelled training and says it did not happen', () => {
    renderCard(booking({ session: session({ status: 'CANCELLED' }) }))
    expect(screen.getByText('Zrušeno trenérem')).toBeInTheDocument()
    expect(screen.getByText('Trénink se nekonal · Příbram · VH · Šatna 2')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Odhlásit' })).toBeNull()
  })

  it('marks a parent’s own withdrawal Nepůjde, with who and when (G5)', () => {
    renderCard(
      booking({
        status: 'CANCELLED_BY_USER',
        cancelledAt: '2026-10-02T09:15:00Z',
        cancelledByName: 'Rodina Kotov',
        absenceReason: 'Nemoc – teplota',
      }),
    )
    expect(screen.getByText('Nepůjde')).toBeInTheDocument()
    expect(screen.getByText('Odhlásil Rodina Kotov · 2. 10. 11:15')).toBeInTheDocument()
    expect(screen.getByText('17:30–18:30')).toHaveClass('line-through')
    expect(screen.queryByRole('group', { name: 'Účast' })).toBeNull()
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
