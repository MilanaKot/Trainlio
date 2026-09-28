# Deviations from the design handoff

`docs/design/` is the handoff as delivered, and it wins by default. This file
lists every place the implementation does something else, and why — so a
reviewer comparing a screen against its spec finds the answer here instead of
assuming the spec was missed.

Each entry is a decision that has been taken. Things still genuinely undecided
belong in `OPEN_DECISIONS.md`.

## Routes stay Czech

`guardian/SPEC.md` §1 says "route names are English for the codebase" and lists
`/trainings`, `/my-trainings`, `/account`. The application serves `/treninky`,
`/moje-treninky`, `/ucet` and the rest in Czech.

Renaming fourteen routes would touch the runbook, the deployment notes, the
browser suite and any link a coach has already sent a parent, in exchange for
consistency with a document that itself calls URLs a detail of the codebase.
Code, schema, comments and docs are English as CLAUDE.md requires; the URL is
something a parent reads.

## The message catalogue stays TypeScript

`shared/DESIGN_SYSTEM.md` §8 proposes `messages/cs.json` in ICU syntax. The
project already has a typed catalogue at `src/lib/i18n/messages/cs.ts` with a
`plural()` helper and its own tests. Same plural categories, same output, an
implementation that is already proven, and no new dependency. English can be
added beside it when it is needed.

## A telephone number needs no country code

`guardian/SPEC.md` §G16 asks for E.164 validation. The column takes a national
number too. A form that refuses `777 123 456` is telling a parent their own
telephone number is wrong, both ends of the call are in the same country, and
`tel:` on a national number dials from the coach's phone at the rink. A number
that starts with `+` is still held to E.164 strictly, so a family abroad works.
The placeholder changed to match (`777 123 456`).

## Changing the e-mail address is not built

`guardian/SPEC.md` §G14 designs `/account/email`. Out of scope for now, by
product decision — the flow exists nowhere in the application and is not in the
brief. The screen is simply absent, as `G15 Jazyk` already is.

## Dark mode is deferred, and needs its own input

The design is a single light palette (brief §3 asks for a light background) and
names no dark colours. Until it does, the dark variant is bound to a class
nothing sets, so the `dark:` utilities still left in pre-design screens are
inert rather than half-applied. A dark theme cannot be derived: the accent and
every status colour fall between 2.7:1 and 3.4:1 on a dark background, and all
six soft fills are pale tints built for white.

## Every active guardian is returned, not one "Rodič"

`coach/SPEC.md` §K2 shows a single `Rodič` row with a single `Telefon`.
`booking_guardians()` returns every active guardian of the athlete. One
guardian is the common case, not a rule — BR-002 has allowed several since the
first migration — and a second parent should not be hidden from a coach trying
to reach the family.

## A parent cannot re-book a child the coach removed

`guardian/SPEC.md` §G4b and §G6d put a `Přihlásit` button on the removed
booking, and README decision 19 says the parent "may re-book if a place is
free". They cannot.

D-06 decided this before the design existed, `CLAUDE.md` states it as an MVP
product assumption, the domain function refuses it with `REMOVED_BY_COACH`, and
AC-042a asserts it. The reason is in the decision: a parent who can undo a
removal makes the removal advisory, and the coach who removed a child for a
reason sees them back in the list a minute later.

Everything else on both screens is built as drawn — the orange badge, the
notice, the coach's message, the e-mail, the released place. The footer says
`Pro opětovné přihlášení kontaktujte trenéra.`, which is the sentence the
application already uses for this case. The coach can re-add the athlete, as
AC-042b has always allowed.

## Removed and cancelled bookings move to "Minulé" when the session ends

`guardian/SPEC.md` §G4b says a removed booking stays in `Nadcházející` until
the session _starts_, and §G5 says the same for a cancelled session. The split
is by `end_at` for everything, as D-04 and AC-120/AC-121 define it.

The difference is one hour on a card that already carries an orange
`Odhlášeno trenérem` badge, against a second rule inside the one function whose
value is that it has exactly one. Worth revisiting if a parent is ever confused
by it; not worth the branch now.

## The reason under a disabled `Přihlásit` is the reason that applies

`guardian/SPEC.md` §G1 gives one sentence for the "no eligible child" row of
the footer table: `Žádný z vašich sportovců nesplňuje ročníky`.

It is shown when the birth years are what blocks the family, and only then. A
coach's removal (D-06) says `Sportovce odebral trenér…`, a missing sport
profile or a deactivated athlete says `Žádný z vašich sportovců se na tento
trénink nemůže přihlásit.`, and a family with no athletes at all says nothing
on the card — the empty state above the list already tells them to add one.

The design's sentence is right for the case it was written for. Told to a
parent whose child the coach removed, it sends them to correct a date of birth
that is perfectly correct.

## The public note stays on the training card — open question

The card in `DESIGN_SYSTEM.md` §6.5 has no row for the coach's public note, and
`guardian/SPEC.md` puts `INFORMACE PRO SPORTOVCE` on G6, the booking detail.
G6 is reachable only from a booking, and there is no detail screen for a
training a parent has not booked yet, so as drawn a note like "bring your
pads, meet fifteen minutes early" is invisible until after booking.

The note is kept on the card for now, where the previous implementation had it.
It is guardian-visible by D-13 and the coach wrote it for exactly these parents.
The cost is that a card with a long note is taller than the design's.

**To decide:** clamp it to two lines on the card, move it into the booking
sheet, or leave it as it is.
