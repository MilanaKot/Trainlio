# Trainlio — E-mails to guardians (v3, DR-05 / DR-12)

Visual reference: `../emails/*.html` (one file per event, open in a browser) and canvas boards E01–E08.
This file is the single source of truth for subjects, copy, recipients and links. UI copy is Czech, verbatim; `{}` are variables.

## 1. Template (one layout for all events, incl. the coach invitation A6)

```
[ preheader — hidden, = first sentence of the body ]
┌ 520 px white card, radius 12, 1 px #DFE4EE border, padding 32, on #F3F5F9 ┐
│ Header: org logo 40×40 + org name 16/700        (no logo → org name only, no monogram)
│ Event label  12/700 uppercase, radius 6, padding 4/8   (colour see §3)
│ H1 26/32 700
│ One sentence 16/25 — what happened and whether the parent must do anything
│ Detail block (bg #F3F5F9, radius 10): label column 96 px muted 15 / value 15
│ Coach message (only if present): 3 px left border #DFE4EE, caption "Zpráva od trenéra" 13 muted
│ Button: 48 px, radius 10, #2B55E0, white 16/700 — HTML/VML "bulletproof", never an image
│ Optional helper line 13/20 muted
│ ─ divider ─
│ Footer 13 muted: "Tento e-mail jste dostali, protože máte sportovce přihlášeného na trénink v aplikaci {org}."
└────────────────────────────────────────────────────────────────────────────┘
"Běží na trainlio" 12 muted, centred under the card
```

Rules:
- **Fonts:** `Arial, Helvetica, sans-serif` only — no web font (Outlook/Gmail strip or ignore them; the design does not depend on Barlow).
- **Images blocked:** the message must read completely. The logo has `alt="{org name}"` and the org name is also printed as text next to it. No information is carried by an image or by colour alone (changed values also carry the old struck-through value under them).
- **Logo** from the public bucket (`org-logos`), absolute URL, `width="40" height="40"`.
- **Details are a block, never a sentence.** Changed value: new value bold on warning-soft (`#FBF0DC`, text `#8F5200`), old value below with `text-decoration: line-through` in muted. In the plain-text version: `Kdy: Středa 7. října, 17:30–18:30 (dříve 17:00–18:00)`.
- **Several athletes of one guardian in one event = one e-mail** (AC-072/073). Row label `Sportovci` (plural) and value `Ivan Kotov, Anna Kotova`. Subject unchanged.
- **Gender-neutral wording:** never decline by the child's gender — use `sportovec / sportovce` + name.
- **Plain-text part** with identical content and order (labels `Kdy:`, `Kde:` …; button → `Otevřít v aplikaci: {url}`).
- **Subject pattern:** `{Co}: trénink {dd} {d. m.} v {H:MM}` — the date is always in the subject. Weekday abbreviations `po út st čt pá so ne`, lowercase.
- **From:** `{org name} <noreply@trainlio.cz>`; Reply-To: the main coach's e-mail if known.
- **Date formats:** `Středa 7. října · 17:00–18:00` in the block (DS §7).
- **Links** go to the app over the org's domain; signed-out users land on login and are redirected back after the code.

## 2. Events

| ID | Event | Recipients | Label | Button → |
|---|---|---|---|---|
| E01 | `SESSION_CANCELLED` | every guardian with an active booking | red `Trénink zrušen` | `Zobrazit další tréninky` → G1 |
| E02 | `SESSION_SCHEDULE_CHANGED` | every booked guardian | orange `Změna času` | `Otevřít v aplikaci` → G6 (booking) |
| E03 | `SESSION_LOCATION_CHANGED` | every booked guardian | orange `Změna místa` | → G6 |
| E04 | `SESSION_FACILITY_CHANGED` (MH ↔ VH) | every booked guardian | orange `Změna haly` | → G6 |
| E05 | `SESSION_MAIN_COACH_CHANGED` | every booked guardian | orange `Změna trenéra` | → G6 |
| E06 | `SESSION_ELIGIBILITY_NARROWED` | only guardians of athletes outside the new range (D-08) | orange `Odhlášeno` | `Najít jiný trénink` → G1 |
| E07 | `BOOKING_REMOVED_BY_COACH` | the removed athlete's guardians | orange `Odhlášeno trenérem` | `Otevřít v aplikaci` → G6d |
| E08 | `BOOKING_ADDED_BY_COACH` **(new, DR-12)** | the added athlete's guardians | blue `Nová přihláška` | `Otevřít v aplikaci` → G6 |

When several significant fields change in one save (e.g. time and hall), send **one** e-mail: label `Změna tréninku`, subject `Změna tréninku: trénink {dd d. m.}`, H1 `Trénink se změnil`, and all changed rows highlighted.

### E01 · SESSION_CANCELLED
- Subject: `Zrušeno: trénink {st 7. 10.} v {17:00}`
- H1: `Trénink byl zrušen`
- Text: `Trenér zrušil trénink, na který je přihlášen sportovec. Přihláška se tím ruší, nic dalšího dělat nemusíte.`
- Block: `Sportovec` · `Kdy` (struck through) · `Kde`
- Coach message if given.

### E02 · SESSION_SCHEDULE_CHANGED
- Subject: `Změna času: trénink {st 7. 10.} — nově {17:30}` (date change: `Změna termínu: trénink {st 7. 10.} — nově {čt 8. 10.}`)
- H1: `Trénink začíná v jiný čas` (date: `Trénink je v jiný den`)
- Text: `Trenér změnil čas tréninku. Přihláška platí dál, s novým časem.`
- Block: `Sportovec(i)` · `Kdy` (new highlighted + old struck) · `Kde` · `Odhlásit lze` `do {st 7. 10. v 5:30}`
- Helper under button: `Nový čas vám nevyhovuje? Sportovce můžete v aplikaci odhlásit do uvedeného termínu.`

### E03 · SESSION_LOCATION_CHANGED
- Subject: `Změna místa: trénink {st 7. 10.}`
- H1: `Trénink bude jinde` · Text: `Trenér změnil místo tréninku. Čas zůstává stejný.`
- Block: `Sportovec` · `Kdy` · `Kde` (new + old)

### E04 · SESSION_FACILITY_CHANGED
- Subject: `Změna haly: trénink {st 7. 10.} — {Velká hala}`
- H1: `Trénink se přesouvá do {Velké haly | Malé haly}` · Text: `Trenér změnil halu. Místo i čas zůstávají stejné.`
- Block: `Sportovec` · `Kdy` · `Hala` (new + old, incl. šatna)

### E05 · SESSION_MAIN_COACH_CHANGED
- Subject: `Jiný trenér: trénink {st 7. 10.}`
- H1: `Trénink povede jiný trenér` · Text: `Hlavního trenéra tréninku vystřídá kolega. Čas i místo zůstávají stejné.`
- Block: `Sportovec` · `Kdy` · `Hlavní trenér` (new + old)

### E06 · SESSION_ELIGIBILITY_NARROWED
- Subject: `Odhlášení z tréninku {st 7. 10.} — změna ročníků`
- H1: `Sportovec byl z tréninku odhlášen`
- Text: `Trenér upravil ročníky tréninku. Sportovec do nového rozsahu nespadá, a proto byla jeho přihláška zrušena.`
- Block: `Sportovec` `{name} · ročník {2017}` · `Kdy` · `Ročníky` (new + old)

### E07 · BOOKING_REMOVED_BY_COACH
- Subject: `Odhlášení z tréninku {ne 4. 10.} v {9:00}`
- H1: `Trenér odhlásil sportovce z tréninku`
- Text: `Trénink se koná, ale sportovec na něm už není přihlášen. Znovu ho přihlásit může jen trenér.` (D-06)
- Block: `Sportovec` · `Kdy` · `Kde` · `Trenér` `{name} · {phone as tel: link}` (row without phone when unknown)
- Coach message if given.

### E08 · BOOKING_ADDED_BY_COACH (new)
- Subject: `Přihláška na trénink {ne 4. 10.} v {9:00}`
- H1: `Trenér přihlásil sportovce na trénink`
- Text: `Trenér {Milan Filipi} přihlásil sportovce na trénink. Najdete ho v aplikaci v Moje tréninky.`
- Block: `Sportovec` · `Kdy` · `Kde` · `Odhlásit lze` `do {so 3. 10. ve 21:00}`
- Helper: `Sportovec nepůjde? Odhlaste ho v aplikaci do uvedeného termínu, ať místo může dostat někdo jiný.`
- Sent also when the coach adds over capacity (K7b). Not sent for the guardian's own bookings.

## 3. Label colours
- red (`#FBE9E7` / `#B42318`) — cancelled
- orange (`#FBF0DC` / `#8F5200`) — change, removal
- blue (`#E5EBFD` / `#2B55E0`) — new booking, invitation

## 4. Not sent
Room, capacity, notes, assistants changes; closing/reopening registration; guardian's own booking/cancellation (in-app toast only).
