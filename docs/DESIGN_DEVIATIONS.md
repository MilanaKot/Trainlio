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

## No `+ Přidat sport` on the athlete profile

§G8 ends with a low-emphasis `+ Přidat sport`. A second sport has no screen
behind it in the MVP — one workspace, one sport — so the button would open
nothing. It comes back with the screen it needs.

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

## The club's mark is in a public bucket

Unlike `athlete-photos`. That is the consequence of putting the mark in
e-mails: a mail client can follow neither a signed URL that expires in an hour
nor private storage. A club's emblem is its public face; a child's photograph
is not, and that bucket keeps its 60-minute signed URLs (BR-093, AC-092, D-19).

## The organization logo, after handoff v2

The handoff's second delivery designed the club mark properly (README decisions
20–22, DESIGN_SYSTEM §6.23, admin A4/A4b/A5, guardian G11/G1), and it replaced
every choice made here before it arrived. `ClubMark` is gone; `OrgLogo` is the
one component, the monogram now exists — where we had deliberately shown nothing
— and the mark is on the sign-in screen.

Five places where the implementation still differs from what is drawn, all of
them deliberate:

**`organization` is the `workspaces` row.** The spec gives the organization its
own table. This schema has had one since migration 2 under another name, and
every session, athlete and membership already hangs from it. The three new
fields were added there (migration 30). The bucket keeps the name migration 29
gave it, `workspace-logos`, for the same reason: renaming storage to match a
word costs a migration and a re-upload and buys nothing.

**The route is `/trener/vice/organizace`**, not `/coach/more/organization`.
This repository's routes are Czech (see the first entry in this file). A0 and
the `Více` tab it hangs under are built as drawn, and the Czech path is what
makes the tab bar correct: the path says which tab you are in.

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

## After handoff v3

The third delivery answered every request in `DESIGN_REQUESTS.md`, and most of
them are now simply built. These are the places where what shipped is not quite
what is drawn, and the reasons.

**The invitation link prefills the address; it does not send the code.** §A6's
copy said "Po kliknutí vám pošleme jednorázový kód", and a link that sends one
when it is fetched is a link that spends the code on whoever fetched it first.
Scanners, SafeLinks and preview services all fetch links in e-mails. The link
opens the sign-in screen with the address already in the field and the copy says
`stačí potvrdit`: one tap, and nothing a machine can do by accident.

**`/trener/vitejte` and `/trener/sportovci/[id]`**, not `/coach/welcome` and
`/coach/athletes/[id]`. Routes are Czech here, as the first entry in this file
records.

**The code input has no `maxlength`.** §6.26 asks for one and also asks that a
code pasted as `123 456` work. It cannot do both: `maxlength` counts characters,
so the paste arrives as `123 45` and the space is stripped out of a string that
has already lost a digit. The length is enforced on the digits instead, which is
what the attribute was there to do.

**`ChoiceGrid` is a `radiogroup` with a label, not a `fieldset` with a legend.**
Both are announced correctly; the pills are already inside a labelled field on
every screen that uses them, and a legend there would have a screen reader read
the name twice.

**§K14 loads fifty past trainings rather than paging twenty days at a time.**
The design asks for infinite scroll. Fifty is more than a club has in a season
and the screen is read rarely; the paging can arrive with the first club that
needs it.

**The e-mails are tables and inline styles.** `emails/*.html` is drawn with
flexbox, custom properties and a stylesheet, which is right for a browser and
reaches no mail client: Gmail strips `<style>` and Outlook renders with Word.
The same design is expressed in what mail clients actually have.

**One e-mail links to a booking when there is exactly one.** §E02 and §E08 send
the parent to that booking's screen. A guardian with two children in one event
receives one message about both, and there is no screen for two bookings, so the
button opens the list that holds them.

## Decided in v3, and recorded so they are not reopened

The designer answered fourteen requests. Nine of them confirmed what was already
built (the mark in the coach's header, the public note on the detail only,
`Od ročníku` / `Do ročníku`, the optional surname, every guardian on the roster,
Czech routes, reopening registration, no out-of-range additions, and `end_at`
deciding which list a booking is in). The rest became the work above.

Three remain deliberately unbuilt: **changing your e-mail** (§G14), **a second
sport** (`+ Přidat sport`), and **the language screen** (§G15). **Dark mode**
stays off until it has a palette of its own; the `dark:` variant is still bound
to nothing.

One question is still open, and it is the designer's: **deactivating a coach who
is the main coach of future trainings** warns and allows, as it always has.
Whether it should instead force a reassignment is in `DESIGN_REQUESTS.md`.
