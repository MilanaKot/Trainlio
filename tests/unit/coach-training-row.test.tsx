import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CoachTrainingRow } from '@/components/session/coach-training-row'
import type { CoachSession } from '@/server/sessions/queries'

const PRAGUE = 'Europe/Prague'

const session = (over: Partial<CoachSession> = {}): CoachSession => ({
  id: 's1',
  startAt: '2026-10-11T15:30:00Z',
  endAt: '2026-10-11T16:30:00Z',
  status: 'OPEN',
  capacity: 10,
  confirmedCount: 4,
  facilityCode: 'MH',
  facilityName: 'Malá hala',
  locationName: 'Příbram',
  changingRoom: 'Šatna 4',
  eligibilityMode: 'ALL',
  birthYearFrom: null,
  birthYearTo: null,
  publicNotes: null,
  internalNotes: null,
  mainCoachId: 'c1',
  mainCoachName: 'Jan Novák',
  significantChangedAt: null,
  ...over,
})

const renderRow = (s: CoachSession) =>
  render(
    <ul>
      <CoachTrainingRow session={s} timezone={PRAGUE} />
    </ul>,
  )

describe('the coach training row (AC-272)', () => {
  it('reads as time, place and count', () => {
    renderRow(session())
    expect(screen.getByText('17:30–18:30')).toBeInTheDocument()
    expect(screen.getByText('MH · Šatna 4 · Všichni')).toBeInTheDocument()
    expect(screen.getByRole('meter')).toHaveTextContent('4 / 10')
  })

  it('names the birth years when the training has them', () => {
    renderRow(
      session({ eligibilityMode: 'BIRTH_YEAR_RANGE', birthYearFrom: 2017, birthYearTo: 2018 }),
    )
    expect(screen.getByText('MH · Šatna 4 · 2017–2018')).toBeInTheDocument()
  })

  // At most one status line, and only when there is something to say: a row
  // that always carries one reads as an alert that never stops.
  it('says nothing extra about an ordinary training', () => {
    renderRow(session())
    expect(screen.queryByText('Koncept')).toBeNull()
    expect(screen.queryByText('Nad kapacitu')).toBeNull()
    expect(screen.queryByText('Přihlašování uzavřeno')).toBeNull()
  })

  it('marks a draft', () => {
    renderRow(session({ status: 'DRAFT' }))
    expect(screen.getByText('Koncept')).toBeInTheDocument()
  })

  // BR-033: a coach may add past the limit. It is a supported state, so it is
  // stated rather than coloured as an error.
  it('reports a training the coach filled past its capacity', () => {
    renderRow(session({ confirmedCount: 11 }))
    expect(screen.getByText('Nad kapacitu')).toBeInTheDocument()
  })

  it('reports closed registration', () => {
    renderRow(session({ status: 'CLOSED' }))
    expect(screen.getByText('Přihlašování uzavřeno')).toBeInTheDocument()
  })

  // A cancelled training keeps its place in the list (principle 9) and says so
  // where the count would be: there is nothing left to count.
  it('strikes a cancelled training and drops the meter', () => {
    renderRow(session({ status: 'CANCELLED' }))
    expect(screen.getByText('Zrušeno')).toBeInTheDocument()
    expect(screen.queryByRole('meter')).toBeNull()
    expect(screen.getByText('17:30–18:30')).toHaveClass('line-through')
  })
})
