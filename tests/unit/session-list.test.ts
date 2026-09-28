import { describe, expect, it } from 'vitest'
import {
  bookedNames,
  cardFooter,
  groupByLocalDay,
  type FooterCandidate,
} from '@/lib/domain/session-list'

const eligible = (over: Partial<FooterCandidate> = {}): FooterCandidate => ({
  eligibility: 'ELIGIBLE',
  bookingStatus: null,
  removedByCoach: false,
  canBook: true,
  ...over,
})

const booked = () => eligible({ bookingStatus: 'CONFIRMED', canBook: false })
const wrongYear = () => eligible({ eligibility: 'BIRTH_YEAR_OUT_OF_RANGE', canBook: false })

describe('the training card footer (AC-266)', () => {
  it('offers a primary button when a child can be booked', () => {
    expect(cardFooter('BOOKABLE', [eligible()])).toEqual({ kind: 'book', variant: 'primary' })
  })

  // The table is ordered, so every rule has to be checked against the ones
  // above it rather than on its own.
  it('closes before it counts places', () => {
    expect(cardFooter('CLOSED', [eligible()])).toEqual({ kind: 'closed' })
    expect(cardFooter('STARTED', [eligible()])).toEqual({ kind: 'closed' })
    expect(cardFooter('CANCELLED', [eligible()])).toEqual({ kind: 'closed' })
    expect(cardFooter('DRAFT', [eligible()])).toEqual({ kind: 'closed' })
  })

  it('reports a full session before it looks at the family', () => {
    expect(cardFooter('FULL', [eligible()])).toEqual({ kind: 'full' })
    expect(cardFooter('FULL', [])).toEqual({ kind: 'full' })
  })

  it('drops to secondary once one child is booked and another still can be', () => {
    expect(cardFooter('BOOKABLE', [booked(), eligible()])).toEqual({
      kind: 'book',
      variant: 'secondary',
    })
  })

  it('blocks when every child is already in', () => {
    expect(cardFooter('BOOKABLE', [booked(), booked()])).toEqual({
      kind: 'blocked',
      reason: 'noOtherAthlete',
    })
  })

  it('says so when the family has no athletes yet', () => {
    expect(cardFooter('BOOKABLE', [])).toEqual({ kind: 'blocked', reason: 'noAthletes' })
  })

  it('names the birth years only when the birth years are the blocker', () => {
    expect(cardFooter('BOOKABLE', [wrongYear()])).toEqual({
      kind: 'blocked',
      reason: 'birthYears',
    })
    expect(
      cardFooter('BOOKABLE', [
        wrongYear(),
        eligible({ eligibility: 'ATHLETE_INACTIVE', canBook: false }),
      ]),
    ).toEqual({ kind: 'blocked', reason: 'notEligible' })
  })

  // D-06. "Your athlete does not match the birth years" would send a parent to
  // correct a date of birth that is perfectly right.
  it('says the coach removed them rather than blaming the birth year', () => {
    expect(cardFooter('BOOKABLE', [eligible({ removedByCoach: true, canBook: false })])).toEqual({
      kind: 'blocked',
      reason: 'removedByCoach',
    })
  })

  it('still offers the button to a sibling when one child was removed', () => {
    expect(
      cardFooter('BOOKABLE', [eligible({ removedByCoach: true, canBook: false }), eligible()]),
    ).toEqual({ kind: 'book', variant: 'primary' })
  })
})

describe('booked names', () => {
  it('lists only the confirmed ones, in the order given', () => {
    const athletes = [
      { ...booked(), firstName: 'Ivan', lastName: 'Kotov' },
      { ...eligible(), firstName: 'Tomáš', lastName: 'Kotov' },
      { ...booked(), firstName: 'Anna', lastName: 'Kotova' },
    ]
    expect(bookedNames(athletes)).toEqual(['Ivan Kotov', 'Anna Kotova'])
  })
})

describe('grouping by local day', () => {
  it('keeps consecutive sessions of one day together', () => {
    const items = [
      { id: 'a', day: '2026-10-04' },
      { id: 'b', day: '2026-10-04' },
      { id: 'c', day: '2026-10-11' },
    ]
    expect(groupByLocalDay(items, (i) => i.day)).toEqual([
      { key: '2026-10-04', items: [items[0], items[1]] },
      { key: '2026-10-11', items: [items[2]] },
    ])
  })

  // The list is sorted before it gets here, so a repeated key means the sort
  // broke — which should show up as two headings, not be silently merged.
  it('does not merge a day that comes back after another', () => {
    const items = [{ day: 'a' }, { day: 'b' }, { day: 'a' }]
    expect(groupByLocalDay(items, (i) => i.day).map((g) => g.key)).toEqual(['a', 'b', 'a'])
  })

  it('returns nothing for an empty list', () => {
    expect(groupByLocalDay([], () => '')).toEqual([])
  })
})
