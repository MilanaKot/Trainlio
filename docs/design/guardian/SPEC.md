# Trainlio — Guardian (parent / athlete) UI spec

Audience: Claude Code implementing the guardian app. Read `../shared/DESIGN_SYSTEM.md` first; component names below refer to it. Visual reference: `prototype.html` in this folder (screen IDs G1–G16 match this document). UI copy is Czech and must be used verbatim (quoted strings).

## 0. Scope & principles

- Mobile web / PWA, portrait, 390 px design width. On desktop render the same layout in a centered 480 px column.
- Primary flows that must feel excellent:
  1. Open app → see trainings → select child → book.
  2. Open "Moje tréninky" → understand where/when → cancel when allowed.
- One coach context in MVP: sessions appear directly (no sport/coach/venue selector).
- All times in `Europe/Prague`.

## 1. Routes (App Router)

| Screen | Route | Notes |
|---|---|---|
| G11 Login — e-mail | `/login` | public |
| G12 Login — OTP | `/login/verify?email=` | public; also reused for e-mail change verification (`/account/email/verify`) |
| G1 Trainings | `/trainings` | default after login |
| G2/G3 Booking sheet | client state on `/trainings` (or intercepting route `@modal/(.)trainings/[sessionId]/book`) | must be deep-linkable is **not** required |
| G4 My trainings — upcoming | `/my-trainings` (`?tab=upcoming` default) | |
| G5 My trainings — past | `/my-trainings?tab=past` | |
| G6 Booking detail | `/my-trainings/[bookingId]` | opening marks change as seen |
| G7 Athletes | `/athletes` | |
| G8 Athlete profile | `/athletes/[athleteId]` | |
| G9 Edit athlete | `/athletes/[athleteId]/edit` | |
| G10 New athlete | `/athletes/new` | |
| G13 Account | `/account` | |
| G16 Edit personal data | `/account/profile` | |
| G14 Change e-mail | `/account/email` | then OTP |
| G15 Language | `/account/language` | hidden in MVP (only Czech) |

Route names are English for the codebase; all visible text is Czech. Bottom nav on G1, G4/G5, G7, G13. Pushed screens (G6, G8–G10, G14–G16) show a back row instead of the nav.

## 2. Data needed (view models)

Suggested TS shapes (derive from Supabase queries; validate with Zod at the boundary).

```ts
type HallCode = "MH" | "VH"; // MH = Malá hala, VH = Velká hala
type SessionStatus = "open" | "closed" | "cancelled"; // draft never reaches guardians; completed = past

interface SessionSummary {
  id: string;
  startsAt: string; endsAt: string;          // ISO, UTC
  place: string;                              // "Příbram"
  hall: HallCode;
  changingRoom: string | null;                // "4"
  eligibility: { kind: "all" } | { kind: "years"; from: number; to: number };
  capacity: number;
  bookedCount: number;                        // realtime
  status: SessionStatus;
  publicNote: string | null;                  // "Informace pro sportovce"
  mainCoach: { id: string; firstName: string; lastName: string };
  assistants: { id: string; firstName: string; lastName: string }[];
}

interface Athlete {
  id: string; firstName: string; lastName: string; birthDate: string; photoUrl: string | null;
  sportProfiles: SportProfile[];
}
type SportProfile =
  | { sport: "ice_hockey"; club: string | null; team: string | null;
      position: "goalie" | "defense" | "center" | "left_wing" | "right_wing" | "utility" | null;
      stick: "left" | "right" | "unknown" | null; jerseyNumber: number | null }
  | { sport: "football" /* fields TBD */ };

type BookingStatus =
  | "active"
  | "cancelled_by_guardian"        // parent cancelled ("Odhlášeno")
  | "removed_by_coach"             // coach removed this athlete; session still happens ("Odhlášeno trenérem")
  | "cancelled_by_coach_session";  // whole session cancelled ("Zrušeno trenérem")
// removed_by_coach also carries: removedBy {firstName,lastName}, removedAt, coachMessage: string | null (≤200)
interface Booking {
  id: string; session: SessionSummary; athlete: Pick<Athlete, "id" | "firstName" | "lastName">;
  status: BookingStatus; createdAt: string; createdBy: { firstName: string; lastName: string };
  cancelledAt: string | null; cancelledBy: { firstName: string; lastName: string } | null;
  significantChange: { field: "date" | "time" | "place" | "hall" | "main_coach"; oldValue: string; newValue: string; changedAt: string } | null;
  changeSeenAt: string | null;                // "Změněno" shown while significantChange && !changeSeenAt
}
```

Derived values:
- `cancelDeadline = startsAt − 12 h`. `canCancel = now < cancelDeadline && booking.status === "active" && session.status !== "cancelled"`.
- `isEligible(athlete, session)` = eligibility.kind === "all" || birthYear ∈ [from, to].
- `remaining = max(0, capacity − bookedCount)`.

## 3. Global behaviour

- **Realtime occupancy:** subscribe to `bookedCount` for visible sessions (Supabase Realtime). Update quietly (CapacityMeter animation only). No toast.
- **Booking conflict while sheet open:** if remaining drops below the number of selected athletes, show G3 notice inline without closing the sheet.
- **Atomic multi-child booking:** one server call books all selected athletes or none. Never partially book.
- **Errors:** map codes → copy per DESIGN_SYSTEM §11.
- **Loading:** skeleton cards on first load; optimistic UI is **not** used for booking/cancel (wait for server, show button loading state).

---

## 4. Screens

### G11 · Login — e-mail (`/login`)
Layout: wordmark "trainlio" (Barlow 36/700 + 8 × 17 cobalt bar), H1 `Přihlášení`, text `Zadejte svůj e-mail. Pošleme vám jednorázový kód, heslo nepotřebujete.`, field `E-mail` (type email, `autocomplete="email"`, placeholder `jmeno@email.cz`), primary lg `Poslat kód`.
Behaviour: Zod email validation; invalid → field error `Zadejte platný e-mail.`; submit → Supabase `signInWithOtp({ email })` → navigate to G12. Loading label `Posílám…`.
Acceptance: Enter submits; error tied to field; button disabled while sending.

### G12 · Login — OTP code (`/login/verify`)
Layout: back arrow (to G11), H1 `Zadejte kód`, text `Poslali jsme ho na {email}` (email bold), 6 digit boxes (60 px high, Barlow 30/700, gap 8), primary lg `Přihlásit se` (disabled until 6 digits), row: `Poslat znovu za 0:42` (countdown, then link `Poslat znovu`) and link `Změnit e-mail` (→ G11 prefilled).
Behaviour: single hidden `<input inputmode="numeric" autocomplete="one-time-code" maxlength=6>` driving the boxes; paste fills all; auto-submit on 6th digit (button remains as fallback). Wrong code → boxes error style + `Kód není správný. Zkuste to znovu.`; expired → `Platnost kódu vypršela. Pošlete si nový.`
Open: code length (6 assumed) and resend interval (60 s assumed).

### G1 · Trainings (`/trainings`)
Header: H1 `Tréninky`, meta `Lední hokej · Příbram`.
List: upcoming sessions (status open/closed) grouped by day, ascending. Group heading `text-date` in **primary** (`Neděle 27. září`); today adds TodayChip `Dnes` (green). Cancelled sessions are hidden here unless the guardian has a booking (then they appear in My trainings instead).
Card: TrainingCard (see DS §6.5). Footer button (always 124 × 44) — decide by first matching rule:

| Condition | Button | Extra |
|---|---|---|
| session.status = closed | none — replace with `Přihlašování uzavřeno` (lock icon, muted) | meter `closed` |
| remaining = 0 | `Obsazeno` disabled | meter `full` (cobalt) — **no extra badge** |
| guardian has ≥1 child booked AND has another eligible, unbooked child | secondary `Přihlásit` | BookedChip(s) `Přihlášen: {name}` |
| guardian has ≥1 child booked AND no other eligible unbooked child | disabled `Přihlásit` | BookedChip(s) |
| no eligible child at all | disabled `Přihlásit` + meta line `Žádný z vašich sportovců nesplňuje ročníky` | |
| otherwise | primary `Přihlásit` | |

Last places: meter `lastPlaces` + hint `Zbývá {n} místo/místa/míst` (warning) above the footer.
Empty: EmptyState `Momentálně nejsou vypsané žádné tréninky.`
Guardian without athletes: EmptyState `Přidejte prvního sportovce a můžete začít rezervovat tréninky.` + `Přidat sportovce` (→ G10) shown above the list; buttons on cards disabled.
Tap `Přihlásit` → G2. If exactly one eligible unbooked athlete exists, still open G2 with that athlete preselected (one-tap confirm; brief allows simplified flow).

### G2 · Booking sheet "Koho chcete přihlásit?"
BottomSheet. Title `Koho chcete přihlásit?` (Barlow 28/32), close button.
Summary box (bg): `Neděle 4. října · 09:00–10:00` (15/700), meta `Příbram · MH · Šatna 4`; right: count `7 / 10` + `3 volná místa`.
Athlete PickerRows (checkbox), sorted: eligible first, then ineligible:
- eligible & not booked → selectable (preselect if it is the only one);
- already booked → disabled, meta `{year} · Už přihlášen` ;
- ineligible → disabled, meta `{year} · mimo ročníky {from}–{to}`.
Deadline line (clock icon, meta): `Odhlásit lze do {formatDeadline(startsAt−12h)}` (e.g. `soboty 3. října 21:00`).
CTA primary lg: `Přihlásit {n} sportovce/sportovců` (plural rules); disabled when n = 0.
Submit → atomic booking RPC. Success → close sheet, toast `Přihlášeno`, card updates (BookedChip). Errors → see G3 / DS §11 (render inside sheet as Notice, keep selection).

### G3 · Not enough places (state of G2)
Trigger: selected n > remaining (client check before submit, and server `NOT_ENOUGH_PLACES`).
Summary count shows `9 / 10` + `1 volné místo` (warning, 600).
Notice warning (`role="alert"`) under summary: title `Není dostatek volných míst`, text `Na tréninku zbývá pouze 1 místo. Vyberte prosím jednoho sportovce.` (use `{n} místa / sportovce` plurals).
CTA disabled until n ≤ remaining. This is a normal state — no red.

### G4 · My trainings — upcoming (`/my-trainings`)
H1 `Moje tréninky`; SegmentedControl (tablist) `Nadcházející | Minulé`.
List of BookingCards (one card per booking, i.e. per child), ascending by start. Each card: avatar + name + (badge) + chevron; time; date line (`Neděle 27. září · Dnes` / `Středa 7. října`); meta `Příbram · VH · Šatna 2`.
Footer:
- `canCancel` → hint (clock) `Odhlásit lze do {deadline}` + outline `Odhlásit` (124 px).
- deadline passed → text (ink, 600, info icon) `Odhlášení již není možné. Kontaktujte trenéra.` + **disabled** `Odhlásit` (124 px, neutral).
Changed booking (`significantChange && !changeSeenAt`): badge warning `Změněno` next to name; the changed value highlighted (warning-soft bg, warning text), meta starts with `Původně {oldValue}`.
Cancel flow: tap `Odhlásit` → confirm Dialog: title `Odhlásit {Jméno}?`, text `{date} · {time}`, buttons `Ponechat` (outline) / `Odhlásit` (primary). Success → toast `Odhlášeno`; booking moves to Minulé as self-cancelled.
Tap card → G6 (marks change seen).

**G4b · Removed by coach** (`removed_by_coach`, session in the future): card stays in Nadcházející until session start.
- Muted card (`#F8F9FB` + 1 px line border), avatar/name/time/date muted, **no strike-through** (the session still takes place).
- Badge **warning (orange)** `Odhlášeno trenérem` + chevron.
- Meta `Odhlásil {coach name} · {d. m. HH:MM}`.
- Footer: hint `Místo je volné, můžete přihlásit znovu.` + **secondary** 124 px `Přihlásit` → opens G2 with this athlete preselected. If the session is full/closed/past deadline: hint `Znovu přihlásit nelze — trénink je obsazený.` / `…přihlašování je uzavřené.` and disabled `Přihlásit`.
- After re-booking, the removed booking disappears from Nadcházející (history keeps it; show in Minulé only if the athlete ends up not attending).
- Guardian receives an e-mail: subject `Odhlášení z tréninku {Ne 4. 10.}`, body `Trenér {coach} odhlásil sportovce {athlete} z tréninku {Ne 4. 10. · 09:00–10:00, Příbram · MH}.` + coach message if present + link to G6d.
Empty: `Zatím nemáte žádný nadcházející trénink.` + button `Najít trénink` (→ G1).

### G5 · My trainings — past (`?tab=past`)
Same list, descending. Variants (DS §6.6):
- attended/finished — normal card, no badge (don't emphasise "completed");
- cancelled by coach — muted card, struck time & date, danger badge `Zrušeno trenérem`, meta `Trénink se nekonal · {place}`;
- removed by coach (after the session started) — same as G4b but without footer; orange badge `Odhlášeno trenérem`;
- self-cancelled — muted card, no strike, neutral badge `Odhlášeno`, meta `Odhlásil {guardian name} · {d. m. HH:MM}` (always masculine form — DS §8).
Upcoming sessions cancelled by the coach also appear in **Nadcházející** until their start time with the cancelled styling (so parents notice), then move to Minulé.

### G6 · Booking detail (`/my-trainings/[bookingId]`)
Back row `‹ Moje tréninky`. Header: avatar + athlete name; time (`text-hero`); date (24/30/700).
Change notice (only if `significantChange`, regardless of seen state, until session start): warning Notice, clock icon, title `Trenér změnil {čas | datum | místo | halu | hlavního trenéra}` e.g. `Trenér změnil čas tréninku`, text `Původně 17:00–18:00, nově 17:30–18:30.`, meta `Změněno 26. 9. v 14:10`.
DetailList: `Místo` (`Příbram · Malá hala (MH)`), `Šatna`, `Ročníky`, `Hlavní trenér`, `Asistenti` (names stacked one per line; `—` muted when none — row always visible), `Obsazenost` (meter + count).
Section `INFORMACE PRO SPORTOVCE` (caption) + public note text (only if present).
Sticky footer: deadline hint + outline lg `Odhlásit` — or, when locked (G6c), text `Odhlášení již není možné. Kontaktujte trenéra.` (ink, info icon) + disabled lg `Odhlásit`.
On mount: `update bookings set change_seen_at = now()` when a change is unseen (badge disappears in G4 afterwards).
Cancelled-by-coach booking: header strike-through + danger Notice `Trénink byl zrušen trenérem.`; no footer.

**G6d · Removed by coach:** header muted (no strike) + orange badge `Odhlášeno trenérem` next to the name. Warning Notice (person-minus icon): title `Trenér odhlásil sportovce z tréninku`, text `Trénink se koná, ale {athlete} na něm není přihlášen.`, meta `Odhlásil {coach} · {d. m.} v {HH:MM}`. If `coachMessage`: section caption `ZPRÁVA OD TRENÉRA` + text. DetailList (Místo, Šatna, Hlavní trenér, Obsazenost — no Asistenti row needed). Sticky footer: helper `Místo je volné, sportovce můžete přihlásit znovu.` + primary lg `Přihlásit znovu` (→ G2 with athlete preselected); when not possible → disabled + reason (as G4b). No "Odhlásit" action.
Screen may exceed 844 px → page scrolls; footer stays fixed.

### G7 · Athletes (`/athletes`)
H1 `Moji sportovci`. Cards (link, chevron): avatar 56 (photo or initials), name 17/700, birth date `8. 6. 2017`, sport chips (neutral-50, 13/600): `Lední hokej · Centr` (position appended when set), `Fotbal`.
Below list: block button (primary-100 bg, primary text, 52 px) `+ Přidat sportovce` → G10.
Empty: EmptyState `Přidejte prvního sportovce a můžete začít rezervovat tréninky.` + `Přidat sportovce`.

### G8 · Athlete profile (`/athletes/[id]`)
Top row: `‹ Moji sportovci` and text button `Upravit` (→ G9).
Header: avatar 72, name (Barlow 36/40), `Narozen {date}` (masculine form for everyone — DS §8).
Caption `SPORTY`. Hockey panel: title `Lední hokej`; DetailList rows `Klub`, `Tým / kategorie`, `Pozice`, `Hůl`, `Číslo dresu` (empty → `—`).
Other sports: collapsed row per sport with chevron (e.g. `Fotbal ›`).
Text button `+ Přidat sport` (low emphasis; multi-sport must not be over-emphasised in MVP).

### G9 · Edit athlete (`/athletes/[id]/edit`) · G10 New athlete (`/athletes/new`)
Top: text link `Zrušit`. Title `Upravit sportovce` / `Nový sportovec`.
Photo row: avatar 72 (initials or empty silhouette for new) + text button `Přidat fotografii` (`Změnit fotografii` when set) + `Nepovinné`. Upload: image/*, client resize to 512 px, Supabase Storage; removal option `Odebrat fotografii`.
Panel: `Jméno`, `Příjmení`, `Datum narození` (date input, display `d. m. rrrr`, placeholder `dd. mm. rrrr`, calendar icon).
Caption `LEDNÍ HOKEJ`. Panel:
- `Klub` (Nepovinné, placeholder `Např. název klubu`)
- `Tým / kategorie` (Nepovinné, placeholder `Např. U10`)
- `Pozice` — radio grid 2 columns (44 px pills): `Brankář`, `Obránce`, `Centr`, `Univerzál`, `Levé křídlo`, `Pravé křídlo`. **No free text.**
- `Hůl` — radio row 3 columns: `Levá`, `Pravá`, `Nevím`. (Brief lists `Levé/Pravé/Nevím`; design uses `Levá/Pravá` to agree with "hůl" — confirm with product.)
- `Číslo dresu` (Nepovinné, numeric 0–99, half width)
Selected pill: primary-100 bg, 2 px primary inset, primary text + check icon.
Sticky footer primary lg: `Uložit` (G9) / `Přidat sportovce` (G10).
Validation (Zod): first/last name required (1–50 chars); birth date required, not in future, not before 1940; jersey 0–99 integer. Errors per DS §6.10.
After G10 success → G7 with toast `Sportovec přidán`.

### G13 · Account (`/account`)
H1 `Účet`. Profile card: avatar 56 (initials), name 17/700, meta `Rodič`, text button `Upravit` (→ G16).
List (links with chevron): `E-mail · {email}` (→ G14); `Telefon · Přidat` (primary text when empty, else the number) (→ G16); `Jazyk · Čeština` (→ G15, **hide while only one locale exists**).
Button (white, danger text, 52 px): `Odhlásit se z aplikace` → confirm dialog `Odhlásit se z aplikace?` `Zrušit` / `Odhlásit se` → Supabase signOut → G11. (Full wording is required: "Odhlásit" alone means cancelling a training.)

### G16 · Edit personal data (`/account/profile`)
Top `Zrušit`; title `Upravit údaje`. Fields: `Jméno`, `Příjmení` (required — shown to coaches as "Přihlásil …"), `Telefon` (Nepovinné, **visible to coaches** of sessions where the guardian's athlete is booked, `type="tel"`, placeholder `+420 123 456 789`, E.164 validation, helper `Trenér vás může kontaktovat, když se trénink změní na poslední chvíli.`). Footer `Uložit` → toast `Uloženo`.

### G14 · Change e-mail (`/account/email`)
Back `‹ Účet`; title `Změna e-mailu`; box `Současný e-mail` + value; field `Nový e-mail` (focus); helper `Na nový e-mail pošleme kód pro ověření. Dokud ho nezadáte, zůstane platný současný e-mail.`; primary lg `Poslat kód` → Supabase `updateUser({ email })` → G12 variant (title `Zadejte kód`, text `Poslali jsme ho na {newEmail}`) → success toast `E-mail změněn` → G13.

### G15 · Language (`/account/language`) — post-MVP
Radio list rows 60 px: `Čeština` (selected), `English` (sub `Angličtina`, `lang="en"`). Helper `Jazyk se změní ihned. E-maily vám budeme posílat ve zvoleném jazyce.` Persist to profile; apply immediately.

---

## 5. Notifications the guardian receives (for copy consistency)
E-mail (not designed here): booking confirmation (optional), significant session change, session cancelled by coach, eligibility change affecting their athlete. In-app, changes show via `Změněno` badge + G6 notice; cancellations via cancelled card styling.

## 6. Acceptance tests (Playwright, mobile viewport 390×844)
1. Guardian with 2 eligible kids books both on a session with ≥2 places → both BookedChips visible; count +2.
2. Session with 1 place, 2 kids selected → G3 notice, CTA disabled; unselect one → CTA `Přihlásit 1 sportovce` enabled; booking succeeds.
3. Ineligible child visible but disabled with reason; cannot be selected via keyboard.
4. Booking < 12 h before start → no active cancel button; locked text visible in G4 and G6.
5. Coach changes time → G4 shows `Změněno`; after opening G6 and returning, badge gone; G6 notice still shows old/new time.
6. Coach cancels session → card in G4/G5 struck through with `Zrušeno trenérem`; self-cancelled booking shows `Odhlášeno` without strike-through.
7. Full session → `Obsazeno` disabled button, cobalt meter, no duplicate badge.
7b. Coach removes a child → e-mail sent; G4 card shows orange `Odhlášeno trenérem`, no strike-through; `Přihlásit` re-opens G2 with that child preselected; after re-booking the card returns to the normal state.
8. All card buttons measure 124 × 44.
9. Axe: no serious violations on G1, G2, G4, G6, G9.

## 7. Assumptions & open questions (confirm before build)
- OTP length 6, resend after 60 s.
- Cancelled-by-coach upcoming sessions stay in "Nadcházející" until start.
- `Hůl` option labels (`Levá/Pravá` vs brief `Levé/Pravé`).
- Photo storage limits (5 MB, JPEG/PNG/HEIC → convert to JPEG/WebP).
- Language screen hidden until a second locale ships.
