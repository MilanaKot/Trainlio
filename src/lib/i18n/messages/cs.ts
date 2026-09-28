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
    signInIntro: 'Zadejte svůj e-mail. Pošleme vám jednorázový kód, heslo nepotřebujete.',
    /* Under the club's name on G11: what this application is, for a parent who
       followed a link and has never seen it before. */
    signInPurpose: 'Rezervace tréninků',
    /* The footer of G11. The club is the name at the top; this says whose
       software it is, quietly, at the bottom. */
    poweredBy: 'Běží na',
    email: 'E-mail',
    emailPlaceholder: 'jmeno@email.cz',
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
    /* The landmark's own name, not one of its items. */
    label: 'Hlavní navigace',
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
    more: 'Více',
  },

  /* A0 (admin/SPEC.md §A0): the coach's own screen — who they are, what they
     administer, and the way out of the application. */
  more: {
    title: 'Více',
    roleCoach: 'Trenér',
    roleAdmin: 'Trenér · Administrátor',
    manageCaption: 'SPRÁVA',
    accountCaption: 'ÚČET',
    organization: 'Organizace',
    organizationValue: 'Logo a název',
    coaches: 'Trenéři',
    personalDetails: 'Osobní údaje a e-mail',
    /* The full sentence is required: `Odhlásit` on its own means cancelling a
       training, which is the last thing a coach should read here. */
    signOut: 'Odhlásit se z aplikace',
    signOutTitle: 'Odhlásit se z aplikace?',
    signOutConfirm: 'Odhlásit se',
  },

  /**
   * Keyed by `sports.code`. One workspace and one sport in MVP, but the header
   * still reads the code from data rather than assuming hockey (principle 6).
   */
  sports: {
    HOCKEY: 'Lední hokej',
  },

  session: {
    listTitle: 'Tréninky',
    noSessions: 'Momentálně nejsou vypsané žádné tréninky.',
    noSessionsHint: 'Jakmile trenér vypíše trénink, uvidíte ho zde.',
    /* guardian/SPEC.md §G1: shown above the list, not instead of it. */
    noAthletes: 'Přidejte prvního sportovce a můžete začít rezervovat tréninky.',
    addAthlete: 'Přidat sportovce',
    allAthletes: 'Všichni sportovci',
    /* On a guardian's card the range needs naming; in the coach's detail list
       the row is already labelled `Ročníky`, so the label lives here. */
    years: 'Ročníky',
    /* The chip on a date heading. */
    today: 'Dnes',
    tomorrow: 'Zítra',
    bookingClosed: 'Přihlašování uzavřeno',
    /* The footer button when every place is taken. */
    occupied: 'Obsazeno',
    lastPlaces: {
      one: 'Zbývá {count} místo',
      few: 'Zbývají {count} místa',
      many: 'Zbývá {count} míst',
    } satisfies PluralForms,
    noEligibleYears: 'Žádný z vašich sportovců nesplňuje ročníky',
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

  /** "Moje tréninky" (guardian/SPEC.md §G4, §G4b, §G5, §G6). */
  myTrainings: {
    title: 'Moje tréninky',
    tabs: 'Nadcházející nebo minulé tréninky',
    upcoming: 'Nadcházející',
    past: 'Minulé',
    noneUpcoming: 'Zatím nemáte žádný nadcházející trénink.',
    nonePast: 'Zatím nemáte žádný absolvovaný trénink.',
    findTraining: 'Najít trénink',
    /* Badges. Each says who acted, because "Zrušeno" alone reads as the
       parent's own doing when it was the coach's, and the reverse. */
    badgeChanged: 'Změněno',
    badgeRemoved: 'Odhlášeno trenérem',
    badgeSessionCancelled: 'Zrušeno trenérem',
    badgeSelfCancelled: 'Odhlášeno',
    /* Masculine participle for everyone: the product does not collect gender
       and will not guess it from a name (DESIGN_SYSTEM §8). */
    cancelledBy: 'Odhlásil {name} · {when}',
    sessionDidNotHappen: 'Trénink se nekonal · {place}',
    rebookContactCoach: 'Pro opětovné přihlášení kontaktujte trenéra.',
    previously: 'Původně {value}',
    changedOn: 'Změněno {when}',
    /* §G6: the notice above the detail list. */
    coachChanged: {
      DATE: 'Trenér změnil datum tréninku',
      TIME: 'Trenér změnil čas tréninku',
      LOCATION: 'Trenér změnil místo tréninku',
      FACILITY: 'Trenér změnil halu',
      MAIN_COACH: 'Trenér změnil hlavního trenéra',
      SEVERAL: 'Trenér změnil trénink',
    },
    changeLine: 'Původně {previous}, nově {current}.',
    back: 'Moje tréninky',
    place: 'Místo',
    changingRoom: 'Šatna',
    years: 'Ročníky',
    mainCoach: 'Hlavní trenér',
    assistants: 'Asistenti',
    occupancy: 'Obsazenost',
    athleteInfo: 'INFORMACE PRO SPORTOVCE',
    coachMessage: 'Zpráva od trenéra',
    none: '—',
  },

  booking: {
    pickAthletes: 'Koho chcete přihlásit?',
    /* guardian/SPEC.md §G2 summary box. */
    freePlaces: {
      one: '{count} volné místo',
      few: '{count} volná místa',
      many: '{count} volných míst',
    } satisfies PluralForms,
    alreadyBookedMeta: 'Už přihlášen',
    outsideYears: 'mimo ročníky {from}–{to}',
    removedByCoachShort: 'Odhlášen trenérem',
    notEligibleShort: 'Nelze přihlásit',
    cancelUntil: 'Odhlásit lze do {deadline}',
    booked: 'Přihlášeno',
    /* G3 — a normal state, not an error, so it is warning rather than danger. */
    notEnoughTitle: 'Není dostatek volných míst',
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
    until: 'Odhlásit lze do {deadline}',
    /* §G4: the confirmation names the child and the training, because a
       parent with several bookings is one tap from withdrawing the wrong one. */
    confirmTitle: 'Odhlásit {name}?',
    keep: 'Ponechat',
    done: 'Odhlášeno',
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
      PHONE_FORMAT: 'Telefonní číslo není platné. Zkuste například 777 123 456.',
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
    /* K1: the list is chronological, and the past is a link at the bottom
       rather than a second section nobody scrolls past. */
    pastSessions: 'Minulé tréninky',
    upcomingSessions: 'Nadcházející tréninky',
    noPastSessions: 'Zatím žádné minulé tréninky.',
    noSessionsAction: 'Vytvořit trénink',
    /* K10, the sheet behind the FAB. */
    create: 'Vytvořit',
    createSingle: 'Trénink',
    createSingleHint: 'Jeden termín',
    /* Named for the sheet row, not for the submit button below, which already
       says `Vytvořit sérii`. */
    createSeriesOption: 'Série tréninků',
    createSeriesHint: 'Opakovaně, např. každou neděli',
    draft: 'Koncept',
    cancelledBadge: 'Zrušeno',
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
    /* §K1: the coach row already carries the hall and the changing room, so
       the third field is `Všichni` rather than the whole sentence. */
    eligibilityAllShort: 'Všichni',
    eligibilityRange: 'Ročníky',
    birthYearFrom: 'Od ročníku',
    birthYearTo: 'Do ročníku',
    occupancy: '{confirmed} / {capacity}',
    /* K2, the session detail. */
    backToList: 'Tréninky',
    occupancyCaption: 'OBSAZENOST',
    assistants: 'Asistenti',
    publicNoteCaption: 'INFORMACE PRO SPORTOVCE · VIDÍ RODIČE',
    internalNoteCaption: 'INTERNÍ POZNÁMKA · JEN TRENÉŘI',
    actionsCaption: 'AKCE',
    none: '—',
    /* K7, the add-athlete sheet. */
    addAthleteTitle: 'Přidat sportovce',
    searchPlaceholder: 'Hledat jméno',
    addAthleteHint: 'Sportovci, kteří ještě nejsou přihlášení',
    addAthleteHintYears: 'Sportovci z ročníků {years}, kteří ještě nejsou přihlášení',
    addAthleteEmpty: 'Nikdo další se na tento trénink přihlásit nemůže.',
    addAthleteNoMatch: 'Tomuto hledání nikdo neodpovídá.',
    addCount: {
      one: 'Přidat {count} sportovce',
      few: 'Přidat {count} sportovce',
      many: 'Přidat {count} sportovců',
    } satisfies PluralForms,
    added: 'Přidáno',
    guardianLabel: 'Rodič: {name}',
    /* K7b, the capacity override. It is allowed (BR-033), so it asks rather
       than refuses — but it says what the consequence is. */
    overCapacityTitle: 'Trénink je již plný',
    overCapacityQuestion: 'Chcete sportovce přidat nad stanovenou kapacitu?',
    overCapacityHelp:
      'Kapacita se nezmění. Trénink bude mít {total} sportovců a rodiče se dál přihlásit nemohou.',
    overCapacityConfirm: 'Přidat',
    /* K7 athlete sheet, and the removal that follows from it. */
    parent: 'Rodič',
    phone: 'Telefon',
    /* While the contact is being fetched. A dash here would read as "this
       child has no parent on record", which is a different fact. */
    loadingValue: 'Načítám…',
    bookedAtLabel: 'Přihlášeno',
    call: 'Zavolat {phone}',
    sendSms: 'Poslat SMS',
    removeFromSession: 'Odhlásit z tréninku',
    removeTitle: 'Odhlásit sportovce z tréninku?',
    removeMessage: 'Zpráva pro rodiče',
    removeMessageHint: 'Nepovinné',
    removeInfo:
      'Rodič dostane e-mail. Sportovce bude moci znovu přihlásit, pokud bude volné místo.',
    removeConfirm: 'Odhlásit',
    keep: 'Ponechat',
    removed: 'Sportovec odhlášen',
    /* K5, closing registration. Reversible, and the sheet says so. */
    closeTitle: 'Zavřít přihlašování?',
    closeConsequenceNoNew: 'Noví sportovci se už nebudou moci přihlásit.',
    closeConsequenceKeep: {
      one: '{count} přihlášený sportovec zůstane.',
      few: '{count} přihlášení sportovci zůstanou.',
      many: '{count} přihlášených sportovců zůstane.',
    } satisfies PluralForms,
    closeConsequenceManual: 'Vy můžete sportovce dál přidávat ručně.',
    closeConsequenceReopen: 'Přihlašování můžete kdykoli znovu otevřít v detailu tréninku.',
    closeConfirm: 'Zavřít přihlašování',
    closeKeepOpen: 'Nechat otevřené',
    closed: 'Přihlašování uzavřeno',
    reopened: 'Přihlašování znovu otevřeno',
    /* K6, cancelling. Terminal (D-07), and the dialog says that too. */
    cancelTitle: 'Zrušit trénink?',
    cancelBody: 'Trénink zůstane v historii a všichni rodiče přihlášených sportovců obdrží e-mail.',
    cancelEmailCount: {
      one: 'E-mail dostane rodič {count} sportovce',
      few: 'E-mail dostanou rodiče {count} sportovců',
      many: 'E-mail dostanou rodiče {count} sportovců',
    } satisfies PluralForms,
    cancelTerminal: 'Zrušený trénink už nelze znovu otevřít',
    cancelKeep: 'Nezrušovat',
    cancelConfirmButton: 'Zrušit trénink',
    cancelled: 'Trénink zrušen',
    /* K6b, the cancelled state. */
    cancelledCaption: 'ZRUŠENO TRENÉREM',
    cancelledBy: 'Zrušil {name} · {when}.',
    cancelledEmailed: {
      one: 'Rodič {count} sportovce dostal e-mail.',
      few: 'Rodiče {count} sportovců dostali e-mail.',
      many: 'Rodiče {count} sportovců dostali e-mail.',
    } satisfies PluralForms,
    wereBooked: {
      one: 'Byl přihlášen {count}',
      few: 'Byli přihlášeni {count}',
      many: 'Bylo přihlášeno {count}',
    } satisfies PluralForms,
    duplicateAsNew: 'Duplikovat jako nový trénink',
    /* The roster (UI_SPEC, BR-092, AC-090). */
    rosterTitle: 'Sportovci {count}',
    roster: 'Přihlášení sportovci',
    rosterEmpty: 'Zatím není přihlášen nikdo.',
    rosterRemoved: 'Odebraní a odhlášení',
    /* Masculine participle for everyone (DESIGN_SYSTEM §8, decision 17): the
       product does not collect gender and will not guess it from a name, and
       `Přihlásil(a)` reads as a form rather than as a sentence. */
    bookedBy: 'Přihlásil {name}',
    bookedByCoach: 'Přidal trenér {name}',
    bookedAt: '{date} v {time}',
    overCapacityBadge: 'Nad kapacitu',
    removedByCoachBadge: 'Odebral trenér',
    cancelledByUserBadge: 'Odhlášeno rodičem',
    adding: 'Přidávám…',
    removing: 'Odebírám…',
    ineligibleReason: {
      ALREADY_BOOKED: 'Už je přihlášen',
      BIRTH_YEAR_OUT_OF_RANGE: 'Neodpovídá ročník',
      NO_WORKSPACE_SPORT_PROFILE: 'Chybí hokejový profil',
      ATHLETE_INACTIVE: 'Neaktivní sportovec',
      SESSION_CANCELLED: 'Trénink je zrušen',
    },
    /* K3, the create/edit form. The captions are the design's own. */
    whenCaption: 'KDY',
    whereCaption: 'KDE',
    whoCaption: 'KDO',
    coachesCaption: 'TRENÉŘI',
    notesCaption: 'POZNÁMKY',
    location: 'Místo',
    eligibilityQuestion: 'Pro koho?',
    yearFrom: 'Od',
    yearTo: 'Do',
    changingRoomOptional: 'Nepovinné',
    publicNotesLabel: 'Informace pro sportovce · vidí rodiče',
    internalNotesLabel: 'Interní poznámka · jen trenéři',
    /* A new training starts with the two things this coach writes every time.
       It is a starting point, and the helper says so. */
    publicNotesDefault: 'Přineste si láhev s vodou. Sraz 15 minut před začátkem.',
    publicNotesDefaultHint: 'Výchozí text, můžete ho upravit',
    previously: 'Původně {value}',
    discardTitle: 'Zahodit změny?',
    discardKeep: 'Pokračovat v úpravách',
    discardConfirm: 'Zahodit',
    saveChanges: 'Uložit změny',
    createSession: 'Vytvořit trénink',
    saving: 'Ukládám…',
    /* The footer notice. One sentence per field, because the Czech verb agrees
       with the noun: `Změnil se čas` but `Změnilo se datum`. */
    changedTime: 'Změnil se čas.',
    changedDate: 'Změnilo se datum.',
    changedLocation: 'Změnilo se místo.',
    changedFacility: 'Změnila se hala.',
    changedMainCoach: 'Změnil se hlavní trenér.',
    changedSeveral: 'Změnilo se víc údajů o tréninku.',
    changedEmail: {
      one: 'Rodiče {count} přihlášeného sportovce dostanou e-mail a u přihlášky uvidí „Změněno“.',
      few: 'Rodiče {count} přihlášených sportovců dostanou e-mail a u přihlášky uvidí „Změněno“.',
      many: 'Rodiče {count} přihlášených sportovců dostanou e-mail a u přihlášky uvidí „Změněno“.',
    } satisfies PluralForms,
    /* K11 and K4b, a season of trainings. */
    repeatCaption: 'OPAKOVÁNÍ',
    copiedCaption: 'ZKOPÍRUJE SE',
    editCopied: 'Upravit',
    previewCaption: 'NÁHLED',
    /* K4, duplicating one training. */
    duplicateNotice: 'Kopie tréninku {source}.',
    duplicateNoticeAction: 'Vyberte nové datum. Přihlášení sportovci se nekopírují.',
    duplicateOne: 'Jeden termín',
    duplicatePeriod: 'Na období',
    pickDateFirst: 'Nejdřív vyberte datum',
    /* K3b and K3c, the two coach pickers. */
    assistantsTitle: 'Asistenti',
    assistantsIntro: 'Vyberte jednoho nebo více trenérů. Nikoho vybírat nemusíte.',
    assistantsIsMain: 'Hlavní trenér tohoto tréninku',
    assistantsHint: 'Zobrazují se jen aktivní trenéři. Seznam spravuje administrátor.',
    addAssistant: '+ Přidat asistenta',
    removeAssistant: 'Odebrat {name}',
    done: 'Hotovo',
    doneCount: {
      one: 'Hotovo · {count} asistent',
      few: 'Hotovo · {count} asistenti',
      many: 'Hotovo · {count} asistentů',
    } satisfies PluralForms,
    mainCoachIntro: 'Vyberte jednoho trenéra.',
    mainCoachWasAssistant: 'Nyní asistent — po výběru se z asistentů odebere',
    mainCoachEmail: {
      one: 'Změna hlavního trenéra se rodičům {count} přihlášeného sportovce oznámí e-mailem.',
      few: 'Změna hlavního trenéra se rodičům {count} přihlášených sportovců oznámí e-mailem.',
      many: 'Změna hlavního trenéra se rodičům {count} přihlášených sportovců oznámí e-mailem.',
    } satisfies PluralForms,
    /* K8: reducing capacity below what is already booked. Allowed, and the
       dialog states what it does and does not do. */
    capacityBelowTitle: {
      one: 'Na tento trénink je již přihlášen {count} sportovec.',
      few: 'Na tento trénink jsou již přihlášeni {count} sportovci.',
      many: 'Na tento trénink je již přihlášeno {count} sportovců.',
    } satisfies PluralForms,
    capacityBelowNew: 'Nová kapacita je {capacity}.',
    capacityBelowKept: 'Stávající přihlášky zůstanou zachovány.',
    capacityBelowHelp: 'Nové přihlášky budou možné, až počet sportovců klesne pod {capacity}.',
    /* K9: narrowing the years past somebody already booked (D-08). */
    ineligibleTitle: {
      one: '{count} přihlášený sportovec nesplňuje novou věkovou podmínku.',
      few: '{count} přihlášení sportovci nesplňují novou věkovou podmínku.',
      many: '{count} přihlášených sportovců nesplňuje novou věkovou podmínku.',
    } satisfies PluralForms,
    ineligibleRange: 'Ročníky {from} → {to}',
    ineligibleKept: 'Jejich přihlášky zůstanou zachovány.',
    ineligibleNotified: 'Dotčení rodiče budou upozorněni.',
    series: 'Série tréninků',
    newSeries: '+ Série',
    newSeriesTitle: 'Nová série tréninků',
    noSeries: 'Zatím žádné série.',
    weekday: 'Den v týdnu',
    /* coach/SPEC.md §K4b: the panel repeats on several weekdays, not one. */
    repeatEvery: 'Opakovat každý',
    dateFrom: 'Od data',
    dateTo: 'Do data',
    preview: 'Náhled termínů',
    previewEmpty: 'Zadanému nastavení neodpovídá žádný termín.',
    previewCount: {
      one: 'Vytvoří se {count} trénink',
      few: 'Vytvoří se {count} tréninky',
      many: 'Vytvoří se {count} tréninků',
    },
    previewUncheck: 'Zrušte zaškrtnutí u dnů, kdy se netrénuje',
    seriesLimit: 'Série může mít nejvýše 52 tréninků.',
    seriesSkipped: {
      one: '{count} termín vynechán',
      few: '{count} termíny vynechány',
      many: '{count} termínů vynecháno',
    },
    createSeriesCount: {
      one: 'Vytvořit {count} trénink',
      few: 'Vytvořit {count} tréninky',
      many: 'Vytvořit {count} tréninků',
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
    /* The 44 px toggles and the series list have room for two letters. */
    weekdaysShort: {
      '1': 'Po',
      '2': 'Út',
      '3': 'St',
      '4': 'Čt',
      '5': 'Pá',
      '6': 'So',
      '7': 'Ne',
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
      SERIES_TOO_LONG:
        'Série může mít nejvýše 52 tréninků. Zkraťte období nebo zrušte zaškrtnutí u některých termínů.',
      INVALID_WEEKDAY: 'Vyberte alespoň jeden den v týdnu.',
      INVALID_DATE_RANGE: 'Datum do musí být po datu od.',
      ALREADY_BOOKED: 'Sportovec už je na tento trénink přihlášen.',
      NOT_ELIGIBLE: 'Sportovec nesplňuje podmínky tohoto tréninku.',
      ATHLETE_NOT_FOUND: 'Sportovec nebyl nalezen.',
      BOOKING_NOT_FOUND: 'Přihláška nebyla nalezena.',
      BOOKING_NOT_CONFIRMED: 'Přihláška už není aktivní.',
      WOULD_EXCEED_CAPACITY: 'Trénink je plný. Potvrďte překročení kapacity.',
      /* coach/SPEC.md §K3b. One person, one role on one training. */
      MAIN_COACH_AS_ASSISTANT: 'Hlavní trenér nemůže být zároveň asistent.',
      generic: 'Uložení se nezdařilo. Zkuste to prosím znovu.',
    },
  },

  /**
   * Transactional email (BR-061, BR-072). Czech, like every other user-facing
   * string; the event types and codes around them stay English.
   */
  email: {
    greeting: 'Dobrý den,',
    signature: 'Trainlio',
    /* AC-073: one email per guardian, naming that guardian's own athletes. */
    athletes: {
      one: 'Přihlášený sportovec: {names}',
      few: 'Přihlášení sportovci: {names}',
      many: 'Přihlášení sportovci: {names}',
    } satisfies PluralForms,
    reason: 'Důvod: {reason}',
    /* A message the coach wrote for this parent, not an internal note. */
    coachMessage: 'Zpráva od trenéra: {reason}',
    removedAthletes: {
      one: 'Odhlášený sportovec: {names}',
      few: 'Odhlášení sportovci: {names}',
      many: 'Odhlášení sportovci: {names}',
    } satisfies PluralForms,
    /* D-06: the parent cannot put the child back themselves. */
    contactCoach: 'Pro opětovné přihlášení kontaktujte trenéra.',
    link: 'Podrobnosti najdete v aplikaci: {url}',
    preserved: 'Přihlášky zůstávají v aplikaci k nahlédnutí.',
    subjects: {
      SESSION_CANCELLED: 'Zrušený trénink — {when}',
      SESSION_SCHEDULE_CHANGED: 'Změna času tréninku — {when}',
      SESSION_LOCATION_CHANGED: 'Změna místa tréninku — {when}',
      SESSION_FACILITY_CHANGED: 'Změna haly — {when}',
      SESSION_MAIN_COACH_CHANGED: 'Změna trenéra — {when}',
      SESSION_ELIGIBILITY_NARROWED: 'Změna ročníků tréninku — {when}',
      BOOKING_REMOVED_BY_COACH: 'Odhlášení z tréninku — {when}',
    },
    bodies: {
      SESSION_CANCELLED: 'trénink {when}, {where}, byl zrušen.',
      SESSION_SCHEDULE_CHANGED: 'trénink byl přesunut na {when}, {where}.',
      SESSION_LOCATION_CHANGED: 'trénink {when} se koná na jiném místě: {where}.',
      SESSION_FACILITY_CHANGED: 'trénink {when} se koná v jiné hale: {where}.',
      SESSION_MAIN_COACH_CHANGED: 'trénink {when}, {where}, povede jiný trenér.',
      SESSION_ELIGIBILITY_NARROWED:
        'u tréninku {when}, {where}, se změnil rozsah ročníků. Vaše přihláška zůstává v platnosti.',
      /* The training still happens — which is the whole difference from a
         cancellation, and the reason a parent would otherwise drive there. */
      BOOKING_REMOVED_BY_COACH:
        'trenér odhlásil sportovce z tréninku {when}, {where}. Trénink se koná, sportovec na něm ale už není v sestavě.',
    },
  },

  account: {
    title: 'Účet',
    /* Asked once, in the form where a parent registers their first child.
       guardian/SPEC.md §G16 is the source of these words; the coach's roster
       is the reason they are asked at all. */
    yourDetails: 'Vaše údaje',
    yourDetailsIntro: 'Trenér uvidí, kdo sportovce přihlásil.',
    firstName: 'Jméno',
    lastName: 'Příjmení',
    nameHint: 'Jak vás uvidí trenér.',
    /* DESIGN_BRIEF decision 18. The reason is given in the field, because a
       parent deciding whether to hand over a phone number deserves to know
       who sees it and what for. */
    phone: 'Telefon',
    phoneHint: 'Trenér vás může kontaktovat, když se trénink změní na poslední chvíli.',
    /* A parent writes their own number the way they say it. The placeholder
       shows that form; a number with a předvolba is accepted just the same. */
    phonePlaceholder: '777 123 456',
    errors: {
      lastNameNeedsFirst: 'Zadejte prosím i jméno, ne jen příjmení.',
      phoneFormat: 'Telefonní číslo není platné. Zkuste například 777 123 456.',
    },
  },

  /* The coaching staff (D-11, DESIGN_BRIEF §34): an administrator adds coaches
     and fills in the names guardians read on the session page. */
  /** The club's own mark. Not in the design handoff; see DESIGN_DEVIATIONS. */
  /* The club or training centre, as the administrator edits it and every
     screen shows it (admin/SPEC.md §A4/A4b/A5). The wording is the design
     handoff's, verbatim. */
  organization: {
    title: 'Organizace',
    back: 'Zpět',
    rowLabel: 'Organizace',
    rowValue: 'Logo a název',
    logoCaption: 'LOGO',
    nameCaption: 'NÁZEV',
    name: 'Název organizace',
    shortName: 'Krátký název',
    shortNameHint: 'Použije se tam, kde se celý název nevejde.',
    upload: 'Nahrát logo',
    uploadHint: 'PNG, SVG nebo JPG · čtvercové, min. 256 × 256 px · max. 2 MB',
    change: 'Změnit logo',
    changeHint:
      'PNG, SVG nebo JPG · nejlépe čtvercové, alespoň 256 × 256 px · max. 2 MB. Nejlépe vypadá logo s průhledným pozadím.',
    remove: 'Odebrat logo',
    removeTitle: 'Odebrat logo?',
    removeQuestion: 'Místo loga se zobrazí iniciály názvu.',
    removeConfirm: 'Odebrat',
    monogramNote: 'Dokud logo nenahrajete, zobrazí se v aplikaci iniciály názvu.',
    save: 'Uložit',
    saving: 'Ukládám…',
    saved: 'Uloženo',
    /* A5, the adjust sheet. */
    adjustTitle: 'Upravit logo',
    zoom: 'Velikost',
    zoomHint: 'Posunutím obrázek vycentrujete',
    background: 'Pozadí loga',
    backgroundWhite: 'Bílé',
    backgroundTransparent: 'Průhledné',
    preview: 'Náhled v aplikaci',
    apply: 'Použít logo',
    chooseAnother: 'Vybrat jiný soubor',
    errors: {
      NAME_REQUIRED: 'Vyplňte název organizace.',
      NAME_TOO_LONG: 'Název je příliš dlouhý.',
      SHORT_NAME_TOO_LONG: 'Krátký název je příliš dlouhý.',
      LOGO_TOO_LARGE: 'Soubor je větší než 2 MB.',
      LOGO_TYPE_NOT_ALLOWED: 'Tento formát nepodporujeme. Nahrajte PNG, SVG nebo JPG.',
      LOGO_TOO_SMALL: 'Logo je příliš malé. Nahrajte alespoň 256 × 256 px.',
      LOGO_EMPTY: 'Vyberte soubor.',
      LOGO_UNREADABLE: 'Soubor se nepodařilo načíst.',
      LOGO_UPLOAD_FAILED: 'Nahrání se nezdařilo. Zkuste to prosím znovu.',
      INVALID_LOGO_PATH: 'Neplatná cesta k souboru.',
      INVALID_LOGO_BACKGROUND: 'Neplatné pozadí loga.',
      NOT_AUTHENTICATED: 'Přihlaste se prosím znovu.',
      NOT_AUTHORIZED: 'Tyto údaje může měnit jen správce.',
      WORKSPACE_NOT_FOUND: 'Klub nebyl nalezen.',
      generic: 'Uložení se nezdařilo. Zkuste to prosím znovu.',
    },
  },

  staff: {
    title: 'Trenéři',
    link: 'Trenéři',
    intro: 'Jméno trenéra uvidí rodiče u tréninku. Spravuje je správce klubu.',
    roleCOACH: 'Trenér',
    roleWORKSPACE_ADMIN: 'Správce',
    noName: 'Bez jména',
    neverSignedIn: 'Bez přihlášení',
    inactive: 'Neaktivní',
    editName: 'Upravit jméno',
    addCoach: '+ Přidat trenéra',
    addCoachTitle: 'Nový trenér',
    deactivate: 'Deaktivovat',
    activate: 'Znovu aktivovat',
    /* AC-251. The count comes from the server's refusal, so the warning never
       states a number the client made up. */
    leadsFutureSessions: {
      one: 'Tento trenér vede {count} nadcházející trénink. Po deaktivaci ho nepůjde upravit, dokud u něj nezměníte hlavního trenéra.',
      few: 'Tento trenér vede {count} nadcházející tréninky. Po deaktivaci je nepůjde upravit, dokud u nich nezměníte hlavního trenéra.',
      many: 'Tento trenér vede {count} nadcházejících tréninků. Po deaktivaci je nepůjde upravit, dokud u nich nezměníte hlavního trenéra.',
    } satisfies PluralForms,
    errors: {
      NOT_AUTHENTICATED: 'Přihlaste se prosím znovu.',
      NOT_AUTHORIZED: 'Na tuto změnu nemáte právo.',
      MEMBER_NOT_FOUND: 'Tato osoba už není členem klubu.',
      NAME_REQUIRED: 'Zadejte jméno i příjmení.',
      LAST_ADMIN: 'Klub musí mít aspoň jednoho aktivního správce.',
      generic: 'Uložení se nezdařilo. Zkuste to prosím znovu.',
    },
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
