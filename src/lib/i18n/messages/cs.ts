import type { PluralForms } from '@/lib/i18n/plural'

/**
 * Czech UI text.
 *
 * UI text is Czech; code, schema, comments and docs are English (CLAUDE.md).
 * Enum values stay stable internal codes and are mapped to labels here, so no
 * translated string is ever stored as business data (PRD §21).
 */
export const cs = {
  app: {
    name: 'Trainlio',
  },

  nav: {
    sessions: 'Tréninky',
    myBookings: 'Moje tréninky',
    myAthletes: 'Moji sportovci',
    account: 'Účet',
  },

  coachNav: {
    sessions: 'Tréninky',
    newSession: 'Vytvořit trénink',
    series: 'Série tréninků',
    athletes: 'Sportovci',
  },

  session: {
    allAthletes: 'Všichni sportovci',
    bookingClosed: 'Přihlašování uzavřeno',
    cancelled: 'ZRUŠENO TRENÉREM',
    changed: 'ZMĚNĚNO',
    book: 'Přihlásit',
    full: 'Trénink je plný.',
  },

  booking: {
    pickAthletes: 'Koho chcete přihlásit?',
    /** Atomic multi-athlete booking: all selected athletes or none (D-05). */
    submit: {
      one: 'Přihlásit {count} sportovce',
      few: 'Přihlásit {count} sportovce',
      many: 'Přihlásit {count} sportovců',
    } satisfies PluralForms,

    /**
     * Shown when the selection exceeds the remaining places. The server rejects
     * the whole request rather than booking a subset, so one confirmation never
     * splits siblings into booked and not-booked states.
     */
    insufficientCapacity: {
      one: 'Na tento trénink zbývá poslední volné místo. Vyberte prosím pouze jednoho sportovce.',
      few: 'Na tento trénink zbývají {count} volná místa. Vyberte prosím nejvýše {count} sportovce.',
      many: 'Na tento trénink zbývá {count} volných míst. Vyberte prosím nejvýše {count} sportovců.',
    } satisfies PluralForms,

    removedByCoach: 'Sportovce odebral trenér. Pro opětovné přihlášení kontaktujte trenéra.',
    sessionCancelled: 'Trénink byl zrušen.',
    acknowledge: 'Rozumím',
  },

  cancellation: {
    cancel: 'Odhlásit',
    tooLate: 'Odhlášení již není možné. Kontaktujte trenéra.',
  },

  myBookings: {
    upcoming: 'Nadcházející',
    past: 'Minulé',
  },

  athlete: {
    add: 'Přidat sportovce',
    firstName: 'Jméno',
    lastName: 'Příjmení',
    dateOfBirth: 'Datum narození',
    photo: 'Fotografie',
    club: 'Klub',
    team: 'Tým / kategorie',
    position: 'Pozice',
    stickSide: 'Hůl',
    jerseyNumber: 'Číslo dresu',
  },

  coach: {
    addAthlete: 'Přidat sportovce',
    removeAthlete: 'Odebrat',
    editSession: 'Upravit trénink',
    duplicate: 'Duplikovat',
    closeBooking: 'Zavřít přihlašování',
    cancelSession: 'Zrušit trénink',
    changingRoom: 'Šatna',
    publicNotes: 'Poznámka pro rodiče',
    internalNotes: 'Interní poznámka',
  },

  common: {
    cancel: 'Zrušit',
    saveAnyway: 'Přesto uložit',
    add: 'Přidat',
    save: 'Uložit',
  },
} as const

export type Messages = typeof cs
