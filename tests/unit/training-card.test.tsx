import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TrainingCard } from '@/components/booking/training-card'
import { ToastProvider } from '@/components/ui/toast'
import type { GuardianSession, PickerAthlete } from '@/server/bookings/queries'

// The card subscribes to Realtime on mount. The subscription is exercised
// against the live stack by the integration suite; here it would only open a
// socket to nothing, so the browser client is replaced with one that records a
// channel and hands back no events.
vi.mock('@/lib/supabase/browser', () => ({
  createClient: () => ({
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: () => undefined,
  }),
}))

// The card mounts the booking sheet, which reaches for the server action and
// the router. Neither is what these assertions are about, and importing the
// action for real would pull in the server Supabase client and its environment.
vi.mock('@/server/bookings/actions', () => ({
  bookAthletes: async () => ({ ok: true }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}))

const PRAGUE = 'Europe/Prague'
const NOW = new Date('2026-10-01T08:00:00Z')

const session = (over: Partial<GuardianSession> = {}): GuardianSession => ({
  id: 's1',
  startAt: '2026-10-04T07:00:00Z',
  endAt: '2026-10-04T08:00:00Z',
  status: 'OPEN',
  capacity: 10,
  confirmedCount: 0,
  locationName: 'Příbram',
  facilityCode: 'MH',
  changingRoom: 'Šatna 4',
  publicNotes: null,
  eligibilityMode: 'ALL',
  birthYearFrom: null,
  birthYearTo: null,
  mainCoachName: 'Milan Filipi',
  significantChangedAt: null,
  myBookedCount: 0,
  ...over,
})

const athlete = (over: Partial<PickerAthlete> = {}): PickerAthlete => ({
  athleteId: 'a1',
  firstName: 'Ivan',
  lastName: 'Kotov',
  dateOfBirth: '2017-10-23',
  eligibility: 'ELIGIBLE',
  bookingStatus: null,
  removedByCoach: false,
  canBook: true,
  ...over,
})

function renderCard(s: GuardianSession, athletes: PickerAthlete[]) {
  return render(
    <ToastProvider>
      <ul>
        <TrainingCard
          session={s}
          timezone={PRAGUE}
          athletes={athletes}
          deadlineHours={12}
          now={NOW}
        />
      </ul>
    </ToastProvider>,
  )
}

describe('TrainingCard footer (AC-266)', () => {
  it('names the birth-year range rather than showing two bare numbers', () => {
    renderCard(
      session({ eligibilityMode: 'BIRTH_YEAR_RANGE', birthYearFrom: 2017, birthYearTo: 2018 }),
      [athlete()],
    )
    expect(screen.getByText('Ročníky 2017–2018')).toBeInTheDocument()
  })

  it('says who a training with no range is for', () => {
    renderCard(session(), [athlete()])
    expect(screen.getByText('Všichni sportovci')).toBeInTheDocument()
  })

  it('offers the booking button when a child can be booked', () => {
    renderCard(session(), [athlete()])
    expect(screen.getByRole('button', { name: 'Přihlásit' })).toBeEnabled()
  })

  it('replaces the button with a reason once registration closes', () => {
    renderCard(session({ status: 'CLOSED' }), [athlete()])
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('Přihlašování uzavřeno')).toBeInTheDocument()
  })

  it('says a full training is taken rather than offering to book it', () => {
    renderCard(session({ confirmedCount: 10 }), [athlete()])
    expect(screen.getByRole('button', { name: 'Obsazeno' })).toBeDisabled()
  })

  it('names who is booked and stops offering them again', () => {
    renderCard(session({ confirmedCount: 1 }), [
      athlete({ bookingStatus: 'CONFIRMED', canBook: false }),
    ])
    expect(screen.getByText('Přihlášen: Ivan Kotov')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Přihlásit' })).toBeDisabled()
  })

  // The design writes one sentence for "nobody can be booked"; it is only true
  // when the birth years are the reason.
  it('blames the birth years only when the birth years are to blame', () => {
    renderCard(
      session({ eligibilityMode: 'BIRTH_YEAR_RANGE', birthYearFrom: 2019, birthYearTo: 2020 }),
      [athlete({ eligibility: 'BIRTH_YEAR_OUT_OF_RANGE', canBook: false })],
    )
    expect(screen.getByText('Žádný z vašich sportovců nesplňuje ročníky')).toBeInTheDocument()
  })

  it('says the coach removed the athlete instead (D-06)', () => {
    renderCard(session(), [athlete({ removedByCoach: true, canBook: false })])
    expect(
      screen.getByText('Sportovce odebral trenér. Pro opětovné přihlášení kontaktujte trenéra.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Žádný z vašich sportovců nesplňuje ročníky')).toBeNull()
  })

  // A family with no athletes is told once, above the list, not on every card.
  it('writes no reason at all when the family has no athletes', () => {
    renderCard(session(), [])
    expect(screen.getByRole('button', { name: 'Přihlásit' })).toBeDisabled()
    expect(screen.queryByText(/nesplňuje ročníky/)).toBeNull()
    expect(screen.queryByText(/odebral trenér/)).toBeNull()
  })
})

describe('TrainingCard occupancy (AC-267)', () => {
  it('drives the meter, the hint and the footer from one count', () => {
    renderCard(session({ confirmedCount: 9 }), [athlete()])

    // 9 of 10 is the last-places band: the meter, the hint and an offered
    // button all have to agree that there is still a place.
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '9')
    expect(screen.getByText('Zbývá 1 místo')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Přihlásit' })).toBeEnabled()
  })

  it('agrees with itself at capacity', () => {
    renderCard(session({ confirmedCount: 10 }), [athlete()])

    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '10')
    // No "one place left" hint beside a button that says the training is taken.
    expect(screen.queryByText(/Zbývá/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Obsazeno' })).toBeDisabled()
  })
})

describe('the booking sheet (AC-268)', () => {
  async function openSheet(over: Partial<GuardianSession>, athletes: PickerAthlete[]) {
    renderCard(session(over), athletes)
    await userEvent.click(screen.getByRole('button', { name: 'Přihlásit' }))
    return screen.getByRole('dialog')
  }

  it('lists every athlete, with a reason on the ones that cannot be booked', async () => {
    const sheet = await openSheet(
      { eligibilityMode: 'BIRTH_YEAR_RANGE', birthYearFrom: 2017, birthYearTo: 2017 },
      [
        athlete(),
        athlete({
          athleteId: 'a2',
          firstName: 'Anna',
          dateOfBirth: '2019-05-02',
          eligibility: 'BIRTH_YEAR_OUT_OF_RANGE',
          canBook: false,
        }),
      ],
    )

    expect(sheet).toHaveTextContent('Ivan Kotov')
    // The birth year and the range, so a parent can see what does not match.
    expect(sheet).toHaveTextContent('2019 · mimo ročníky 2017–2017')
    expect(screen.getByRole('checkbox', { name: /Anna/ })).toBeDisabled()
  })

  it('preselects an only child so booking is one tap', async () => {
    const sheet = await openSheet({}, [athlete()])
    expect(screen.getByRole('checkbox', { name: /Ivan/ })).toBeChecked()
    // Preselected *and* ready to send: a checked box behind a disabled button
    // would not be one tap.
    expect(sheet.querySelector('button[type="submit"]')).toBeEnabled()
  })

  it('leaves the choice open when there is more than one', async () => {
    const sheet = await openSheet({}, [athlete(), athlete({ athleteId: 'a2', firstName: 'Tomáš' })])
    expect(screen.getByRole('checkbox', { name: /Ivan/ })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Tomáš/ })).not.toBeChecked()
    expect(sheet.querySelector('button[type="submit"]')).toBeDisabled()
  })

  // G3: a normal state of the sheet, not an error. It explains itself, keeps
  // the selection, and blocks the button rather than letting the server refuse.
  it('refuses to send more children than there are places', async () => {
    const sheet = await openSheet({ confirmedCount: 9 }, [
      athlete(),
      athlete({ athleteId: 'a2', firstName: 'Tomáš' }),
    ])

    expect(sheet).toHaveTextContent('1 volné místo')

    await userEvent.click(screen.getByRole('checkbox', { name: /Ivan/ }))
    await userEvent.click(screen.getByRole('checkbox', { name: /Tomáš/ }))

    expect(screen.getByRole('alert')).toHaveTextContent('Není dostatek volných míst')
    expect(screen.getByRole('checkbox', { name: /Ivan/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Tomáš/ })).toBeChecked()

    const confirm = sheet.querySelector('button[type="submit"]')
    expect(confirm).toBeDisabled()
  })

  it('names the deadline a parent has to cancel by', async () => {
    // Start 04.10. 09:00 Prague, minus the workspace's 12 hours.
    const sheet = await openSheet({}, [athlete()])
    expect(sheet).toHaveTextContent('Odhlásit lze do so 3. 10. 21:00')
  })
})

// guardian/SPEC.md §3: the count is live, so the last place can go while a
// parent is choosing. The sheet explains itself in place; it does not vanish.
describe('the sheet when the training fills up under it (AC-268)', () => {
  it('stays open and refuses to send, rather than disappearing', async () => {
    const { rerender } = renderCard(session({ confirmedCount: 8 }), [athlete()])
    await userEvent.click(screen.getByRole('button', { name: 'Přihlásit' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    // A newer server count arrives: every place is taken.
    rerender(
      <ToastProvider>
        <ul>
          <TrainingCard
            session={session({ confirmedCount: 10 })}
            timezone={PRAGUE}
            athletes={[athlete()]}
            deadlineHours={12}
            now={NOW}
          />
        </ul>
      </ToastProvider>,
    )

    const sheet = screen.getByRole('dialog')
    expect(sheet).toBeInTheDocument()
    expect(sheet).toHaveTextContent('10 / 10')
    expect(screen.getByRole('alert')).toHaveTextContent('Není dostatek volných míst')
    expect(sheet.querySelector('button[type="submit"]')).toBeDisabled()
  })
})
