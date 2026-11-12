# Trainlio — Coach UI spec

Audience: Claude Code implementing the coach app. Read `../shared/DESIGN_SYSTEM.md` first. Visual reference: `prototype.html` (screen IDs K0–K16 + A0; v3.4 player card K13/K13h/K13r/K13z, K2e). Tap-zone board: `design-source/screens/K02s-StavyKarty.dc.html`. Admin-only coach management is in `../admin/SPEC.md`. UI copy is Czech, verbatim.

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
  // v3.4 — per booking
  attendance: "present" | "absent" | null;   // null = unmarked; after session end UI shows null as absent
  attendanceBy: { firstName: string; lastName: string } | null; attendanceAt: string | null;
  // v3.3 — per booking
  paidAt: string | null; paidBy: { firstName: string; lastName: string } | null;   // guardian sees only paid: boolean
  coachNote: string | null;        // ≤200, coach/admin only — NEVER in guardian queries
  parentMessage: { text: string; sentAt: string; sentBy: { firstName: string; lastName: string } } | null; // ≤500, visible to the guardian
  athlete: { id: string; firstName: string; lastName: string; birthYear: number;
             position: string | null; stick: "left" | "right" | "unknown" | null; club: string | null };
  createdAt: string;
  createdBy: { kind: "guardian"; firstName: string; lastName: string } | { kind: "coach"; firstName: string; lastName: string };
  guardian: { firstName: string; lastName: string; phone: string | null }; // coaches may see the phone (decided)
}
interface Coach { id: string; firstName: string; lastName: string; active: boolean; isAdmin: boolean;
                 canEditTrainings: boolean;   // v3.2: may edit ALL trainings + create; false → edits only own (main coach) trainings; admins always true
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
**v3.2 — "Moje" filter + role label.** Under the segmented control: FilterChips (DS §6.28) `Všechny` / `Moje` (single select, `aria-pressed`). `Moje` = sessions where the signed-in coach is main coach **or** assistant. The choice is remembered per user (localStorage, fallback `Všechny`; a coach with `canEditTrainings = false` defaults to `Moje`). Applies to K14 too.
On every row where the signed-in coach takes part, a RoleLabel (DS §6.34) under the meta: `Hlavní trenér` (primary-100 / primary) or `Asistent` (neutral-50 / muted). No label on sessions without the coach.
**K1b** = `Moje` selected, coach without the permission: no FAB; rows labelled `Asistent` open K2b, rows labelled `Hlavní trenér` open the full K2.
FAB `+ Vytvořit` → K10 (only on `Nadcházející`). Empty: `Zatím nemáte žádné tréninky.` + `Vytvořit trénink`.

### K2b · Session detail — read-only (v3.2)
**Edit rule (v3.2, binding):** `canEdit(session) = isAdmin || canEditTrainings || session.mainCoachId === me.id`. A coach without the permission **always edits the trainings they lead as main coach**, and only views the rest.
K2b is shown when `canEdit(session)` is false (the coach is an assistant or not on the session). On their own trainings (main coach) such a coach sees the normal K2 with all actions. Same as K2 with:
- Notice under the header (white, inset 1.5 px line, eye icon): title `Jen pro čtení`, text `Tento trénink vede {main coach}. Upravit ho může hlavní trenér nebo administrátor.`
- **Hidden** (not disabled): `Přidat sportovce`, the whole `AKCE` section (Upravit, Duplikovat, Zavřít/Otevřít přihlašování), `Zrušit trénink`, removing an athlete from the roster, editing notes.
- Still visible: capacity, coaches, both notes (incl. internal note), the roster (v3.4: attendance/payment toggles shown as static icons, opacity .75; no `Ostatní byli` / `Zaplatili všichni`). Notice text: `Tento trénink vede {main coach}. Docházku, platby a sestavu může měnit hlavní trenér nebo administrátor.` Cards still open K13 (read-only).
`/edit` of a session where `canEdit` is false → server redirect to K2b; every mutation on such a session returns `FORBIDDEN_EDIT` (server + RLS); the UI hiding is only convenience.
**Creating** (FAB, `/new`, duplicate `?from=`, series `?mode=series`) requires `isAdmin || canEditTrainings` — a coach without the permission cannot create trainings, not even as main coach (no FAB, no `Duplikovat` in K2 of own trainings, no `+ Nová série`).
**Main-coach field:** a coach without the permission editing their own training cannot change `Hlavní trenér` (K3 row disabled, helper `Hlavního trenéra může změnit administrátor.`) — otherwise they would lock themselves out. Assistants can be changed.
Other: K13 `Upravit poznámku` only with `isAdmin || canEditTrainings`; K13 toggles/notes/messages follow `canEdit(session)` per session.

### K14 · Past trainings (`?tab=past`) — v3, DR-02
Same header + segmented control (`Minulé` active). Day groups **descending** (newest first), same heading style. No FAB.
Row = CoachTrainingRow variant `past`: left time + meta as K1; right **two counters** (v3.4) stacked: person-check icon + `{present}/{n}` and $ icon + `{paid}/{n}`, 14/700, success colour when complete, warning colour (#8F5200) when someone is missing. Legend line above the list: `Byli · Zaplatili · oranžově = někdo chybí`. No meter.
Cancelled session: as in K1 (muted, struck time, danger `Zrušeno`) → K6b.
Row → K2 (read-only roster; all edit actions hidden for past sessions — the only action left is `Duplikovat jako nový trénink`, as on K6b; the server refuses the rest with `SESSION_FINISHED`, BR-025d).
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

### K13 · Player card — coach view (v3.4, replaces K13/K17/K19)
Routes: `/coach/athletes/[id]?tab=treninky|hrac|rodice|zpravy` (default `treninky`). Opened from K2 (card) and from K12. Back `‹ Zpět` (history back).
Header (all tabs): Avatar 56 + H1 name Barlow 32/36 (single line, ellipsis) + meta `Ročník {y} · {position} · #{number}`.
Tabs: SegmentedControl with 4 items `Tréninky · Hráč · Rodiče · Zprávy` (`role="tablist"`, 38 px).

**K13 · Tréninky**
- Period control: small segmented `Měsíc / Sezóna` + prev/next 36 px buttons + label (`Listopad 2026` / `Sezóna 2026/27`). Season = 1 August – 31 July (decision 47). The season view (K13y) has exactly the same layout as the month view — no charts.
- Two stat tiles (white, radius 14): `{pct} %` + `Docházka · byl {b} z {b+n}`; `{paid} / {total}` + `Zaplaceno`. Percent = Byl / (Byl + Nebyl); cancelled sessions excluded. **No „Omluven“ status anywhere.**
- `NADCHÁZEJÍCÍ · {n}`: cards (same card style as K2, thick right edge): left `{dd d. m.} · {time}` + meta + red text button `Odhlásit z tréninku` (opens the existing remove dialog); right attendance toggle **disabled** + payment toggle (can be paid in advance).
- `PROBĚHLÉ · {month}`: cards with both toggles active (editable any time). Tap on the left zone → K2 of that session.
- `Zobrazit další ({n})`, footnote `Platbu lze označit i předem, docházku od začátku tréninku.`
- Same tap-zone and undo rules as K2.

**K13h · Hráč** — DetailList `Narozen`, `Pozice`, `Hůl`, `Číslo dresu`, `Tým / kategorie` + note `Údaje vyplňuje rodič ve své aplikaci.`; internal panel `POZNÁMKA O HRÁČI · JEN TRENÉŘI` + `Upravit poznámku` (200 chars). **Fixed:** never reaches guardians.

**K13r · Rodiče** — one white card per active guardian: name 16/700, relation (`Matka · přihlašuje na tréninky`), call + SMS 44 px buttons (only with phone), lines phone (or `Telefon nevyplněn` subtle) and e-mail.

**K13z · Zprávy** — intro `Poznámky a zprávy k jednotlivým tréninkům. Zprávu rodiče uvidí v aplikaci a dostanou e-mail.` Then one card per session (newest first), title `{dd d. m.} · {time}`:
- coach note (yellow block, lock, `Poznámka · jen trenéři`) or link `Přidat poznámku` → inline textarea (200);
- parent message (blue block, bubble, `Zpráva rodičům · odesláno {d. m.} {HH:MM}`) or link `Napsat rodičům` → editor (500) + `Odeslat` (E09). Editing a sent message re-sends E09.

Read-only coaches (no `canEdit` for that session): toggles shown but not interactive (`opacity .75`, no buttons), no `Odhlásit`, no add/edit links.

### K20 · Statistiky (v3.5) — `/coach/stats`
Entry: A0 `Více › Plánování › Statistiky` (chart icon). Visible to **all coaches**; the `Trenéři` block and K20b of *other* coaches only for admins (a coach sees only his own K20b).
- H1 `Statistiky`; period `Měsíc / Sezóna` + prev/next + label; FilterChips with dropdowns `Všechny ročníky ▾` (single year or all) and `Všichni trenéři ▾` (sessions where the coach is main or assistant).
- 4 tiles (2 × 2, white, radius 14, Barlow 30): `{n} Tréninků` (held, not cancelled), `{x} % Obsazenost` (Σ bookings / Σ capacity), `{x} % Docházka` (Byl / (Byl + Nebyl)), `{x} % Zaplaceno` (paid / bookings of held sessions).
- `NEZAPLACENO · {n} tréninky` + link `Vše`: rows Avatar 36 + name + year + red `$ {n} tréninky` + chevron → K13 (Tréninky tab). Sorted by count desc. Top 3, `Vše` opens the full list.
- `NEJNIŽŠÍ DOCHÁZKA` + link `Všichni hráči`: rows with name, `{pct} %` (Barlow 17; red < 60 %, warning < 80 %) and a 6 px bar; → K13. Top 3 lowest (min. 3 sessions in the period); `Všichni hráči` = full sortable list.
- `TRENÉŘI` (admin only): rows name + `{pct} %` + sub `{n} tréninků · docházka` + success bar → K20b.
- Footnote: `Docházka = Byl / (Byl + Nebyl). Obsazenost = přihlášení / kapacita. Zrušené tréninky se nepočítají.`
- Empty period: `V tomto období neproběhl žádný trénink.`

### K20b · Statistiky trenéra (v3.5) — `/coach/stats/coach/[coachId]`
Header Avatar 48 + name (Barlow 30) + `Statistiky trenéra`; period control; chips `Hlavní trenér + asistent` / `Jen hlavní`; 4 tiles (first = `{n} Tréninků ({m} jako hlavní)`); `DOCHÁZKA PO TÝDNECH` bar chart (one bar per week of the month / per month of the season; green ≥ 80 %, warning below; value on top; labels below; `role="img"` + text alternative table for screen readers); list `TRÉNINKY JAKO HLAVNÍ TRENÉR · {n}` rows date · time, meta `{place} · obsazeno {booked}/{capacity}`, right person-check `{present}/{n}` (success when complete, warning otherwise) → K2.

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
1. Header: date (20/28/700 primary) + TodayChip; time `text-hero`; **place chip** (v3.1) `Příbram · Malá hala (MH) · Šatna 4 · Ročníky 2017–2018` — see DS §6.33 (no icon, `align-self: flex-start`, 6 px above). Closed → neutral chip with lock `Přihlašování uzavřeno`.
2. Capacity panel: caption `OBSAZENOST`, meter (9 × 16), count Barlow 32.
3. Coaches DetailList: `Hlavní trenér`, `Asistenti` (names stacked; `—` if none).
4. Public note panel: caption with globe icon `INFORMACE PRO SPORTOVCE · VIDÍ RODIČE`, text.
5. Internal note panel (only if present): `internal` bg + border, caption with lock `INTERNÍ POZNÁMKA · JEN TRENÉŘI` (internal-ink), text.
6. Roster: heading `Sportovci {n}` + small secondary button `+ Přidat sportovce` (→ K7). Rows (link to athlete detail, not designed): avatar 36, name 16/700, line `2017 · Centr · Levá hůl` (omit missing parts), meta 12 `Přihlásil Milana Kotova · 27. 9. 18:42` or `Přidal trenér Milan Filipi · 24. 9. 17:30` (always masculine form — DS §8). Club is not in the default row. Sorted by booking time.
   **v3.4 — roster = attendance + payment in one list (replaces the v3.3 bar/chips and the K17 sheet):**
   - Above the list a column header row: left caption `SPORTOVEC`; right two 48 px columns `Byl` / `Platba`, each with a live count below (Barlow 18/20 700): `{present}/{n}`, `{paid}/{n}`.
   - Each athlete = **PlayerCard** (DS §6.37): white card radius 16, min-height 76, padding 0 16/0 12, **thick right edge** `inset -5px 0 0 #C9D0DC` (the "opens" affordance — no chevron), gap 8 between cards.
     - Left zone (link → K13, Tréninky tab): Avatar 40, name 16/21 700 **single line with ellipsis**, below 13 muted `{year} · {position}` (ellipsis) followed by indicators: lock `#7A5A00` = coach note on this booking, bubble muted = message sent to parents.
     - Right zone: two **StatusToggles** 48 × 48 (DS §6.36): attendance (person icon) and payment ($ icon).
   - **Tap zones (binding):** each toggle's hit area spans the full card height and 62 px width; the gap between toggles belongs to them (no-op). Only the left zone opens K13. Toggles call `stopPropagation`. A pointer that moves > 8 px is a scroll (nothing fires); long-press does nothing.
   - **Feedback:** card tap → whole card darkens (`#EEF1F6`) + scale .98 for 100 ms, then navigates. Toggle tap → only the toggle: scale .9 + 3 px ring, colour/icon swap, `navigator.vibrate(10)` where available.
   - **Attendance toggle** cycles `unmarked → Byl → Nebyl → Byl …` (never back to unmarked from the UI). Disabled (opacity .4) before the session start. Unmarked after the session end counts as `Nebyl` (shown red). Editable **any time later** (no limit).
   - **Payment toggle** `Nezaplaceno ↔ Zaplaceno`, allowed before the session too. Turning **off** shows the undo toast (DS §6.16 exception): white card, red $ circle, `Platba zrušena · {athlete}`, button `Vrátit`, 4 s with progress bar. Turning on: no toast.
   - **Payment and attendance are independent** (no auto-rules).
   - Below the list: two outline lg buttons (grid 1fr 1fr): `Ostatní byli` (marks all *unmarked* as Byl, **no confirmation**, disabled before start) and `Zaplatili všichni` (→ K2c confirmation). When everybody paid, the second becomes static text `Zaplatili všichni ✓`.
   - Footnote 12 muted: `Docházku lze zapsat od začátku tréninku; nezapsaní se po skončení počítají jako „Nebyl“.`
   - Removing an athlete from the session is done in K13 (Tréninky tab, `Odhlásit z tréninku` on upcoming rows) using the existing confirm dialog + E07 flow.
7. Caption `AKCE` + list (56 px rows, icon + label): `Upravit trénink` (→ K3), `Duplikovat` (→ K4), `Zavřít přihlašování` (→ K5) / `Otevřít přihlašování` when closed.
8. Separated by 32 px, outline-danger lg button `Zrušit trénink` (→ K6).
Empty roster: text `Zatím nikdo není přihlášený.`

### ~~K17 / K17b · Player card sheet~~ — removed in v3.4
Replaced by K13 (player card with tabs). Per-booking coach note and parent message live in K13 `Zprávy`; payment/attendance in K2 and K13 `Tréninky`.

### K2e · Training without a main coach (v3.4)
When the main coach is deactivated (admin A3f), his future sessions get `mainCoachId = null`.
- K1 row: orange inset border `1.5px #E3A034` + status line (warning icon) `Bez hlavního trenéra`.
- K2: warning Notice (`#FBF0DC`, inset `#E3A034`) `Trénink nemá hlavního trenéra` + `{coach} byl deaktivován {d. m.}. Rodiče vidí „Trenér bude upřesněn“.` + primary md `Přiřadit trenéra` (→ K3c). DetailList `Hlavní trenér` = `Bez trenéra` (warning colour).
- Guardian G6: `Hlavní trenér` row shows `Trenér bude upřesněn` (muted). No e-mail when it becomes empty; E05 is sent when a new main coach is assigned.
- Who can edit such a session: admins and coaches with `canEditTrainings` (nobody is "main coach").

### K2c · Mark all as paid (v3.3) — BottomSheet
Title (Barlow 28/32) `Označit {n} sportovce jako zaplacené?` (plural: 1 sportovce / 2–4 sportovce / 5+ sportovců — the accusative form is `sportovce` for 1–4, `sportovců` for 5+), text `Ostatní už zaplaceno mají. Rodiče uvidí v aplikaci „Zaplaceno“.`, list (bg panel) of the unpaid athletes (Avatar 32 + name). Buttons: primary lg `Označit {n} jako zaplacené`, outline lg `Zrušit`. Confirm → one request marks only the unpaid bookings (`paidBy = me`, same timestamp); already-paid rows keep their original `paidAt/paidBy`. Toast `Označeno jako zaplacené`.

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
Same header + segmented (`Na období` active). Panel `KDY`: `Opakovat každý` weekday toggles `Po Út St Čt Pá So Ne` (44 px, source weekday preselected, multi-select), `Od` / `Do` dates, `Začátek` / `Konec`. Panel `ZKOPÍRUJE SE` (summary line `MH · Šatna 4 · Kapacita 10 · 2017–2018` / `Milan Filipi, Jan Novák · poznámky` + link `Upravit` expanding the full form). Preview: heading `Vytvoří se {n} tréninků` + helper `Zrušte zaškrtnutí u dnů, kdy se netrénuje` + checklist of generated dates (`Ne 4. 10.` …; unchecked = struck/muted). Helper `Každý trénink bude samostatný. Pozdější úpravy jednoho se nepropíšou do ostatních.` Footer `Vytvořit {n} tréninků` (n = checked). Limit: max 200 occurrences (52 until migration 40).

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
16. `Moje` shows only sessions where I am main coach or assistant; each shows the correct RoleLabel; choice survives reload.
17. Coach without the permission: no FAB; on a session where they are assistant → K2b with `Jen pro čtení`, no actions, direct POST returns `FORBIDDEN_EDIT`, `/edit` redirects; on a session where they are **main coach** → full K2, can edit/close/cancel/add/remove, but `Duplikovat` is hidden and the `Hlavní trenér` field is locked; creating via API returns `FORBIDDEN_EDIT`.
18. View-only coach can still call a guardian from the roster and read the internal note.
19. K2: tapping the $ toggle marks paid without opening K13; tapping the name opens K13; tapping the gap between toggles does nothing; a vertical drag over a toggle scrolls and changes nothing.
20. Turning payment off shows `Platba zrušena · {athlete}` with `Vrátit` for 4 s; `Vrátit` restores the original `paidAt/paidBy`.
21. Attendance toggle disabled before start; after start cycles Byl/Nebyl; after the session end unmarked counts as Nebyl in K13 percent; editing a 3-month-old session works.
22. `Ostatní byli` marks only unmarked athletes, no dialog; `Zaplatili všichni` → K2c lists only unpaid; when all paid the static `Zaplatili všichni ✓` appears.
23. Header counters `Byl x/n` and `Platba x/n` and K14 counters update immediately; payment and attendance never change each other.
24. K13 tabs: Tréninky percent = Byl/(Byl+Nebyl) for the selected month/year; Hráč shows the general note; Rodiče call/SMS links; Zprávy note never returned to a guardian session (RLS); sending a message triggers E09.
25. Deactivate a main coach with 3 future sessions (A3f) → those sessions show `Bez hlavního trenéra` in K1 and K2e; guardian G6 shows `Trenér bude upřesněn`; assigning a coach sends E05.
26. Read-only coach: K2b/K13 toggles are not interactive; API returns `FORBIDDEN_EDIT`.
27. K20 tiles match hand-computed values for a seeded month; cancelled sessions excluded; `Nezaplaceno` lists only athletes with unpaid bookings of held sessions.
28. A non-admin coach does not see the `Trenéři` block and gets 403 for another coach's K20b; an admin sees all.
29. Switching `Měsíc / Sezóna` in K13, K20, K20b and G8b uses 1 Aug – 31 Jul seasons; the labels say `Sezóna 2026/27`.

## 6. Assumptions & open questions
- Reopening closed registration is allowed (`Otevřít přihlašování`) — confirmed v3.
- Cancelling is final (brief) — confirmed.
- ~~Coach-added bookings: notify guardian?~~ → **yes**, E08 (v3).
- ~~Allow adding out-of-range athletes manually?~~ → **no** (`NOT_ELIGIBLE`); capacity may be exceeded deliberately (K7b), birth years may not — confirmed v3.
- ~~Past trainings list~~ → K14 (v3). ~~Athletes tab~~ → K12/K13 (v3). ~~Series list~~ → K15/K16 (v3).
- The org logo is also shown in the coach header (built; confirmed v3, DR-14.1) — same OrgLogo 36 row as guardian G1b.
