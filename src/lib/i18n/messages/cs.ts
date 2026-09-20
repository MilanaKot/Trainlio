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

  auth: {
    signInTitle: 'Přihlášení',
    signInIntro: 'Zadejte e-mail. Pošleme vám přihlašovací kód.',
    email: 'E-mail',
    sendCode: 'Poslat kód',
    sending: 'Odesílám…',
    codeTitle: 'Zadejte kód',
    codeSentTo: 'Kód jsme poslali na {email}. Platí 10 minut.',
    code: 'Kód',
    verify: 'Přihlásit se',
    verifying: 'Přihlašuji…',
    resend: 'Poslat kód znovu',
    resendIn: 'Nový kód můžete poslat za {seconds} s',
    useAnotherEmail: 'Použít jiný e-mail',
    signOut: 'Odhlásit se',
    errors: {
      invalidEmail: 'Zadejte platný e-mail.',
      invalidCode: 'Kód musí mít 6 číslic.',
      wrongCode: 'Kód je neplatný nebo vypršel. Zkuste to znovu.',
      tooManyRequests: 'Příliš mnoho pokusů. Zkuste to prosím za chvíli.',
      generic: 'Přihlášení se nezdařilo. Zkuste to prosím znovu.',
    },
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
    listTitle: 'Tréninky',
    noSessions: 'Zatím nejsou vypsané žádné tréninky.',
    noSessionsHint: 'Jakmile trenér vypíše trénink, uvidíte ho zde.',
    allAthletes: 'Všichni sportovci',
    bookingClosed: 'Přihlašování uzavřeno',
    cancelled: 'ZRUŠENO TRENÉREM',
    changed: 'ZMĚNĚNO',
    book: 'Přihlásit',
    full: 'Trénink je plný.',
    alreadyBooked: 'Přihlášeno',
    booked: 'Přihlášeno',
    started: 'Trénink již začal',
  },

  myBookingsPage: {
    title: 'Moje tréninky',
    none: 'Zatím nemáte žádné přihlášky.',
    noneHint: 'Přihlaste sportovce v sekci Tréninky.',
    nonePast: 'Žádné minulé tréninky.',
    athlete: 'Sportovec',
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
    confirm: 'Přihlásit',
    booking: 'Přihlašuji…',
    noEligible: 'Žádný z vašich sportovců se na tento trénink nemůže přihlásit.',
    noEligibleHint: 'Zkontrolujte ročník a hokejový profil sportovce.',
    errors: {
      EMPTY_SELECTION: 'Vyberte alespoň jednoho sportovce.',
      DUPLICATE_ATHLETE_IN_REQUEST: 'Sportovec je ve výběru dvakrát.',
      SESSION_NOT_FOUND: 'Trénink nebyl nalezen.',
      SESSION_NOT_OPEN: 'Přihlašování na tento trénink je uzavřeno.',
      SESSION_ALREADY_STARTED: 'Trénink již začal.',
      SESSION_CANCELLED: 'Trénink byl zrušen.',
      ALREADY_BOOKED: 'Sportovec už je na tento trénink přihlášen.',
      REMOVED_BY_COACH: 'Sportovce odebral trenér. Pro opětovné přihlášení kontaktujte trenéra.',
      NOT_ELIGIBLE: 'Sportovec nesplňuje podmínky tohoto tréninku.',
      NOT_AUTHORIZED_FOR_ATHLETE: 'K tomuto sportovci nemáte přístup.',
      NOT_AUTHENTICATED: 'Nejste přihlášeni.',
      BOOKING_NOT_FOUND: 'Přihláška nebyla nalezena.',
      BOOKING_NOT_CONFIRMED: 'Přihláška už není aktivní.',
      CANCELLATION_DEADLINE_PASSED: 'Odhlášení již není možné. Kontaktujte trenéra.',
      generic: 'Akce se nezdařila. Zkuste to prosím znovu.',
    },
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
    listTitle: 'Moji sportovci',
    add: 'Přidat sportovce',
    addFirst: 'Zatím nemáte žádného sportovce.',
    addFirstHint: 'Přidejte sportovce, abyste ho mohli přihlašovat na tréninky.',
    newTitle: 'Nový sportovec',
    editTitle: 'Upravit sportovce',
    coreSection: 'Sportovec',
    hockeySection: 'Hokejový profil',
    firstName: 'Jméno',
    lastName: 'Příjmení',
    dateOfBirth: 'Datum narození',
    photo: 'Fotografie',
    photoAdd: 'Nahrát fotografii',
    photoReplace: 'Změnit fotografii',
    photoRemove: 'Odebrat fotografii',
    photoHint: 'JPG, PNG nebo WebP, maximálně 5 MB.',
    club: 'Klub',
    team: 'Tým / kategorie',
    position: 'Pozice',
    stickSide: 'Hůl',
    jerseyNumber: 'Číslo dresu',
    optional: 'nepovinné',
    birthYear: 'Ročník {year}',
    inactive: 'Neaktivní',
    deactivate: 'Deaktivovat sportovce',
    reactivate: 'Znovu aktivovat',
    /* D-09: says what deactivation does and, just as importantly, what it does not. */
    deactivateExplain:
      'Neaktivního sportovce nelze přihlásit na nové tréninky. Stávající přihlášky zůstávají zachovány a uvidíte je dál v Mých trénincích.',
    /* D-10: the privacy consequence of registering, stated before submitting. */
    workspaceNotice:
      'Vytvořením hokejového profilu zpřístupníte údaje sportovce trenérovi ve vybraném klubu. Bez toho není možné přihlašování na tréninky.',
    saved: 'Uloženo.',
    save: 'Uložit',
    saving: 'Ukládám…',
    errors: {
      FIRST_NAME_REQUIRED: 'Zadejte jméno.',
      LAST_NAME_REQUIRED: 'Zadejte příjmení.',
      NAME_TOO_LONG: 'Jméno je příliš dlouhé.',
      DATE_OF_BIRTH_REQUIRED: 'Zadejte datum narození.',
      DATE_OF_BIRTH_MALFORMED: 'Datum narození není platné.',
      DATE_OF_BIRTH_IN_FUTURE: 'Datum narození nemůže být v budoucnosti.',
      DATE_OF_BIRTH_TOO_EARLY: 'Datum narození není platné.',
      POSITION_REQUIRED: 'Vyberte pozici.',
      STICK_SIDE_REQUIRED: 'Vyberte stranu hole.',
      JERSEY_TOO_LONG: 'Číslo dresu je příliš dlouhé.',
      PHOTO_TOO_LARGE: 'Fotografie je větší než 5 MB.',
      PHOTO_TYPE_NOT_ALLOWED: 'Podporujeme JPG, PNG a WebP.',
      PHOTO_EMPTY: 'Soubor je prázdný.',
      NOT_AUTHENTICATED: 'Nejste přihlášeni.',
      NOT_AUTHORIZED_FOR_ATHLETE: 'K tomuto sportovci nemáte přístup.',
      SPORT_NOT_FOUND: 'Sport není k dispozici.',
      WORKSPACE_NOT_FOUND: 'Klub není k dispozici.',
      SPORT_NOT_IN_WORKSPACE: 'Vybraný klub tento sport nenabízí.',
      INVALID_SPORT_ATTRIBUTES: 'Zkontrolujte pozici a stranu hole.',
      INVALID_ATHLETE_DATA: 'Zkontrolujte zadané údaje.',
      INVALID_NAME: 'Zadejte jméno a příjmení.',
      INVALID_DATE_OF_BIRTH: 'Datum narození není platné.',
      SPORT_PROFILE_EXISTS: 'Sportovec už tento sportovní profil má.',
      NO_WORKSPACE: 'Není dostupný žádný klub.',
      generic: 'Uložení se nezdařilo. Zkuste to prosím znovu.',
    },
  },

  coach: {
    sessionsTitle: 'Tréninky',
    newSession: '+ Trénink',
    newSessionTitle: 'Nový trénink',
    editSessionTitle: 'Upravit trénink',
    duplicateTitle: 'Duplikovat trénink',
    detail: 'Detail',
    noSessions: 'Zatím žádné tréninky.',
    addAthlete: 'Přidat sportovce',
    removeAthlete: 'Odebrat',
    editSession: 'Upravit trénink',
    duplicate: 'Duplikovat',
    closeBooking: 'Zavřít přihlašování',
    openBooking: 'Otevřít přihlašování',
    cancelSession: 'Zrušit trénink',
    changingRoom: 'Šatna',
    publicNotes: 'Poznámka pro rodiče',
    publicNotesHint: 'Uvidí ji rodiče.',
    internalNotes: 'Interní poznámka',
    internalNotesHint: 'Vidíte jen vy a ostatní trenéři.',
    date: 'Datum',
    startTime: 'Začátek',
    endTime: 'Konec',
    facility: 'Hala',
    capacity: 'Kapacita',
    mainCoach: 'Hlavní trenér',
    eligibility: 'Kdo se může přihlásit',
    eligibilityAll: 'Všichni sportovci',
    eligibilityRange: 'Ročníky',
    birthYearFrom: 'Od ročníku',
    birthYearTo: 'Do ročníku',
    occupancy: '{confirmed} / {capacity}',
    rosterLater: 'Seznam přihlášených bude k dispozici v další fázi.',
    series: 'Série tréninků',
    newSeries: '+ Série',
    newSeriesTitle: 'Nová série tréninků',
    noSeries: 'Zatím žádné série.',
    weekday: 'Den v týdnu',
    dateFrom: 'Od data',
    dateTo: 'Do data',
    preview: 'Náhled termínů',
    previewEmpty: 'Zadanému nastavení neodpovídá žádný termín.',
    previewCount: {
      one: 'Vytvoří se {count} trénink',
      few: 'Vytvoří se {count} tréninky',
      many: 'Vytvoří se {count} tréninků',
    },
    createSeries: 'Vytvořit sérii',
    seriesGenerated: {
      one: '{count} trénink',
      few: '{count} tréninky',
      many: '{count} tréninků',
    },
    seriesIndependent:
      'Každý trénink je po vytvoření samostatný. Úprava nebo zrušení jednoho termínu neovlivní ostatní.',
    generatedIn: 'Vygenerováno v časovém pásmu {timezone}',
    weekdays: {
      '1': 'Pondělí',
      '2': 'Úterý',
      '3': 'Středa',
      '4': 'Čtvrtek',
      '5': 'Pátek',
      '6': 'Sobota',
      '7': 'Neděle',
    },
    /* AC-051 / UI_SPEC: the server refuses this without confirmation. */
    capacityWarningTitle: 'Snížení kapacity',
    capacityWarning:
      'Na tento trénink je již přihlášeno {confirmed} sportovců. Nová kapacita je {capacity}. Stávající přihlášky zůstanou zachovány.',
    /* D-08: narrowing eligibility past athletes who are already booked. */
    eligibilityWarningTitle: 'Změna ročníků',
    eligibilityWarning:
      'Novému rozsahu ročníků neodpovídá {count} již přihlášených sportovců. Jejich přihlášky zůstanou platné a jejich rodiče dostanou e-mail.',
    saveAnyway: 'Přesto uložit',
    /* D-07: cancellation is terminal, so the confirmation says so. */
    cancelWarningTitle: 'Zrušit trénink',
    cancelWarning:
      'Trénink bude zrušen a nelze jej znovu otevřít. Rodiče přihlášených sportovců dostanou e-mail. Pro náhradní termín použijte Duplikovat.',
    cancelConfirm: 'Zrušit trénink',
    cancelledNotice: 'Trénink je zrušen. Nelze jej upravit ani znovu otevřít.',
    reasonOptional: 'Důvod (nepovinné)',
    errors: {
      NOT_AUTHENTICATED: 'Nejste přihlášeni.',
      NOT_AUTHORIZED: 'Nemáte oprávnění.',
      SESSION_NOT_FOUND: 'Trénink nebyl nalezen.',
      SESSION_CANCELLED: 'Trénink je zrušen a nelze jej změnit.',
      FACILITY_NOT_IN_WORKSPACE: 'Vybraná hala není k dispozici.',
      INVALID_TIME_RANGE: 'Konec musí být po začátku.',
      INVALID_SESSION_DATA: 'Zkontrolujte zadané údaje.',
      INVALID_SESSION_STATUS: 'Neplatný stav tréninku.',
      COACH_NOT_WORKSPACE_STAFF: 'Vybraný trenér nepatří do tohoto klubu.',
      INVALID_BIRTH_YEAR_RANGE: 'Zkontrolujte rozsah ročníků.',
      SERIES_EMPTY: 'Zadanému nastavení neodpovídá žádný termín.',
      INVALID_WEEKDAY: 'Vyberte den v týdnu.',
      INVALID_DATE_RANGE: 'Datum do musí být po datu od.',
      generic: 'Uložení se nezdařilo. Zkuste to prosím znovu.',
    },
  },

  account: {
    title: 'Účet',
    displayName: 'Jméno',
    displayNameHint: 'Jak vás uvidí trenér.',
  },

  placeholder: {
    comingSoon: 'Tato část bude k dispozici brzy.',
  },

  common: {
    cancel: 'Zrušit',
    back: 'Zpět',
    saveAnyway: 'Přesto uložit',
    add: 'Přidat',
    save: 'Uložit',
  },
} as const

export type Messages = typeof cs
