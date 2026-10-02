# Trainlio — Coach UI spec

Audience: Claude Code implementing the coach app. Read `../shared/DESIGN_SYSTEM.md` first. Visual reference: `prototype.html` (screen IDs K0–K16 + A0). Admin-only coach management is in `../admin/SPEC.md`. UI copy is Czech, verbatim.

## 0. Scope & principles

- Primary flows that must feel excellent:
  1. Open app → immediately understand today's/upcoming trainings and occupancy.
  2. Open training → see roster.
  3. Create several recurring trainings quickly.
  4. Make a schedule change and clearly understand who will be notified.
- Mobile-first; works on desktop with a two-pane layout (DS §9).
- Chronological list, not a calendar. No dashboards.

## 1. Routes

| Screen | Route |
|---|---|
| K1 Training list | `/coach/trainings` |
| K10 Create sheet (FAB) | client state on K1 |
| K2 Session detail + roster | `/coach/trainings/[sessionId]` |
| K7 / K7b Add athlete sheet + override dialog | client state on K2 |
| K5 / K5b Close registration sheet / closed state | client state on K2 |
| K6 / K6b Cancel dialog / cancelled state | client state on K2 |
| K3 Edit training (+ K3b, K3c, K8, K9) | `/coach/trainings/[sessionId]/edit` |
| New single training (= K3 empty) | `/coach/trainings/new` |
| K4 Duplicate — single | `/coach/trainings/new?from=[sessionId]` |
| K4b Duplicate — period | `/coach/trainings/new?from=[sessionId]&mode=period` |
| K11 Create series | `/coach/trainings/new?mode=series` |
| K14 Past trainings | `/coach/trainings?tab=past` (implemented as `/trener?tab=minule`) |
| K12 Athletes tab | `/coach/athletes` |
| K13 Athlete (coach view) | `/coach/athletes/[athleteId]` |
| K15 / K15b Series list / empty | `/coach/series` |
| K16 Trainings of one series | `/coach/series/[seriesId]` (filtered list) |
| K0 First sign-in welcome | `/coach/welcome` (shown once, then `/coach/trainings`) |
| A0 More | `/coach/more` (see admin spec for Trenéři) |

Bottom nav (3): `Tréninky`, `Sportovci`, `Více`.

## 2. Data (in addition to guardian types)

```ts
interface CoachSession extends SessionSummary {
  status: "draft" | "open" | "closed" | "cancelled";
  internalNote: string | null;                 // coach/admin only — NEVER sent to guardian clients
  cancelledAt: string | null; cancelledBy: { firstName: string; lastName: string } | null;
  roster: RosterEntry[];
}
interface RosterEntry {
  bookingId: string;
  athlete: { id: string; firstName: string; lastName: string; birthYear: number;
             position: string | null; stick: "left" | "right" | "unknown" | null; club: string | null };
  createdAt: string;
  createdBy: { kind: "guardian"; firstName: string; lastName: string } | { kind: "coach"; firstName: string; lastName: string };
  guardian: { firstName: string; lastName: string; phone: string | null }; // coaches may see the phone (decided)
}
interface Coach { id: string; firstName: string; lastName: string; active: boolean; isAdmin: boolean;
                 phone: string | null }   // v3: optional; shown to guardians only in G6d (removed-by-coach footer)
interface CoachAthleteRow {             // K12
  id: string; firstName: string; lastName: string; birthYear: number;
  position: string | null; active: boolean; upcomingBookings: number;
}
interface Series { id: string; weekdays: (0|1|2|3|4|5|6)[]; startTime: string; endTime: string;
                   from: string; to: string; place: string; hall: "MH" | "VH"; room: string | null;
                   yearFrom: number | null; yearTo: number | null;
                   total: number; remaining: number }   // remaining = occurrences with start > now
```

Security: `internalNote` must be excluded from any query/RLS policy reachable by guardians (separate column with coach-only RLS or separate table).

Significant change fields (trigger guardian notification + "Změněno"): `date`, `start/end time`, `place`, `hall`, `mainCoach`. Changing room, capacity, notes and assistants are **not** significant (no alert).

---

## 3. Screens

### K1 · Training list (`/coach/trainings`)
H1 `Tréninky`, meta `Lední hokej · Příbram`.
Day groups (heading `text-date` primary; today + TodayChip `Dnes`). Rows = CoachTrainingRow (DS §6.7), whole row links to K2, chevron:
- left: time (Barlow 26/30), meta `MH · Šatna 4 · 2017–2018` (`Všichni` when no year limit), optional status line (13/600): `Nad kapacitu` (muted) · lock + `Přihlašování uzavřeno` (muted) · `Koncept` badge for drafts;
- right: count (Barlow 22/700) + mini meter (6 × 12 segments) — colors per CapacityMeter rules (full = cobalt, over = neutral `+N` pill);
- cancelled: muted card, struck time, danger badge `Zrušeno` instead of meter.
Below the header a **SegmentedControl** (`role="tablist"`) `Nadcházející` / `Minulé` (v3, DR-02) — same component as guardian G4/G5. `Minulé` → K14.
FAB `+ Vytvořit` → K10 (only on `Nadcházející`). Empty: `Zatím nemáte žádné tréninky.` + `Vytvořit trénink`.

### K14 · Past trainings (`?tab=past`) — v3, DR-02
Same header + segmented control (`Minulé` active). Day groups **descending** (newest first), same heading style. No FAB.
Row = CoachTrainingRow variant `past`: left time + meta as K1; right **count only** — Barlow 22/700 number + 12 px muted label below, Czech plural: `1 přihlášený`, `2–4 přihlášení`, `5+ přihlášených`, `0 přihlášených`. **No meter** (free places no longer matter; there is no attendance tracking — never imply who came).
Cancelled session: as in K1 (muted, struck time, danger `Zrušeno`) → K6b.
Row → K2 (read-only roster; all edit actions hidden for past sessions).
Paging: load 20 days at a time, infinite scroll; empty `Zatím žádné odehrané tréninky.`

### K12 · Athletes (`/coach/athletes`) — v3, DR-01
H1 `Sportovci` + meta right `{n} aktivních`.
SearchField (DS §6.27) `Hledat jméno nebo rodiče` — matches athlete first/last name and guardian names, diacritics-insensitive (`normalize("NFD")`). Always visible.
FilterChips (DS §6.28) by birth year: `Všechny` + one chip per year present (single select). Horizontal scroll when they overflow.
List grouped by **ročník**, ascending (`Ročník 2017`, `Ročník 2018` …), heading `text-date` primary + right `{n} sportovců`; inside a group sorted by last name (`Intl.Collator("cs")`).
Row (64 px, white list panel): Avatar 40 + name 16/600 + meta 13 muted `{position or "Pozice nevyplněna"} · {upcomingBookings} nadcházející` (`bez přihlášek` when 0) + chevron → K13.
Deactivated athletes: separate group `Neaktivní` at the bottom (heading muted), muted avatar/name, meta `Ročník {y} · deaktivoval rodič`.
No phone on the row (it is on the roster and in K13). Empty (no athletes at all): `Zatím tu nejsou žádní sportovci. Přidávají je rodiče ve své aplikaci.`
**Fixed:** coaches cannot create athletes or guardian accounts — no add button.

### K13 · Athlete — coach view (`/coach/athletes/[id]`) — v3, DR-01
Back `‹ Sportovci`. Header: Avatar 72 (photo if present) + H1 name (Barlow 36/40) + meta `Ročník {y} · narozen {d. m. yyyy}`.
Caption `LEDNÍ HOKEJ` (sport name) → DetailList: `Pozice`, `Hůl`, `Číslo dresu`, `Tým / kategorie` (`—` when empty).
Caption `RODIČE` → panel, one row per active guardian: name 15/700 + meta `{relation} · {phone}`; when phone present two 44 × 44 icon buttons (primary-100 bg, primary icon) `tel:` and `sms:` with `aria-label="Zavolat {name}"` / `Napsat SMS {name}`; no phone → meta `… · telefon nevyplněn`, no buttons.
**Internal note** panel (same style as K2: `#FBF7EC` + inset `#E9D9A8`, caption with lock `INTERNÍ POZNÁMKA · JEN TRENÉŘI`) + text button `Upravit poznámku` → inline textarea (200 chars, counter). **Fixed:** `internal_notes` never reaches guardians (D-13).
Caption `NADCHÁZEJÍCÍ TRÉNINKY · {n}` → list rows (time Barlow 20 + `Ne 4. 10. · MH` + chevron → K2). Text link `Minulé tréninky ({n})` → same list for the past.
**Read-only** otherwise (decided): no deactivate, no profile edit — the parent does that in their app.

### K15 · Series list (`/coach/series`) — v3, DR-03
Entry: A0 `Více` → section `PLÁNOVÁNÍ` → row `Série tréninků` (value = number of running series). Visible to all coaches.
Back `‹ Více`; header H1 `Série` + primary md button `+ Nová série` (→ K11, `white-space: nowrap`).
Helper text (muted): `Tréninky ze série jsou po vytvoření samostatné. Upravit je můžete jednotlivě.`
Captions `PROBÍHAJÍCÍ · {n}` (to ≥ today) and `UKONČENÉ · {n}` (muted cards).
Series card (whole card → K16): WeekdayBadges (DS §6.29) · time Barlow 26/30 · meta `MH · Šatna 4 · 2017–2018` · meta 13 `{from} – {to} · {total} tréninků, zbývá {remaining}` (ended: `{total} tréninků`).
### K15b · Series — empty
EmptyState: calendar icon tile, `Zatím nemáte žádnou sérii.`, text `Série vytvoří tréninky na celé období najednou — například každé úterý a čtvrtek do Vánoc.`, primary `+ Nová série`.

### K16 · Trainings of one series (`/coach/series/[id]`) — v3, DR-03
Back `‹ Série tréninků`. Header: WeekdayBadges, H1 time (Barlow 36/40), line 15/600 `Úterý a čtvrtek · {from} – {to}`, meta place/years.
SegmentedControl `Nadcházející · {n}` / `Minulé · {n}`. Rows = CoachTrainingRow (count `9 / 12`, chevron → K2). A training edited individually after creation shows status line `Upraveno mimo sérii` (muted 13/600).
Footer note (muted 13): `Celou sérii nelze upravit ani zrušit najednou. Každý trénink otevřete a upravte zvlášť.` **Fixed:** no series editing.

### K0 · First sign-in (`/coach/welcome`) — v3, DR-07
Shown once after the coach's first successful OTP sign-in (`coach.firstSignInAt` was null). OrgLogo 72 · H1 `Vítejte v týmu` · text `Jste přihlášen jako trenér v organizaci {org}.` · panel: Avatar 44 + name + meta `Trenér · {n} naplánované tréninky`; helper `Nesedí jméno? Napište administrátorovi {admin name}.`; field `Váš telefon` (Nepovinné, helper `Uvidí ho rodiče, jejichž dítě z tréninku odhlásíte.`). Footer primary lg `Pokračovat na tréninky` → saves phone if filled → K1.

### K10 · Create sheet
BottomSheet title `Vytvořit`; two option rows (72 px, icon tile 44 primary-100, title 17/700, sub 14 muted, chevron):
- `Trénink` / `Jeden termín` → `/coach/trainings/new`
- `Série tréninků` / `Opakovaně, např. každou neděli` → K11.

### K2 · Session detail + roster (`/coach/trainings/[id]`)
Back `‹ Tréninky`. Page scrolls (tall).
1. Header: date (20/28/700 primary) + TodayChip; time `text-hero`; meta `Příbram · Malá hala (MH) · Šatna 4 · Ročníky 2017–2018`. Closed → neutral chip with lock `Přihlašování uzavřeno`.
2. Capacity panel: caption `OBSAZENOST`, meter (9 × 16), count Barlow 32.
3. Coaches DetailList: `Hlavní trenér`, `Asistenti` (names stacked; `—` if none).
4. Public note panel: caption with globe icon `INFORMACE PRO SPORTOVCE · VIDÍ RODIČE`, text.
5. Internal note panel (only if present): `internal` bg + border, caption with lock `INTERNÍ POZNÁMKA · JEN TRENÉŘI` (internal-ink), text.
6. Roster: heading `Sportovci {n}` + small secondary button `+ Přidat sportovce` (→ K7). Rows (link to athlete detail, not designed): avatar 36, name 16/700, line `2017 · Centr · Levá hůl` (omit missing parts), meta 12 `Přihlásil Milana Kotova · 27. 9. 18:42` or `Přidal trenér Milan Filipi · 24. 9. 17:30` (always masculine form — DS §8). Club is not in the default row. Sorted by booking time.
   Tap row → BottomSheet "athlete in session": avatar, name, `2017 · Centr · Levá hůl`, `Klub` (if set), DetailList `Rodič` (name), `Telefon` (number or `—`), `Přihlášeno` (date-time). If phone exists: primary lg `Zavolat {phone}` (`<a href="tel:…">`) + outline lg `Poslat SMS` (`sms:`). Bottom: outline-danger `Odhlásit z tréninku` → confirm Dialog: title `Odhlásit sportovce z tréninku?`, line `{athlete} · Ne 4. 10. · 09:00`, optional Textarea `Zpráva pro rodiče` (Nepovinné, max 200, counter), info line (mail icon) `Rodič dostane e-mail. Sportovce bude moci znovu přihlásit, pokud bude volné místo.`, buttons `Ponechat` (outline, initial focus) · `Odhlásit` (primary). Result: booking status `removed_by_coach`, place is freed immediately (bookedCount −1), guardian e-mailed; roster row disappears and a toast `Sportovec odhlášen` shows. Guardian UI: see guardian SPEC G4b / G6d. Phone numbers are shown only to coaches/admins of the workspace (RLS).
7. Caption `AKCE` + list (56 px rows, icon + label): `Upravit trénink` (→ K3), `Duplikovat` (→ K4), `Zavřít přihlašování` (→ K5) / `Otevřít přihlašování` when closed.
8. Separated by 32 px, outline-danger lg button `Zrušit trénink` (→ K6).
Empty roster: text `Zatím nikdo není přihlášený.`

### K7 · Add athlete (sheet)
Tall BottomSheet (top offset 48). Title `Přidat sportovce`. Summary bar: `Ne 27. 9. · 16:00 · 2017–2018` + mini meter + `8 / 10`. Search input (48 px, neutral-50, search icon, placeholder `Hledat jméno`, filters client-side by name). Helper `Sportovci z ročníků 2017–2018, kteří ještě nejsou přihlášení`.
PickerRows (checkbox): avatar, name, `2018 · Obránce · Levá hůl`, meta 12 `Rodič: Hana Procházková`. Multi-select.
CTA primary lg `Přidat {n} sportovce/sportovců`.
- If `bookedCount + n ≤ capacity` → add immediately (no extra confirmation), toast `Přidáno`, roster updates, `createdBy = coach`.
- Else → K7b.
Out-of-range athletes are not listed in MVP (open question: allow toggle `Zobrazit i mimo ročníky`).

### K7b · Capacity override (dialog)
Dialog, warning icon tile (triangle). Title `Trénink je již plný`. Meter box: 10 cobalt segments + one empty segment with 2 px warning-fill border; right `10 / 10 → 11` (arrow part warning 14/700).
Text `Chcete sportovce přidat nad stanovenou kapacitu?` + next line name bold + `· 2018` muted (list up to 3 names, then `+ N dalších`). Helper muted `Kapacita se nezmění. Trénink bude mít 11 sportovců a rodiče se dál přihlásit nemohou.`
Buttons: `Zrušit` (outline) · `Přidat` (primary). Initial focus `Zrušit`.

### K5 · Close registration (sheet)
Icon tile (lock) + title `Zavřít přihlašování?` + meta `Ne 27. 9. · 16:00–17:00 · 8 / 10`. Consequences list (icon + 15/22):
- ✕ (danger) `Noví sportovci se už nebudou moci přihlásit.`
- ✓ (success) `8 přihlášených sportovců zůstane.`
- ✓ (success) `Vy můžete sportovce dál přidávat ručně.`
- ↺ (muted) `Přihlašování můžete kdykoli znovu otevřít v detailu tréninku.`
Buttons stacked: primary lg `Zavřít přihlašování`, outline lg `Nechat otevřené`.
No guardian notification.

### K5b · Registration closed (state of K2)
Header chip `Přihlašování uzavřeno`; meter `closed` (subtle fill, muted count); action row becomes `Otevřít přihlašování` (primary text color, unlock icon). Toast `Přihlašování uzavřeno` (success icon, **no undo**). Reopen → toast `Přihlašování znovu otevřeno`.
Assumption: guardians may still self-cancel before the 12 h deadline while closed.

### K6 · Cancel training (dialog)
Centered alertdialog, scrim-strong. Danger icon tile. Title `Zrušit trénink?`; line `Ne 27. 9. · 16:00–17:00 · MH` (15/600). Text (brief, verbatim) `Trénink zůstane v historii a všichni rodiče přihlášených sportovců obdrží e-mail.` Info box: mail icon `E-mail dostanou rodiče 8 sportovců`; danger line `Zrušený trénink už nelze znovu otevřít`.
Buttons stacked: outline lg `Nezrušovat` (top, initial focus), danger lg `Zrušit trénink`.
Success → K6b + e-mails to all guardians of booked athletes.

### K6b · Cancelled training (state of K2)
Danger Notice at top: caption `ZRUŠENO TRENÉREM`, text `Zrušil Milan Filipi · 27. 9. 14:20. Rodiče 8 sportovců dostali e-mail.` Date + time struck through (muted/subtle). Roster collapsed & muted: `Byli přihlášeni 8`, first 3 names + `+ 5 dalších` (expandable). Actions: only `Duplikovat jako nový trénink` (→ K4). No edit, no reopen.

### K3 · Edit training (`/edit`) — also the "new training" form
Top `Zrušit` (back to K2 with discard-confirm if dirty: `Zahodit změny?` `Pokračovat v úpravách` / `Zahodit`). Title `Upravit trénink` (`Nový trénink` for create).
Panels with captions:
- `KDY`: `Datum` (date picker, `Neděle 27. 9. 2026`), `Začátek` / `Konec` (time, 2 columns). Validation: end > start.
- `KDE`: `Místo` (select, default `Příbram`), `Hala` (segmented `MH Malá hala` / `VH Velká hala`), `Šatna` (Nepovinné, half width).
- `KDO`: `Kapacita` (Stepper, default 10), `Pro koho?` (segmented `Všichni sportovci` / `Ročníky`), when Ročníky: `Od` / `Do` selects (years, `Od ≤ Do`).
- `TRENÉŘI`: `Hlavní trenér` (select-like field → K3c); `Asistenti` (Nepovinné) chips + `+ Přidat asistenta` (→ K3b).
- `POZNÁMKY`: `Informace pro sportovce · vidí rodiče` (globe icon; textarea; max 200; counter `55 / 200`; default text for new trainings `Přineste si láhev s vodou. Sraz 15 minut před začátkem.` with helper `Výchozí text, můžete ho upravit`). `Interní poznámka · jen trenéři` (lock icon, internal styling, max 200, counter).
Label rows sit **above** segmented controls (not inside).
Changed fields in edit mode: warning outline + `Původně {old}`.
Sticky footer: when any significant field changed → warning Notice (mail icon) `**Změnil se {čas | datum | místo | hala | hlavní trenér}.** Rodiče {n} přihlášených sportovců dostanou e-mail a u přihlášky uvidí „Změněno“.` (n = active bookings; hide if 0). Button primary lg `Uložit změny` (`Vytvořit trénink` for create).
Save order of checks: capacity reduction below booked → K8; eligibility change excluding booked athletes → K9; both → show K8 then K9.

### K3b · Pick assistants (sheet)
Title `Asistenti`; sub `Vyberte jednoho nebo více trenérů. Nikoho vybírat nemusíte.` Checkbox PickerRows of **active** coaches; the current main coach is disabled with meta `Hlavní trenér tohoto tréninku`. Helper `Zobrazují se jen aktivní trenéři. Seznam spravuje administrátor.` CTA `Hotovo · {n} asistent/asistenti/asistentů` (`Hotovo` when 0).
If > 8 coaches: search field at top.

### K3c · Pick main coach (sheet)
Title `Hlavní trenér`; sub `Vyberte jednoho trenéra.` Radio PickerRows of active coaches. A coach currently assigned as assistant shows meta `Nyní asistent — po výběru se z asistentů odebere`. Warning Notice (mail icon): `Změna hlavního trenéra se rodičům {n} přihlášených sportovců oznámí e-mailem.` (only when editing a session with bookings). CTA `Hotovo`.

### K8 · Capacity reduction (dialog)
Trigger: save with `capacity < bookedCount`. Neutral icon tile (people). Title (plural-aware) `Na tento trénink je již přihlášeno 8 sportovců.` Meter box: 6 ink segments + neutral pill `+2`, count `8 / 6`. Text `Nová kapacita je 6.` / `Stávající přihlášky zůstanou zachovány.` Helper `Nové přihlášky budou možné, až počet sportovců klesne pod 6.` Buttons `Zrušit` (outline) · `Přesto uložit` (primary). Afterwards the UI shows `8 / 6` as a supported state (never an error).

### K9 · Eligibility change (dialog)
Trigger: save with new year range excluding booked athletes. Warning icon tile (info). Title plural-aware `4 přihlášení sportovci nesplňují novou věkovou podmínku.` Line `Ročníky 2017–2018 → **2017**`. List box of affected athletes (name + year). Lines: ✓ `Jejich přihlášky zůstanou zachovány.` · ✉ `Dotčení rodiče budou upozorněni.` Buttons `Zrušit` · `Přesto uložit`. On save: e-mail affected guardians only.

### K4 · Duplicate — single (`new?from=`)
Title `Nový trénink`. Info Notice (primary-100, copy icon): `Kopie tréninku **Ne 27. 9. · 16:00**. Vyberte nové datum. Přihlášení sportovci se nekopírují.` Segmented `Jeden termín | Na období` (→ K4b). Form = K3 prefilled from source, **date empty and focused** (placeholder `Vyberte datum`). Footer helper `Nejdřív vyberte datum` + disabled `Vytvořit trénink` until a date is set. Never duplicates on one tap.

### K4b · Duplicate — period
Same header + segmented (`Na období` active). Panel `KDY`: `Opakovat každý` weekday toggles `Po Út St Čt Pá So Ne` (44 px, source weekday preselected, multi-select), `Od` / `Do` dates, `Začátek` / `Konec`. Panel `ZKOPÍRUJE SE` (summary line `MH · Šatna 4 · Kapacita 10 · 2017–2018` / `Milan Filipi, Jan Novák · poznámky` + link `Upravit` expanding the full form). Preview: heading `Vytvoří se {n} tréninků` + helper `Zrušte zaškrtnutí u dnů, kdy se netrénuje` + checklist of generated dates (`Ne 4. 10.` …; unchecked = struck/muted). Helper `Každý trénink bude samostatný. Pozdější úpravy jednoho se nepropíšou do ostatních.` Footer `Vytvořit {n} tréninků` (n = checked). Limit: max 52 occurrences.

### K11 · Create series (`new?mode=series`)
Title `Série tréninků`. Panels: `OPAKOVÁNÍ` (weekday toggles, Od/Do, Začátek/Konec), `KDE`, `KDO`, `TRENÉŘI`, `POZNÁMKY` (as K3; internal note empty, counter `0 / 200`). Preview list of dates (all checked by default, each row shows `09:00–10:00` right-aligned). Footer `Vytvořit {n} tréninků`. No recurrence rules beyond weekly weekdays; occurrences are independent after creation (no series editing).

---

## 4. Who gets notified (single source of truth)

| Action | Guardians notified | In-app for guardian |
|---|---|---|
| Significant change (date, time, place, hall, main coach) | all with active bookings | `Změněno` badge + G6 notice |
| Changing room / capacity / notes / assistants | no | value just updates |
| Eligibility change excluding booked athletes | affected only | (open: badge?) |
| Close / reopen registration | no | card state |
| Cancel training | all with active bookings | cancelled styling |
| Coach adds athlete manually | **that athlete's guardians — e-mail E08 `BOOKING_ADDED_BY_COACH` (v3, DR-12)** | booking appears |
| Coach removes athlete from session | that athlete's guardians — E07 (with optional message) | orange `Odhlášeno trenérem`; **only the coach can re-book (D-06)** |

E-mail templates for every row: `../shared/EMAILS.md`.

The UI must always state the notification consequence **before** the coach confirms (footer notice in K3, K3c notice, K6 box, K9 line).

## 5. Acceptance tests
1. K1 renders 5 states (normal, full=cobalt, over `8 / 6` with `+2`, closed, cancelled) with text labels.
2. Edit time on a session with 8 bookings → footer notice mentions 8 parents; save → guardians see `Změněno`.
3. Reduce capacity 10→6 with 8 booked → K8; confirm → K1 shows `8 / 6` neutral.
4. Narrow years to exclude 4 athletes → K9 lists exactly those 4.
5. Add athlete to full session → K7b; confirm → roster shows `Přidal trenér …`, count `11 / 10`.
6. Cancel → focus starts on `Nezrušovat`; after confirm, no edit/reopen actions remain; duplicate available.
7. Duplicate → date empty & focused; create disabled until date chosen.
8. Series Sun 4.10.–29.11. generates 9 dates; unchecking one → button `Vytvořit 8 tréninků`.
9. Internal note never appears in guardian API responses (integration test on RLS).
10. K1 ↔ K14 switch via the segmented control; K14 shows counts with correct plurals and no meter.
11. K12 search `bures` finds `Tomáš Bureš`; year chip `2018` shows only that group; inactive athletes at the bottom.
12. K13 shows internal note to coaches; the same athlete fetched with a guardian session has no internal note field.
13. K15 lists running and ended series; K16 shows only that series' trainings; there is no edit-series action anywhere.
14. Coach adds an athlete in K7 → guardians receive E08 with the cancellation deadline.
15. First sign-in of an invited coach → K0 once; second sign-in → K1 directly.

## 6. Assumptions & open questions
- Reopening closed registration is allowed (`Otevřít přihlašování`) — confirmed v3.
- Cancelling is final (brief) — confirmed.
- ~~Coach-added bookings: notify guardian?~~ → **yes**, E08 (v3).
- ~~Allow adding out-of-range athletes manually?~~ → **no** (`NOT_ELIGIBLE`); capacity may be exceeded deliberately (K7b), birth years may not — confirmed v3.
- ~~Past trainings list~~ → K14 (v3). ~~Athletes tab~~ → K12/K13 (v3). ~~Series list~~ → K15/K16 (v3).
- The org logo is also shown in the coach header (built; confirmed v3, DR-14.1) — same OrgLogo 36 row as guardian G1b.
