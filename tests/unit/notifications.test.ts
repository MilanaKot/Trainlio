import { describe, expect, it } from 'vitest'
import {
  composeNotificationEmail,
  isNotificationEventType,
  type ClaimedDelivery,
} from '@/lib/notifications/compose'

/**
 * The e-mails, against `docs/design/shared/EMAILS.md`.
 *
 * The composer is pure, so every template is assertable as a string: the
 * subject a parent sees in their inbox, the rows of the detail block, the value
 * that was and the value that is. What a browser cannot be asked here — that
 * Outlook renders it — is why the layout is tables and the fonts are Arial,
 * which §1 fixed and the structural cases below hold in place.
 */

const APP = 'https://trainlio.example'

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
      facilityName: 'Malá hala',
      locationName: 'Příbram',
      changingRoom: 'Šatna 4',
      reason: null,
      deadlineHours: 12,
      mainCoachName: 'Milan Filipi',
    },
    athleteNames: ['Ivan Kotov'],
    bookingIds: ['b-1'],
    workspaceTimezone: 'Europe/Prague',
    workspaceName: 'Hokejová škola Příbram',
    ...overrides,
  }
}

/** Throws rather than letting `?.text` pass a negative assertion on nothing. */
function composed(input: ClaimedDelivery) {
  const message = composeNotificationEmail(input, APP)
  if (message === null) throw new Error('a known event type must produce an email')
  return message
}

describe('composing a notification (AC-283)', () => {
  it('addresses the delivery recipient', () => {
    expect(composed(delivery()).to).toBe('rodina@example.test')
  })

  // §1: the date is always in the subject, because a parent searching their
  // inbox searches for the training.
  it('puts the training in the subject', () => {
    expect(composed(delivery()).subject).toBe('Zrušeno: trénink ne 4. 10. v 09:00')
  })

  // The workspace timezone, never the server's. A parent reading this in
  // another country must see the time the training starts at the rink.
  it('formats the time in the workspace zone, not UTC', () => {
    const message = composed(delivery())
    expect(message.text).toContain('09:00–10:00')
    expect(message.text).not.toContain('07:00')
  })

  it('formats a winter date correctly too, across the offset change', () => {
    const message = composed(
      delivery({
        session: {
          ...delivery().session,
          startAt: '2026-11-04T08:00:00Z',
          endAt: '2026-11-04T09:00:00Z',
        },
      }),
    )
    // One hour later in UTC, the same 09:00 local: Prague moved to CET.
    expect(message.subject).toContain('09:00')
    expect(message.text).toContain('09:00–10:00')
  })

  it('states the venue with the changing room (BR-063)', () => {
    expect(composed(delivery()).text).toContain('Příbram · Malá hala (MH) · Šatna 4')
  })

  it('omits an absent changing room rather than leaving a gap', () => {
    const message = composed(delivery({ session: { ...delivery().session, changingRoom: null } }))
    expect(message.text).toContain('Příbram · Malá hala (MH)')
    expect(message.text).not.toContain('· ·')
  })

  it('sends both a text and an HTML part, and no placeholder survives either', () => {
    const message = composed(delivery())
    expect(message.text.length).toBeGreaterThan(0)
    expect(message.html).toContain('<html lang="cs">')
    expect(message.text).not.toMatch(/\{[a-z_]+\}/i)
    expect(message.html).not.toMatch(/\{[a-z_]+\}/i)
    expect(message.subject).not.toMatch(/\{[a-z_]+\}/i)
  })

  // The check constraint already restricts the column, so reaching this means a
  // migration added a type the composer does not know. Inventing a message for
  // it would send a parent something Trainlio cannot explain.
  it('refuses to invent a message for an unknown type', () => {
    expect(composeNotificationEmail(delivery({ eventType: 'SOMETHING_NEW' }), APP)).toBeNull()
    expect(isNotificationEventType('SOMETHING_NEW')).toBe(false)
    expect(isNotificationEventType('SESSION_CHANGED')).toBe(true)
  })
})

/**
 * §1 again, as structure rather than as copy: these are the properties that
 * decide whether the message arrives readable in a client nobody chose.
 */
describe('the layout survives a mail client (AC-283)', () => {
  const html = () => composed(delivery()).html

  it('is tables and inline styles, with no stylesheet to strip', () => {
    expect(html()).not.toContain('<style')
    expect(html()).not.toContain('class=')
    expect(html()).toContain('<table role="presentation"')
  })

  it('asks for Arial and no web font', () => {
    expect(html()).toContain('Arial, Helvetica, sans-serif')
    expect(html()).not.toContain('fonts.googleapis')
    expect(html()).not.toContain('Barlow')
  })

  it('draws the card at 520 px', () => {
    expect(html()).toContain('width="520"')
  })

  // Never an image: a button a client refuses to load is a dead end.
  it('makes the button a real link', () => {
    expect(html()).toContain(`href="${APP}/treninky"`)
    expect(html()).toContain('Zobrazit další tréninky')
  })

  // What a mail list shows under the subject. Blank would show the markup.
  it('carries a preheader, which is the first sentence', () => {
    expect(html()).toContain('Trenér zrušil trénink')
  })
})

describe('one email, naming every affected child (AC-072, AC-073)', () => {
  it('lists both children of a guardian with two booked athletes', () => {
    const message = composed(delivery({ athleteNames: ['Ivan Kotov', 'Anna Kotova'] }))
    expect(message.text).toContain('Sportovci: Ivan Kotov, Anna Kotova')
    // §1: the subject does not change with the count.
    expect(message.subject).toBe('Zrušeno: trénink ne 4. 10. v 09:00')
  })

  // Czech agreement changes the noun with the count.
  it('uses the singular label for one child', () => {
    expect(composed(delivery()).text).toContain('Sportovec: Ivan Kotov')
  })

  it('leaves the row out entirely when there is nobody to name', () => {
    const message = composed(delivery({ athleteNames: [] }))
    expect(message.text).not.toContain('Sportovec:')
    expect(message.text).not.toContain('Sportovci:')
  })

  // Two children share the list; one child has a screen of their own (§G6).
  it('links to the booking when there is exactly one', () => {
    const message = composed(delivery({ eventType: 'BOOKING_ADDED_BY_COACH' }))
    expect(message.text).toContain(`${APP}/moje-treninky/b-1`)
  })

  it('and to the list when there are two', () => {
    const message = composed(
      delivery({
        eventType: 'BOOKING_ADDED_BY_COACH',
        athleteNames: ['Ivan Kotov', 'Anna Kotova'],
        bookingIds: ['b-1', 'b-2'],
      }),
    )
    expect(message.text).toContain(`${APP}/moje-treninky\n`)
  })
})

describe('E01 · a cancelled training', () => {
  it('says it is off and that nothing is expected of the parent', () => {
    const message = composed(delivery())
    expect(message.text).toContain('Trénink byl zrušen')
    expect(message.text).toContain('nic dalšího dělat nemusíte')
  })

  // The time no longer applies, and says so in print rather than in colour.
  it('strikes the time through', () => {
    expect(composed(delivery()).html).toContain('text-decoration:line-through')
  })

  it('sends the parent to the other trainings, not to a booking that is gone', () => {
    expect(composed(delivery()).text).toContain(`${APP}/treninky`)
  })
})

describe('E02 · the training moved', () => {
  const moved = (fields: string[], previous: Record<string, string>) =>
    delivery({
      eventType: 'SESSION_SCHEDULE_CHANGED',
      session: {
        ...delivery().session,
        startAt: '2026-10-04T15:30:00Z',
        endAt: '2026-10-04T16:30:00Z',
        change: { fields, previous },
      },
    })

  it('prints the new time and the old one under it', () => {
    const message = composed(
      moved(['TIME'], { start_at: '2026-10-04T15:00:00Z', end_at: '2026-10-04T16:00:00Z' }),
    )
    expect(message.subject).toBe('Změna času: trénink ne 4. 10. — nově 17:30')
    expect(message.text).toContain('Kdy: Neděle 4. října · 17:30–18:30 (dříve 17:00–18:00)')
    expect(message.html).toContain('17:30–18:30')
    expect(message.html).toContain('17:00–18:00')
  })

  // A training an hour later and a training the next day are not the same news,
  // so the same event says two different things (§E02).
  it('says a different day differently', () => {
    const message = composed(
      moved(['DATE'], { start_at: '2026-10-03T15:30:00Z', end_at: '2026-10-03T16:30:00Z' }),
    )
    expect(message.subject).toBe('Změna termínu: trénink so 3. 10. — nově ne 4. 10.')
    expect(message.text).toContain('Trénink je v jiný den')
  })

  it('prints the deadline and what it is for', () => {
    const message = composed(
      moved(['TIME'], { start_at: '2026-10-04T15:00:00Z', end_at: '2026-10-04T16:00:00Z' }),
    )
    // 17:30 on Sunday, minus the workspace's twelve hours.
    expect(message.text).toContain('Odhlásit lze: do ne 4. 10. v 05:30')
    expect(message.text).toContain('Nový čas vám nevyhovuje?')
  })
})

describe('E03, E04, E05 · place, hall, coach', () => {
  it('E03 names the place that was', () => {
    const message = composed(
      delivery({
        eventType: 'SESSION_LOCATION_CHANGED',
        session: {
          ...delivery().session,
          change: { fields: ['LOCATION'], previous: { location_name: 'Dobříš' } },
        },
      }),
    )
    expect(message.subject).toBe('Změna místa: trénink ne 4. 10.')
    expect(message.text).toContain('Trénink bude jinde')
    expect(message.text).toContain('(dříve Dobříš · Malá hala (MH))')
  })

  // The hall declines: `do Malé haly`, not `do Malá hala`.
  it('E04 puts the hall in the right case and keeps the changing room with it', () => {
    const message = composed(
      delivery({
        eventType: 'SESSION_FACILITY_CHANGED',
        session: {
          ...delivery().session,
          change: {
            fields: ['FACILITY'],
            previous: { facility_code: 'VH', facility_name: 'Velká hala' },
          },
        },
      }),
    )
    expect(message.subject).toBe('Změna haly: trénink ne 4. 10. — Malá hala')
    expect(message.text).toContain('Trénink se přesouvá do Malé haly')
    expect(message.text).toContain('Hala: Malá hala (MH) · Šatna 4 (dříve Velká hala (VH))')
  })

  it('E04 falls back to a sentence that needs no case for an unknown hall', () => {
    const message = composed(
      delivery({
        eventType: 'SESSION_FACILITY_CHANGED',
        session: { ...delivery().session, facilityName: 'Hala u lesa' },
      }),
    )
    expect(message.text).toContain('Trénink se přesouvá do jiné haly')
  })

  it('E05 names both coaches — the one who takes over and the one who did it', () => {
    const message = composed(
      delivery({
        eventType: 'SESSION_MAIN_COACH_CHANGED',
        session: {
          ...delivery().session,
          mainCoachName: 'Jan Novák',
          change: { fields: ['MAIN_COACH'], previous: { main_coach_name: 'Milan Filipi' } },
        },
      }),
    )
    expect(message.subject).toBe('Jiný trenér: trénink ne 4. 10.')
    expect(message.text).toContain('Hlavní trenér: Jan Novák (dříve Milan Filipi)')
  })
})

describe('SESSION_CHANGED · two things in one save', () => {
  const both = composed(
    delivery({
      eventType: 'SESSION_CHANGED',
      session: {
        ...delivery().session,
        startAt: '2026-10-04T15:30:00Z',
        endAt: '2026-10-04T16:30:00Z',
        change: {
          fields: ['TIME', 'FACILITY'],
          previous: {
            start_at: '2026-10-04T15:00:00Z',
            end_at: '2026-10-04T16:00:00Z',
            facility_code: 'VH',
            facility_name: 'Velká hala',
          },
        },
      },
    }),
  )

  // One e-mail, not two a minute apart (§2).
  it('says the training changed and highlights every row that did', () => {
    expect(both.subject).toBe('Změna tréninku: trénink ne 4. 10.')
    expect(both.text).toContain('Trénink se změnil')
    expect(both.text).toContain('17:30–18:30 (dříve 17:00–18:00)')
    expect(both.text).toContain('(dříve Příbram · Velká hala (VH))')
  })

  it('and still says until when the parent can undo it', () => {
    expect(both.text).toContain('Odhlásit lze: do ne 4. 10. v 05:30')
  })
})

describe('E06 · the years narrowed (D-08)', () => {
  const narrowed = composed(
    delivery({
      eventType: 'SESSION_ELIGIBILITY_NARROWED',
      session: {
        ...delivery().session,
        birthYearFrom: 2017,
        birthYearTo: 2017,
        previousBirthYearFrom: 2017,
        previousBirthYearTo: 2018,
      },
    }),
  )

  it('says the booking is cancelled and prints both ranges', () => {
    expect(narrowed.subject).toBe('Odhlášení z tréninku ne 4. 10. — změna ročníků')
    expect(narrowed.text).toContain('Sportovec byl z tréninku odhlášen')
    expect(narrowed.text).toContain('Ročníky: 2017–2017 (dříve 2017–2018)')
  })

  it('offers another training rather than the booking that no longer exists', () => {
    expect(narrowed.text).toContain('Najít jiný trénink')
    expect(narrowed.text).toContain(`${APP}/treninky`)
  })
})

describe('E07 · a coach removed one child (§G4b, D-06)', () => {
  const removed = (overrides: Partial<ClaimedDelivery['session']> = {}) =>
    composed(
      delivery({
        eventType: 'BOOKING_REMOVED_BY_COACH',
        session: {
          ...delivery().session,
          reason: 'Dnes trénují jen brankáři.',
          coachName: 'Milan Filipi',
          coachPhone: '777654321',
          ...overrides,
        },
      }),
    )

  it('says the training still happens, which is the whole difference', () => {
    const message = removed()
    expect(message.subject).toBe('Odhlášení z tréninku ne 4. 10. v 09:00')
    expect(message.text).toContain('Trénink se koná')
    expect(message.text).not.toContain('byl zrušen')
  })

  it('says who can put the child back, since the parent cannot', () => {
    expect(removed().text).toContain('Znovu ho přihlásit může jen trenér')
  })

  // Decision 28: the e-mail is the second of exactly two places a parent is
  // given the coach's number.
  it('gives the coach and their number', () => {
    expect(removed().text).toContain('Trenér: Milan Filipi · 777654321')
  })

  it('names the coach alone when they gave no number', () => {
    const message = removed({ coachPhone: null })
    expect(message.text).toContain('Trenér: Milan Filipi')
    expect(message.text).not.toContain(' · 777')
  })

  it("introduces the coach's words as a message", () => {
    expect(removed().text).toContain('Zpráva od trenéra: Dnes trénují jen brankáři.')
  })

  it('carries no message when the coach wrote none', () => {
    const message = removed({ reason: null })
    expect(message.text).not.toContain('Zpráva od trenéra')
    expect(message.text).toContain('Trénink se koná')
  })
})

describe('E08 · the coach booked the child (DR-12, AC-284)', () => {
  const added = composed(
    delivery({
      eventType: 'BOOKING_ADDED_BY_COACH',
      session: { ...delivery().session, coachName: 'Milan Filipi' },
    }),
  )

  it('says who booked them and where to find it', () => {
    expect(added.subject).toBe('Přihláška na trénink ne 4. 10. v 09:00')
    expect(added.text).toContain('Milan Filipi přihlásil sportovce na trénink')
    expect(added.text).toContain('Moje tréninky')
  })

  // The place is worth something to another family if this one cannot come.
  it('prints the deadline and says why it matters', () => {
    // 09:00 on Sunday, minus twelve hours: the evening before.
    expect(added.text).toContain('Odhlásit lze: do so 3. 10. v 21:00')
    expect(added.text).toContain('ať místo může dostat někdo jiný')
  })

  it('is the blue label, not an orange one: nothing went wrong', () => {
    expect(added.html).toContain('#E5EBFD')
    expect(added.text).not.toContain('Změna')
  })
})

describe('what a coach types ends up in an HTML document', () => {
  it('escapes a message that would otherwise be markup', () => {
    const message = composed(
      delivery({ session: { ...delivery().session, reason: '<script>alert(1)</script>' } }),
    )
    expect(message.html).not.toContain('<script>')
    expect(message.html).toContain('&lt;script&gt;')
  })

  it('escapes an athlete name containing markup characters', () => {
    const message = composed(delivery({ athleteNames: ['A & B'] }))
    expect(message.html).toContain('A &amp; B')
    expect(message.text).toContain('A & B')
  })
})

describe('the club mark in the message (AC-277)', () => {
  const marked = () =>
    delivery({
      workspaceName: 'Příbram — hokejový trénink',
      workspaceLogoUrl: 'https://x.supabase.co/storage/v1/object/public/workspace-logos/a/b.png',
    })

  it('is an image whose alternative text is the club', () => {
    const html = composed(marked()).html
    expect(html).toContain(
      'src="https://x.supabase.co/storage/v1/object/public/workspace-logos/a/b.png"',
    )
    expect(html).toContain('alt="Příbram — hokejový trénink"')
  })

  // Most mail clients refuse remote images until the reader asks. The message
  // has to be whole without it, so nothing it says lives inside the picture.
  it('carries nothing the message needs', () => {
    const withMark = composed(marked())
    const without = composed(delivery({ workspaceName: 'Příbram — hokejový trénink' }))
    expect(withMark.text).toBe(without.text)
    expect(withMark.subject).toBe(without.subject)
  })

  // No monogram in an e-mail: two cobalt letters mean something in an
  // interface that explains them and nothing at the top of a message.
  it('writes the club’s name out for a club with no mark', () => {
    const html = composed(delivery({ workspaceName: 'Hokejová škola Příbram' })).html
    expect(html).not.toContain('<img')
    expect(html).toContain('Hokejová škola Příbram')
  })

  it('names the club in the footer, which is why the parent got this', () => {
    expect(composed(delivery()).text).toContain(
      'Tento e-mail jste dostali, protože máte sportovce přihlášeného na trénink v aplikaci Hokejová škola Příbram.',
    )
  })
})
