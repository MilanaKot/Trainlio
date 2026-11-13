import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReasonSheet, ResponseStatus } from '@/components/booking/response-block'
import { BookingActions, ResponseSection } from '@/components/booking/booking-actions'
import { ToastProvider } from '@/components/ui/toast'
import type { MyBooking } from '@/server/bookings/queries'

const actions = vi.hoisted(() => ({
  confirmGoing: vi.fn(async () => ({ ok: true })),
  cancelWithReason: vi.fn(async () => ({ ok: true })),
  bookAthletes: vi.fn(async () => ({ ok: true })),
}))

vi.mock('@/server/bookings/actions', () => actions)

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}))

const PRAGUE = 'Europe/Prague'
const NOW = new Date('2026-10-01T08:00:00Z')

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
  session: {
    id: 's1',
    startAt: '2026-10-11T15:30:00Z',
    endAt: '2026-10-11T16:30:00Z',
    status: 'OPEN',
    capacity: 10,
    confirmedCount: 4,
    locationName: 'Příbram',
    facilityCode: 'VH',
    facilityName: 'Velká hala',
    changingRoom: '2',
    publicNotes: null,
    eligibilityMode: 'ALL',
    birthYearFrom: null,
    birthYearTo: null,
    mainCoachName: 'Jan Novák',
    significantChangedAt: null,
    significantChange: null,
    myBookedCount: 1,
  },
  ...over,
})

function sheet(onConfirm = vi.fn()) {
  render(
    <ReasonSheet
      open
      onOpenChange={() => undefined}
      firstName="Ivan"
      pending={false}
      error={null}
      onConfirm={onConfirm}
    />,
  )
  return {
    onConfirm,
    field: screen.getByRole('textbox', { name: /Důvod/ }),
    confirm: screen.getByRole('button', { name: 'Odhlásit: Ivan nepůjde' }),
  }
}

describe('ResponseStatus (DS §6.38)', () => {
  it('says each state in words, not only in colour', () => {
    const { rerender } = render(<ResponseStatus state="pending" />)
    expect(screen.getByText('Nepotvrzeno')).toBeInTheDocument()
    rerender(<ResponseStatus state="going" />)
    expect(screen.getByText('Půjde')).toBeInTheDocument()
    rerender(<ResponseStatus state="notGoing" />)
    expect(screen.getByText('Nepůjde')).toBeInTheDocument()
  })
})

describe('the reason sheet (G6g, guardian test 12)', () => {
  it('cannot be confirmed empty, blank or over 200 characters', async () => {
    const { field, confirm } = sheet()
    expect(confirm).toBeDisabled()
    await userEvent.type(field, '   ')
    expect(confirm).toBeDisabled()
    await userEvent.clear(field)
    await userEvent.click(field)
    await userEvent.paste('x'.repeat(201))
    expect(confirm).toBeDisabled()
    expect(screen.getByText('201 / 200')).toBeInTheDocument()
  })

  it('a chip writes `Nemoc – ` into the field and focuses it', async () => {
    const { field, confirm } = sheet()
    await userEvent.click(screen.getByRole('button', { name: 'Nemoc' }))
    expect(field).toHaveValue('Nemoc – ')
    expect(screen.getByRole('button', { name: 'Nemoc' })).toHaveAttribute('aria-pressed', 'true')
    await vi.waitFor(() => expect(field).toHaveFocus())
    expect(confirm).toBeEnabled()
  })

  it('sends the reason trimmed', async () => {
    const { field, confirm, onConfirm } = sheet()
    await userEvent.type(field, '  Škola – výlet  ')
    await userEvent.click(confirm)
    expect(onConfirm).toHaveBeenCalledWith('Škola – výlet')
  })
})

function section(b: MyBooking, now = NOW) {
  return render(
    <ToastProvider>
      <ResponseSection booking={b} timezone={PRAGUE} now={now} />
    </ToastProvider>,
  )
}

describe('the Účast section of G6', () => {
  it('G6f asks the question with both answers', () => {
    section(booking())
    expect(screen.getByRole('heading', { name: 'Půjde Ivan na trénink?' })).toBeInTheDocument()
    expect(screen.getByText('Nepotvrzeno')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Účast' })).toBeInTheDocument()
  })

  it('G6h says who confirmed, and offers the change', () => {
    section(booking({ response: { sentAt: '2026-09-26T17:02:00Z', byName: 'Milana Kotova' } }))
    expect(screen.getByText('Potvrzeno 26. 9. v 19:02 · Milana Kotova')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Změnit: Ivan nepůjde' })).toBeInTheDocument()
  })

  it('G6i shows the reason, who withdrew and when — read only', () => {
    section(
      booking({
        status: 'CANCELLED_BY_USER',
        cancelledAt: '2026-10-06T16:40:00Z',
        cancelledByName: 'Milana Kotova',
        absenceReason: 'Nemoc – teplota, zůstává doma.',
      }),
    )
    expect(screen.getByText('Nemoc – teplota, zůstává doma.')).toBeInTheDocument()
    expect(screen.getByText('Odhlášeno 6. 10. v 18:40 · Milana Kotova')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('is read-only from the start of the training (guardian test 13)', () => {
    section(booking(), new Date('2026-10-11T15:30:00Z'))
    expect(screen.queryByRole('group', { name: 'Účast' })).toBeNull()
  })

  it('is absent for a removal by the coach', () => {
    section(booking({ status: 'CANCELLED_BY_COACH' }))
    expect(screen.queryByRole('heading')).toBeNull()
  })
})

describe('the G6 footer (v3.7)', () => {
  function footer(b: MyBooking, now = NOW) {
    return render(
      <ToastProvider>
        <BookingActions booking={b} timezone={PRAGUE} deadlineHours={12} now={now} />
      </ToastProvider>,
    )
  }

  it('says only when a withdrawal turns late', () => {
    footer(booking())
    expect(
      screen.getByText('Po ne 11. 10. 05:30 uvidí trenér odhlášení jako pozdní'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('offers Přihlásit znovu after a withdrawal while there is a place', async () => {
    footer(booking({ status: 'CANCELLED_BY_USER', cancelledAt: '2026-09-30T10:00:00Z' }))
    await userEvent.click(screen.getByRole('button', { name: 'Přihlásit znovu' }))
    expect(actions.bookAthletes).toHaveBeenCalledWith('s1', ['a1'])
  })

  it('does not, when the training is full', () => {
    const b = booking({ status: 'CANCELLED_BY_USER', cancelledAt: '2026-09-30T10:00:00Z' })
    footer({ ...b, session: { ...b.session, confirmedCount: 10 } })
    expect(screen.queryByRole('button', { name: 'Přihlásit znovu' })).toBeNull()
  })
})
