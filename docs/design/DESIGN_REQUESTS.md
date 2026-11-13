# What we need from the designer

The handoff in `docs/design/` is built. This file is the other direction: the
places where the application is finished but the design is not, written as
requests a designer can work through.

Every entry says what the application does **today**, so the answer can be
"leave it" — that is a real answer and it costs nothing. Where a constraint
cannot move, it is marked **Fixed**; those come from the database or from a
product decision already taken (`docs/OPEN_DECISIONS.md`,
`docs/DESIGN_DEVIATIONS.md`), not from the implementation being awkward.

Screens are mobile-first, 390×844. UI text is Czech; file names, tokens and
notes are English.

**Delivering.** The same shape as the three handoffs so far: a screen per file
in `design-source/screens/` named `<ID>-<Name>.dc.html`, the screens joined in
`prototype.html`, a section per screen in the area's `SPEC.md` with a new ID,
and anything new in the system as a numbered `DESIGN_SYSTEM.md` §6 entry with
its tokens. An answer that needs no screen can be a line in `README.md` under
"Decisions" — that is enough for us to build from.

---

## Still open

### DR-09 · Changing your e-mail address (§G14)

Designed as `/account/email`; not built, by product decision. If it comes back,
the drawn screen is not enough: a new address needs a code sent to it, and
Supabase's default also wants a confirmation from the old one. Two codes, two
inboxes, and a state where neither is confirmed yet.

### DR-10 · A second sport (§G8 `+ Přidat sport`)

Not built, because the screen behind it does not exist: the MVP is one workspace
and ice hockey. The architecture carries multiple sports and one athlete in
several of them, so this is real work later, not a dead button.

### DR-11 · Language (§G15) and dark mode

**§G15 Jazyk** is hidden until a second locale ships. **Dark mode** cannot be
derived from the palette: the accent and all six status colours land between
2.7:1 and 3.4:1 on a dark background, and every soft fill is a pale tint built
for white. It needs its own palette or it stays off; the `dark:` variant is
bound to nothing in the meantime.

---

### DR-16 · A training planned without a main coach (BR-186)

Asked for by the product on 12 November 2026 and built without a design: K3c
gains a `Bez trenéra` row (a `?` tile, `Trenéra přiřadíte později.`), and
such a training reads as K2e without the `{coach} byl deaktivován` sentence.
Worth drawing: the K3c row, the K2e notice for a training that never had a
coach, and whether K1 should mark it differently from one whose coach left.

### DR-18 · Signing in with Google (D-38)

Decided by the product on 13 November 2026: Google and the e-mail code, no
password. Built without a design: G11 gains an outline `Pokračovat přes
Google` with Google's own mark, a divider `nebo`, then the e-mail field as
before. Worth drawing: G11 with the button (Google's branding rules apply to
it), the error after a cancelled or failed Google sign-in (today a red line
above the button), and what a coach sees who chose a Google account other than
the address they were invited with — today an empty parent account — plus a
line in A6 saying Google works with that address.

### DR-19 · Joining a club by link and approval

Decided by the product on 12 November 2026, not built yet: a club link or QR
code, a child waiting for an administrator's approval, and a second parent
invited by the first (PRD §6). Needed: the administrator's link/QR screen
(show, copy, print, issue a new one), what a parent sees arriving by the link,
`Čeká na schválení`, the administrator's approval list with a count in the
menu, what a rejected parent sees, inviting a second parent from the child's
profile (address, which children, pending invitations, withdrawing one), and
the invitation e-mail. Open: whether the administrator is e-mailed about a
waiting child and the parent about the decision.

---

## Answered with v3.7, 13 November 2026

**DR-17 · Cancellation reasons in the player card.** Decisions 52–55: the
reason is required (`Nepůjde`, G6g) and shown in K2 (`NEPŮJDOU`), in K13's
Tréninky and Zprávy tabs, and e-mailed to the coach (E10).

## Answered with v3.4, 12 November 2026

**DR-15** is superseded: A3f replaces the `Převést tréninky na mě` switch, and
the future trainings wait without a main coach (D-32).

## Answered by the product, 10 October 2026

**DR-15 · Deactivating a coach who leads future trainings.** The administrator
is asked, with two answers: hand the future trainings to themselves, or leave
them where they are (D-11). There is no club-level head coach to hand them to —
`main_coach_profile_id` belongs to each training — so "whoever is deactivating"
is who takes them over, and no new screen is needed: the question is a switch
inside the confirmation that already named the count. Built as AC-293 and
recorded as D-25. `admin/SPEC.md` §5 can be closed; the dialog it describes now
carries one more line, `Převést tréninky na mě`.

## Answered in v3

DR-01 to DR-08 and DR-12 to DR-14 were answered in `DESIGN_REQUESTS_ANSWERS.md`
and are built: the coach's athletes (K12/K13), the past-trainings tab (K14), the
series screens (K15/K16), the removed-booking footers, the eight e-mails, the
shared components, the coach invitation (A1–A3c, A6, K0), the administrator role
(A3, A3d, A3e), the e-mail about a coach's booking, and HEIC photographs.

Where what shipped differs from what was drawn, and why, is in
`docs/DESIGN_DEVIATIONS.md` under "After handoff v3".
