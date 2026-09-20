import { describe, expect, it } from 'vitest'
import {
  composeNotificationEmail,
  isNotificationEventType,
  type ClaimedDelivery,
} from '@/lib/notifications/compose'

const APP = 'https://trainlio.example/moje-treninky'

function delivery(overrides: Partial<ClaimedDelivery> = {}): ClaimedDelivery {
  return {
    deliveryId: 'd-1',
    eventType: 'SESSION_CANCELLED',
    recipientEmail: 'rodina@example.test',
    session: {
      // 09:00 Prague on a summer date, so the zone is doing real work.
      startAt: '2026-10-04T07:00:00Z',
      endAt: '2026-10-04T08:00:00Z',
      facilityCode: 'MH',
      locationName: 'Příbram',
      changingRoom: 'Šatna 4',
      reason: null,
    },
    athleteNames: ['Ivan Kotov'],
    workspaceTimezone: 'Europe/Prague',
    ...overrides,
  }
}

describe('composing a notification', () => {
  it('addresses the delivery recipient', () => {
    const message = composeNotificationEmail(delivery(), APP)
    expect(message?.to).toBe('rodina@example.test')
  })

  it('names the session in the subject', () => {
    const message = composeNotificationEmail(delivery(), APP)
    expect(message?.subject).toBe('Zrušený trénink — 4. 10. 2026, 09:00–10:00')
  })

  // The workspace timezone, never the server's. A parent reading this in
  // another country must see the time the training starts at the rink.
  it('formats the time in the workspace zone, not UTC', () => {
    const message = composeNotificationEmail(delivery(), APP)
    expect(message?.text).toContain('09:00–10:00')
    expect(message?.text).not.toContain('07:00')
  })

  it('formats a winter date correctly too, across the offset change', () => {
    const message = composeNotificationEmail(
      delivery({
        session: { ...delivery().session, startAt: '2026-11-04T08:00:00Z', endAt: '2026-11-04T09:00:00Z' },
      }),
      APP,
    )
    // One hour later in UTC, the same 09:00 local: Prague moved to CET.
    expect(message?.subject).toContain('09:00–10:00')
  })

  it('states the venue with the changing room (BR-063)', () => {
    const message = composeNotificationEmail(delivery(), APP)
    expect(message?.text).toContain('Příbram · MH · Šatna 4')
  })

  it('omits an absent changing room rather than leaving a gap', () => {
    const message = composeNotificationEmail(
      delivery({ session: { ...delivery().session, changingRoom: null } }),
      APP,
    )
    expect(message?.text).toContain('Příbram · MH')
    expect(message?.text).not.toContain('· ·')
  })

  it('links to the app', () => {
    expect(composeNotificationEmail(delivery(), APP)?.text).toContain(APP)
  })

  it('sends both a text and an HTML part', () => {
    const message = composeNotificationEmail(delivery(), APP)
    expect(message?.text.length).toBeGreaterThan(0)
    expect(message?.html).toContain('<html lang="cs">')
  })
})

describe('one email, naming every affected child (AC-072, AC-073)', () => {
  it('lists both children of a guardian with two booked athletes', () => {
    const message = composeNotificationEmail(
      delivery({ athleteNames: ['Ivan Kotov', 'Tomáš Svoboda'] }),
      APP,
    )
    expect(message?.text).toContain('Přihlášení sportovci: Ivan Kotov, Tomáš Svoboda')
  })

  // Czech agreement changes the adjective and the noun with the count.
  it('uses the singular form for one child', () => {
    const message = composeNotificationEmail(delivery({ athleteNames: ['Ivan Kotov'] }), APP)
    expect(message?.text).toContain('Přihlášený sportovec: Ivan Kotov')
  })

  it('uses the many form beyond four', () => {
    const names = ['A A', 'B B', 'C C', 'D D', 'E E']
    const message = composeNotificationEmail(delivery({ athleteNames: names }), APP)
    expect(message?.text).toContain('Přihlášení sportovci: A A, B B, C C, D D, E E')
  })

  it('leaves the line out entirely when there is nobody to name', () => {
    const message = composeNotificationEmail(delivery({ athleteNames: [] }), APP)
    expect(message?.text).not.toContain('sportovec')
    expect(message?.text).not.toContain('{names}')
  })
})

describe('each event type gets its own message', () => {
  const cases = [
    ['SESSION_CANCELLED', 'byl zrušen'],
    ['SESSION_SCHEDULE_CHANGED', 'byl přesunut'],
    ['SESSION_LOCATION_CHANGED', 'jiném místě'],
    ['SESSION_FACILITY_CHANGED', 'jiné hale'],
    ['SESSION_MAIN_COACH_CHANGED', 'jiný trenér'],
    ['SESSION_ELIGIBILITY_NARROWED', 'rozsah ročníků'],
  ] as const

  for (const [eventType, fragment] of cases) {
    it(`${eventType} says what happened`, () => {
      const message = composeNotificationEmail(delivery({ eventType }), APP)
      expect(message?.text).toContain(fragment)
      // No template placeholder survives into a parent's inbox.
      expect(message?.text).not.toMatch(/\{[a-z_]+\}/)
      expect(message?.subject).not.toMatch(/\{[a-z_]+\}/)
    })
  }

  // The check constraint already restricts the column, so reaching this means a
  // migration added a type the composer does not know. Inventing a message for
  // it would send a parent something Trainlio cannot explain.
  it('refuses to invent a message for an unknown type', () => {
    expect(composeNotificationEmail(delivery({ eventType: 'SOMETHING_NEW' }), APP)).toBeNull()
    expect(isNotificationEventType('SOMETHING_NEW')).toBe(false)
    expect(isNotificationEventType('SESSION_CANCELLED')).toBe(true)
  })
})

describe('the cancellation reason', () => {
  it('is quoted when the coach gave one', () => {
    const message = composeNotificationEmail(
      delivery({ session: { ...delivery().session, reason: 'Porucha chlazení' } }),
      APP,
    )
    expect(message?.text).toContain('Důvod: Porucha chlazení')
  })

  it('leaves the line out when there is none', () => {
    expect(composeNotificationEmail(delivery(), APP)?.text).not.toContain('Důvod:')
  })

  it('leaves it out for a reason that is only whitespace', () => {
    const message = composeNotificationEmail(
      delivery({ session: { ...delivery().session, reason: '   ' } }),
      APP,
    )
    expect(message?.text).not.toContain('Důvod:')
  })

  // A coach types the reason, and it lands in an HTML document.
  it('escapes a reason that would otherwise be markup', () => {
    const message = composeNotificationEmail(
      delivery({ session: { ...delivery().session, reason: '<script>alert(1)</script>' } }),
      APP,
    )
    expect(message?.html).not.toContain('<script>')
    expect(message?.html).toContain('&lt;script&gt;')
  })

  it('escapes an athlete name containing markup characters', () => {
    const message = composeNotificationEmail(delivery({ athleteNames: ['A & B'] }), APP)
    expect(message?.html).toContain('A &amp; B')
    expect(message?.text).toContain('A & B')
  })
})

describe('a cancellation says the bookings are kept (BR-044, BR-070)', () => {
  it('tells the parent where to look', () => {
    const message = composeNotificationEmail(delivery({ eventType: 'SESSION_CANCELLED' }), APP)
    expect(message?.text).toContain('Přihlášky zůstávají v aplikaci k nahlédnutí.')
  })

  it('does not say it for an ordinary change', () => {
    const message = composeNotificationEmail(
      delivery({ eventType: 'SESSION_SCHEDULE_CHANGED' }),
      APP,
    )
    expect(message?.text).not.toContain('zůstávají v aplikaci')
  })
})
