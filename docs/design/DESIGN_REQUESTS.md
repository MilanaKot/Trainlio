# What we need from the designer

The handoff in `docs/design/` is built. This file is the other direction: the
places where the application is finished but the design is not, written as
requests a designer can work through.

Three kinds of entry, and the difference matters:

- **A — shipped without a design.** The screen is live and a coach or a parent
  uses it today. We invented it because the work could not wait, and it is the
  part of the product most likely to look unlike the rest. These come first.
- **B — designed nowhere, built nowhere.** A flow the specs name and leave
  open. Nothing is live, so nothing is wrong yet; it simply cannot be built.
- **C — one decision each.** A question, a label, a rule. No screen needed,
  usually one sentence back.

Every entry says what the application does **today**, so the answer can be
"leave it" — that is a real answer and it costs nothing. Where a constraint
cannot move, it is marked **Fixed**; those come from the database or from a
product decision already taken (`docs/OPEN_DECISIONS.md`,
`docs/DESIGN_DEVIATIONS.md`), not from the implementation being awkward.

Screens are mobile-first, 390×844. UI text is Czech; file names, tokens and
notes are English.

**Delivering.** The same shape as the two handoffs so far: a screen per file in
`design-source/screens/` named `<ID>-<Name>.dc.html`, the screens joined in
`prototype.html`, a section per screen in the area's `SPEC.md` with a new ID,
and anything new in the system as a numbered `DESIGN_SYSTEM.md` §6 entry with
its tokens. An answer that needs no screen can be a line in `README.md` under
"Decisions" — that is enough for us to build from.

---

## A. Shipped without a design

### DR-01 · The coach's `Sportovci` tab

`coach/SPEC.md` §6: "Athletes tab (coach) content not designed in this round."
It is one of four tabs in the coach's navigation, so it could not be left out.

**Today.** `/trener/sportovci` lists every athlete of the workspace: avatar,
full name, birth year, position. A deactivated athlete is muted. Rows are not
links — there is no athlete screen for a coach, so a row leads nowhere. Empty
state reuses the roster's sentence.

**Please decide and draw.**
1. The row: what a coach needs at a glance. Birth year and position, or also
   the guardian's telephone number, the number of trainings booked, the sport
   profile?
2. Order and finding: alphabetical, by birth year, grouped by year? A search
   field at 60+ athletes, or a filter by year?
3. Whether a row opens anything. If it does, that athlete screen is a new
   screen: photo, sport profile, guardians and how to reach them, booking
   history. **Fixed:** `internal_notes` is coach-only and never reaches a
   parent (D-13); a guardian's telephone number is already on the roster, where
   a coach needs it at the rink.
4. Whether a coach may act there at all — deactivate an athlete, edit a sport
   profile — or whether the screen is read-only and acting happens in the
   parent's app. **Fixed:** a coach cannot create an athlete or a guardian
   account.

### DR-02 · The coach's past trainings

`coach/SPEC.md` §6: "Past trainings list for coaches: minimal link/tab only."

**Today.** A text link under the upcoming list leads to `/trener?tab=minule`,
which shows the same cards for finished trainings and a link back. No tab bar,
no segmented control, no date grouping.

**Please decide.** Is the link enough, or does this become a proper switch like
the parent's `Nadcházející / Minulé`? And what does a finished training's card
say — the same occupancy meter, or a plain "8 přihlášených"? **Fixed:** there
is no attendance tracking in the MVP, so a past card can only report who was
booked, never who came.

### DR-03 · The series list

`coach/SPEC.md` §K11 designs the create form and nothing around it, but a coach
who creates series needs to see them.

**Today.** `/trener/serie` lists each series with its weekdays, time and date
range, and a `+ Nová série` button. Rows lead nowhere.

**Please decide and draw.** The row's content, the empty state, and what a row
does. **Fixed:** occurrences are independent after creation and there is no
series editing (§K11), so a row cannot open an edit form — at most a filtered
view of the trainings it created.

### DR-04 · The removed booking has no way back

`guardian/SPEC.md` §G4b and §G6d both draw a `Přihlásit` button on a booking
the coach removed. The parent cannot re-book: D-06 decided it, the domain
function refuses it with `REMOVED_BY_COACH`, and AC-042a asserts the refusal.

**Today.** Both states are built exactly as drawn except the button, which is
replaced by `Pro opětovné přihlášení kontaktujte trenéra.`

**Please redraw** those two footers for a state that offers no action. A
sentence is what we had to reach for; a designer may want the coach's name and
telephone number right there instead, since contacting the coach is the only
thing left to do. **Fixed:** the button cannot come back.

### DR-05 · The e-mails

`admin/SPEC.md` §5 names the rule — logo in the header when present, otherwise
the organization name as text, no monogram — and that is all the design the
e-mails have. They are the only part of the product a parent meets outside the
app.

**Today.** One hand-built HTML layout: a 520px white card on `#f5f5f5`, the
mark at 40×40 or the club's name in bold, paragraphs at 15px/1.6, and the
signature in grey. System font stack. Every message also goes out as plain
text with identical content.

**Please deliver** a template for the seven events, each with its subject line:

| Event | Sent to |
| --- | --- |
| `SESSION_CANCELLED` | every booked guardian |
| `SESSION_SCHEDULE_CHANGED` | every booked guardian |
| `SESSION_LOCATION_CHANGED` | every booked guardian |
| `SESSION_FACILITY_CHANGED` | every booked guardian (MH ↔ VH) |
| `SESSION_MAIN_COACH_CHANGED` | every booked guardian |
| `SESSION_ELIGIBILITY_NARROWED` | only the guardians of athletes that fell outside the new range (D-08) |
| `BOOKING_REMOVED_BY_COACH` | the removed athlete's guardians |

Worth a decision while drawing: whether a message links back into the app and
to which screen; whether the training's details are a block rather than a
sentence; what a message with two children in it looks like (one guardian with
two booked athletes receives one e-mail naming both — AC-072, AC-073); and
whether a web font is worth it in mail at all. **Fixed:** the mark lives in a
public bucket so a mail client can load it, and the message must read
completely with images blocked.

### DR-06 · Components with no entry in the design system

Built because a screen needed them, and each is a guess at the system's voice.
A sentence each, or a redraw.

- **Capacity stepper** (K3) — `−` / value / `+` at the field's height, typing
  allowed, committed on blur.
- **Radio pills** (G9, sport profile) — `Levá` / `Pravá`, position.
- **Six-box code input** (G12) — six separate boxes, one digit each, paste
  spreads across them.
- **Switch** (A3, athlete activity) — iOS-style track.
- **Tab bar and its icons** (A0) — four tabs, the active one by the longest
  matching path.
- **Picker sheets** (K3b, K3c) — a bottom sheet with a searchable list.

---

## B. Nothing designed, nothing built

### DR-07 · Inviting a coach so they can sign in

`admin/SPEC.md` §5: "E-mail invitation flow for coaches (brief: handled
separately)." Nothing is designed and nothing is built.

**Today.** A coach added on A2 exists immediately and can be assigned to lead
a training. They cannot sign in: no invitation is sent, and nobody in the app
can give them a login. This is the largest hole in the admin area.

**Please design** the flow end to end: what the admin sees after adding a coach
(pending state on A2 and A3?), the invitation e-mail, what the coach lands on,
re-sending, and an invitation that is never accepted. **Fixed:** sign-in is a
6-digit code to an e-mail address — no passwords anywhere in the product.

### DR-08 · Admin rights in the interface

`admin/SPEC.md` §5: "Can admins grant/revoke admin rights in MVP? (not
designed; assume DB-only)."

**Today.** `workspace_role` is `COACH` or `WORKSPACE_ADMIN` in the database and
nothing in the UI reads or writes it. With one club and one admin this holds,
and it stops holding the moment a second club arrives.

**Please decide** whether A3 gets the control, and if so what prevents an admin
from removing their own last admin right.

### DR-09 · Changing your e-mail address (§G14)

Designed as `/account/email`; not built, by product decision, and recorded in
`DESIGN_DEVIATIONS.md`. The account screen shows the address without a chevron.

**If it comes back**, the drawn screen is not enough: a new address needs a
code sent to it, and Supabase's default also wants a confirmation from the old
one. Two codes, two inboxes, and a state where neither is confirmed yet. That
needs designing before it is built.

### DR-10 · A second sport (§G8 `+ Přidat sport`)

§G8 ends with a low-emphasis `+ Přidat sport`. It is not built, because the
screen behind it does not exist: the MVP is one workspace and ice hockey.

The architecture carries multiple sports and one athlete in several of them, so
this is real work later, not a dead button. **Please design**, when it is time:
choosing a sport, the sport profile per sport, and how G8 looks with two.

### DR-11 · Language (§G15) and dark mode

Both deliberately absent, both needing input rather than a decision.

- **§G15 Jazyk** is hidden until a second locale ships.
- **Dark mode** cannot be derived from the palette: the accent and all six
  status colours land between 2.7:1 and 3.4:1 on a dark background, and every
  soft fill is a pale tint built for white. A dark theme needs its own palette
  or it stays off. The `dark:` variant is currently bound to nothing.

---

## C. One decision each

### DR-12 · Does a parent hear about a booking the coach made?

`coach/SPEC.md` §6: "Coach-added bookings: notify guardian? (not in brief)."

**Today.** No. Removal sends `BOOKING_REMOVED_BY_COACH`; being added sends
nothing, and the parent discovers the child on the list in `Moje tréninky`.

Our reading: a coach adds a child at the rink with the parent standing there,
so an e-mail is noise. Worth one sentence either way — if yes, it needs copy
and an eighth row in DR-05's table.

### DR-13 · Photographs from an iPhone

`guardian/SPEC.md` §7 assumes "5 MB, JPEG/PNG/HEIC → convert to JPEG/WebP".

**Today.** 5 MB, and JPEG, PNG or WebP. No HEIC, no conversion. An iPhone
sharing from the photo library converts to JPEG on its own; a file picked as a
file can arrive as `.heic` and is refused with `Podporujeme JPG, PNG a WebP.`.

**Please decide** whether that refusal is acceptable, or whether the sheet needs
a conversion step and a message while it runs. It is the default camera format
on every iPhone, so this is not an edge case.

### DR-14 · Confirmations we would like on the record

Each of these is live and documented in `DESIGN_DEVIATIONS.md`. A nod closes
them; an objection is a request.

1. **The mark is in the coach's header too.** §5 answers "assume no"; it was
   asked for directly and it is there.
2. **The public note is on the booking detail, not the card** (§6.5 is right —
   forty cards would carry the same sentence forty times).
3. **`Od ročníku` / `Do ročníku`** instead of the drawn bare `Od` / `Do`,
   because the series screen has a date range under those very words and a
   screen reader cannot see which panel it is in.
4. **A parent's surname is optional**, where §G16 marks it required.
5. **Every active guardian is listed on the roster**, where §K2 draws one
   `Rodič` row.
6. **Routes stay Czech** (`/treninky`, `/trener/…`), where §1 lists English
   ones. A parent reads the URL; the code is English as required.
7. **A reopened registration is allowed** and built (`Otevřít přihlašování`),
   as §6 assumes.
8. **An out-of-range athlete cannot be added manually.** §6 asks; the K7 sheet
   lists ineligible athletes with their reason and refuses them
   (`NOT_ELIGIBLE`). Capacity a coach may exceed deliberately (K7b); the birth
   years they may not, because the range is what a parent was told.
9. **Removed and cancelled bookings move to `Minulé` when the training ends**,
   not when it starts, as §G4b and §G5 draw. One rule for all three cases:
   `end_at` decides the list, status decides the badge.

---

Written 2 October 2026, against the application as it stands on
`claude/peaceful-planck-ca897a`. Anything answered here belongs in
`DESIGN_DEVIATIONS.md` (a decision taken) or in a new handoff section (a screen
to build), not in this file — this one only ever holds what is still open.
