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

### DR-15 · Deactivating a coach who leads future trainings

Carried over from v2 and still the only open question in `admin/SPEC.md` §5.

**Today.** It is allowed, with a warning that names the count before the save:
`{name} je hlavním trenérem {n} naplánovaných tréninků. Zůstane u nich uveden.`
The coach stays on those trainings and a parent keeps reading their name, which
is D-11. The alternative the spec floats is forcing a reassignment first.

**Fixed:** nothing deletes a coach, and a training always has a main coach — so
"reassign" means choosing another one per training, which is a screen that does
not exist yet.

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

## Answered in v3

DR-01 to DR-08 and DR-12 to DR-14 were answered in `DESIGN_REQUESTS_ANSWERS.md`
and are built: the coach's athletes (K12/K13), the past-trainings tab (K14), the
series screens (K15/K16), the removed-booking footers, the eight e-mails, the
shared components, the coach invitation (A1–A3c, A6, K0), the administrator role
(A3, A3d, A3e), the e-mail about a coach's booking, and HEIC photographs.

Where what shipped differs from what was drawn, and why, is in
`docs/DESIGN_DEVIATIONS.md` under "After handoff v3".
