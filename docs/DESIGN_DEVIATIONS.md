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

## The public note is not on the training card

It was, for a while. `shared/DESIGN_SYSTEM.md` §6.5 lists the card's rows and
the note is not among them, and the design is right: a club writes the same
sentence on every training, so forty cards carry it forty times, and the parent
who needs it — the one bringing a child on Thursday — meets it on the booking
detail (§G6) where it belongs.

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

The same holds for a parent's own withdrawal, where §G4 says the booking
"moves to Minulé" the moment they confirm. It stays in `Nadcházející` with the
neutral `Odhlášeno` badge until the training ends. One rule, applied to all
three cases: `end_at` decides which list a booking is in, and its status
decides how the card looks.

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

## The club's mark is not in the design

Every header in the handoff is the product's — `Tréninky` with
`Lední hokej · Příbram` beneath it — and the only brand mark anywhere is the
Trainlio wordmark on the sign-in screen. A club emblem was asked for after the
design arrived, so three choices were made here rather than drawn:

A rounded square with the image contained inside it, not a circle. Club
emblems are shields and crests, and a circular crop cuts their corners off. A
white tile behind it, because a logo drawn for white paper disappears on the
app's grey.

Nothing at all when a club has no mark, rather than a monogram: a placeholder
standing in for information that does not exist is noise.

In the e-mail it is 40px beside the club's name, with the name as its
alternative text. Mail clients refuse remote images until the reader asks, so
nothing the message says is inside the picture.

All three are one component (`components/ui/club-mark.tsx`) and cheap for the
designer to overrule.

**The bucket is public**, unlike `athlete-photos`. That is the consequence of
putting the mark in e-mails: a mail client can follow neither a signed URL that
expires in an hour nor private storage. A club's emblem is its public face; a
child's photograph is not, and that bucket keeps its 60-minute signed URLs
(BR-093, AC-092, D-19).

## A parent's surname is optional

`guardian/SPEC.md` §G16 marks both `Jméno` and `Příjmení` required. The first
name is required here; the surname is not, on both the account screen and the
new block in the first-athlete form.

The reason is the one already written into the account screen: a parent may be
"Jana" on a roster if that is how they want to be known, and the roster reads
`Přihlásil Jana` perfectly well. What the coach actually needs is _a_ name to
call out and a way to reach them — not a full legal one. A surname alone is
still refused, because `Přihlásil Nováková` is a form, not a person.

Worth revisiting if a coach ever cannot tell two Janas apart; cheap to change,
since it is one validation rule in `updateOwnProfile`.

## The organization logo, after handoff v2

The handoff's second delivery designed the club mark properly (README decisions
20–22, DESIGN_SYSTEM §6.23, admin A4/A4b/A5, guardian G11/G1), which replaced
the three choices recorded above. `ClubMark` is gone; `OrgLogo` is the one
component, the monogram now exists, and the mark is on the sign-in screen.

Four places where the implementation still differs from what is drawn, all of
them deliberate:

**`organization` is the `workspaces` row.** The spec gives the organization its
own table. This schema has had one since migration 2 under another name, and
every session, athlete and membership already hangs from it. The three new
fields were added there (migration 30). The bucket keeps the name migration 29
gave it, `workspace-logos`, for the same reason: renaming storage to match a
word costs a migration and a re-upload and buys nothing.

**The route is `/trener/organizace`**, not `/coach/more/organization`. This
repository's routes are Czech, and the `Více` tab the design hangs A0 under does
not exist yet — the coach group still has its pre-design header, and the screen
is reached from there until the coach navigation is rebuilt. A0 itself is not
built.

**The mark is also in the coach's own header.** The task lists that as out of
scope, and `admin/SPEC.md` leaves it as an open question answered "assume no".
It was asked for directly before this handoff arrived, and it is one line; it
stays until the designer says otherwise.

**The save is one action, not an upload followed by a commit.** §A5 recommends
uploading to a temporary key and committing on `Uložit`, and explicitly allows
either. The cropped PNG is held in the browser instead and uploaded by the same
action that saves the name, so a sheet closed without saving leaves nothing
behind in a public bucket.

**The server takes PNG alone.** The file rules list PNG, JPEG and SVG, and that
is what the picker offers and what the browser validates. What may be _stored_
is narrower, because the sheet rasterises every choice to a 512px PNG and an
SVG served back from our own origin is a script: the server checks the bytes
rather than the declared type, and the bucket takes `image/png` only.

## Confirmed with the product, 29 September 2026

Four of the choices above were open questions; they are now decisions, and this
is the record so they are not reopened by accident.

**`organization` stays the `workspaces` row**, bucket and all. The word differs
between the design and the schema; the entity does not.

**The route stays Czech.** `Trenéři` and `Organizace` live under
`/trener/vice/…`, which also makes the tab bar correct: the path says which tab
you are in.

**The mark stays in the coach's own header**, though the handoff lists it as out
of scope.

**`Hůl` reads `Levá` / `Pravá`.** The brief wrote them in the neuter; `hůl` is
feminine, and `guardian/SPEC.md` flags it as a question for the product. It is
answered.

Two things are deliberately not built:

**Changing your e-mail (§G14).** A new address needs a code sent to it and, with
Supabase's default, a confirmation from the old one as well. The account screen
shows the address and does not offer to change it, rather than offering a
chevron that leads nowhere.

**Inviting a coach by e-mail.** `admin/SPEC.md` leaves it as "handled
separately", and nothing about it is designed yet. A coach added on A2 exists
and can lead trainings from that moment; they simply cannot sign in until
somebody grants them a login.

One label departs from the drawing on purpose: the birth-year selects read
`Od ročníku` / `Do ročníku` rather than the design's bare `Od` / `Do`, because
the series screen carries a date range under those very words in another panel,
and a screen reader cannot see which panel it is in.
