# Trainlio — Design System (C3 "Tablo / Cobalt")

Shared by all roles. Role specs (`guardian/SPEC.md`, `coach/SPEC.md`, `admin/SPEC.md`) reference the components below by name. Tokens live in `shared/tokens.css` (Tailwind 4 `@theme`). The canvas board "Design systém C3" is the visual reference.

Stack assumed: Next.js 16 (App Router) · React 19 · TypeScript 5.9 strict (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`) · Tailwind 4 · Supabase · Zod 4 · Vitest + Testing Library · Playwright.

---

## 1. Principles

1. **Mobile-first, one hand.** Design width 390 px (works 360–430). Guardian UI stays mobile-width on desktop (max-width 480 px, centered). Coach/admin may use a two-pane layout ≥ 1024 px (see §9).
2. **Reduce decisions.** One primary action per view. Lists over calendars. No dashboards.
3. **Numbers must scan.** Times, dates and counts use Barlow Semi Condensed + `tabular-nums`.
4. **Status never by color alone.** Every status has text and/or an icon.
5. **Human Czech copy.** No technical terms, codes, or database states in the UI.
6. **Sport-neutral system.** No hockey imagery in navigation or components; sport appears only as data (e.g. "Lední hokej").

## 2. Fonts

```ts
// app/layout.tsx
import { Manrope, Barlow_Semi_Condensed } from "next/font/google";
const manrope = Manrope({ subsets: ["latin", "latin-ext"], weight: ["400", "500", "600", "700"], variable: "--font-manrope", display: "swap" });
const barlow = Barlow_Semi_Condensed({ subsets: ["latin", "latin-ext"], weight: ["500", "600", "700"], variable: "--font-barlow", display: "swap" });
// <html lang="cs" className={`${manrope.variable} ${barlow.variable}`}>
```

`latin-ext` is mandatory (ř, ů, ě, š, č, ž, ý…).

## 3. Type scale

| Token | Font | Size / line | Weight | Used for |
|---|---|---|---|---|
| `text-page` | Barlow | 40/44 | 700 | Page title ("Tréninky", "Moje tréninky") |
| `text-hero` | Barlow | 44/48 | 700 | Time on detail screens |
| `text-form-title` | Barlow | 36/40 | 700 | Form titles ("Upravit trénink") |
| `text-sheet-title` | Barlow | 28/32 | 700 | Sheet/dialog titles; time on cards |
| `text-count` | Barlow | 18/24 | 600 | "7 / 10" on cards (22–32 px on coach views) |
| `text-date` | Manrope | 17/24 | 700 | Date group heading — **color primary** |
| `text-body` | Manrope | 16/24 | 400 | Body |
| `text-row` | Manrope | 15/22 | 600 | Row values, names |
| `text-meta` | Manrope | 14/20 | 400 | Secondary info, muted |
| `text-hint` | Manrope | 13/18 | 600 | Deadlines, helper text |
| `text-caption` | Manrope | 12/16 | 700 | Section captions, UPPERCASE, tracking 0.8 px, muted |
| `text-badge` | Manrope | 11/16 | 700 | Badges, UPPERCASE, tracking 0.6 px |

Design components so labels can grow ~40 % (English later). Never rely on fixed widths for text except the 124 px card buttons (labels there are short and must fit: "Přihlásit", "Obsazeno", "Odhlásit").

## 4. Spacing & layout

- Scale: 4 · 8 · 12 · 16 · 24 · 32 · 48.
- Screen side padding 16 px; card padding 16 px; gap between cards 12 px; gap between form panels 16 px.
- Page top padding 60 px (below status bar) on tab screens; 52 px + 44 px back row on pushed screens.
- Bottom navigation 76 px incl. 8 px bottom padding + safe-area inset (`env(safe-area-inset-bottom)`).
- Sticky footers (forms, details) — 12 px top, 28 px bottom (+ safe area), `shadow-nav` on top.

## 5. Color usage rules (decided in review)

| Meaning | Color |
|---|---|
| Primary action, links, active nav, **date group heading**, **full capacity segments** | `primary` #2B55E0 |
| "Dnes" (today) chip, success toast icon | `success` #13795B, white text |
| Last places (≥ 80 % booked, not full), "Změněno" badge + highlighted changed value, form-changed fields | `warning` family |
| "Zrušeno trenérem", destructive button, field errors | `danger` family |
| Self-cancelled booking ("Odhlášeno"), "Obsazeno", "Přihlašování uzavřeno", over-capacity "+N" | neutral (`neutral-50` bg, `muted` text) |
| Internal coach note | `internal` family + lock icon |

**Buttons:** primary = cobalt filled; secondary/cancel = white with 1.5 px `line` inset border; destructive red filled is used **only** for "Zrušit trénink". Never black primary buttons.

---

## 6. Components

Props below are suggestions; keep them strict-TS friendly (no optional `undefined` unions — use `exactOptionalPropertyTypes`).

### 6.1 Button

| Variant | Bg / text | Pressed | Use |
|---|---|---|---|
| `primary` | primary / white | primary-600 | Main action |
| `secondary` | primary-100 / primary | primary-200 | Secondary in-card ("Přihlásit" when a child is already booked) |
| `outline` | white / ink, inset 1.5 px line | neutral-50 | Cancel, "Odhlásit", "Nezrušovat" |
| `danger` | danger / white | danger-600 | "Zrušit trénink" only |
| `danger-outline` | transparent / danger, inset border danger-border | danger-soft | Entry point "Zrušit trénink" at bottom of session detail |

Sizes: `md` 44 px height, radius 10, 15 px/600 · `lg` (block) 52 px, radius 12, 16 px/700, full width. **Card buttons are fixed 124 × 44.**
States: default · pressed · focus (`shadow-focus`, 2 px ring offset 2) · disabled (`neutral-50` bg, `subtle` text, no border) · loading (spinner 18 px + verb in progressive form: "Přihlašuji…", "Ukládám…", "Odhlašuji…", "Ruším…"; button keeps width, `aria-busy="true"`).

```ts
type ButtonProps = { variant: "primary" | "secondary" | "outline" | "danger" | "danger-outline"; size?: "md" | "lg"; loading?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>;
```

### 6.2 Badge
Height 24 (22 on coach list), radius 6, `text-badge`. Variants: `neutral` (Obsazeno, Odhlášeno, Neaktivní, Koncept), `warning` (Změněno, Poslední místa), `danger` (Zrušeno trenérem / Zrušeno), `success` (Přihlášeno). "Dnes" is a separate **TodayChip** (success bg, white, 12 px/700, radius 6, height 22, not uppercase).

### 6.3 BookedChip
`primary-100` bg, `primary` text, 13/600, height 28, radius 8, check icon 16. Text: `Přihlášen: {Jméno Příjmení}` — always masculine form, regardless of gender (see §8).

### 6.4 CapacityMeter
Segmented bar + count.

- Segments: 9 × 16 px, gap 3, radius 2 (coach list uses 6 × 12, gap 2).
- Fill color by state:
  - `open` → filled `ink`
  - `lastPlaces` (booked ≥ 80 % of capacity and booked < capacity) → filled `warning-fill` + hint text "Zbývá N míst/místo" in `warning`
  - `full` (booked == capacity) → filled `primary`
  - `closed` (registration closed) → filled `subtle`, count in `muted`
  - `over` (booked > capacity) → capacity segments `ink` + neutral pill `+{booked-capacity}`; count shows `8 / 6`. **Never red, never an error.**
- If capacity > 16: render a 6 px high progress bar (same color rules) instead of segments.
- Count text: `{booked} / {capacity}` with thin spaces around the slash is fine; always tabular.
- Realtime: when booked changes, animate the new segment fill 200 ms; no toast.
- a11y: `role="meter"` `aria-valuemin=0` `aria-valuemax={capacity}` `aria-valuenow={booked}` `aria-label="Obsazenost"` + visible text.

```ts
type CapacityState = "open" | "lastPlaces" | "full" | "closed" | "over";
function capacityState(booked: number, capacity: number, registrationOpen: boolean): CapacityState;
```

### 6.5 TrainingCard (guardian list)
Surface card, radius 16, padding 16, gap 6, `shadow-card`.
Rows: time (`text-sheet-title`, Barlow) → `Příbram · {hallCode} · Šatna {n}` (omit šatna if empty) → eligibility line (`Ročníky 2017–2018` or `Všichni sportovci`) → optional hint (`Zbývá 1 místo`) → optional BookedChip → footer row: CapacityMeter left, 124 px button right.
Button logic → see guardian spec §G1.

### 6.6 BookingCard (guardian "Moje tréninky")
Header row: small avatar (28, initials) + athlete name 15/700 + optional badge + chevron `›`. Then time, date line (15/600), meta. Upcoming cards have a footer (divider, deadline hint + 124 px `outline` "Odhlásit").
Past variants: normal; `cancelledByCoach` (card bg `#F8F9FB` + 1 px line border, time/date struck through, danger badge, meta "Trénink se nekonal"); `selfCancelled` (same muted card, **no strike-through**, neutral badge "Odhlášeno", meta "Odhlásil {guardian} · {d. m. HH:MM}").
Whole card is a link (chevron indicates it). Footer button click must not trigger navigation (`stopPropagation`).

### 6.7 CoachTrainingRow (coach list)
Card with left column (time 26/30 Barlow, meta, optional status line) and right column (count 22 px Barlow + mini meter), chevron. Cancelled row: muted card, struck time, "Zrušeno" danger badge instead of meter.

### 6.8 PickerRow (checkbox / radio row)
Min height 60–64, radius 12, padding 10/14, inset 1.5 px line. Selected: inset 2 px primary + `selected-bg`. Disabled: `neutral-50` bg, muted text, cursor not-allowed, reason in meta line (e.g. `2020 · mimo ročníky 2017–2018`).
Control visuals are custom (24 px box radius 7 / 24 px circle) — keep a real `<input>` visually hidden inside the `<label>` for a11y; do **not** rely on native checkbox rendering.

### 6.9 SegmentedControl
Track `neutral-50`, radius 12, padding 4, gap 4; items 40–44 px, radius 9; active: white + small shadow + ink text. Use `role="tablist"` for view switches (Nadcházející / Minulé) and `role="radiogroup"` for form choices (Hala, Pro koho?, Jeden termín / Na období). Hala items show code + full name (`MH` / `Malá hala`).

### 6.10 Form field
Label 14/600 above; optional marker `Nepovinné` (13, muted) right-aligned in the label row; required marker `*` in danger. Input 52 px, radius 10, inset 1.5 px line; focus `shadow-field-focus`; error inset 2 px danger + message 13/600 danger below, linked via `aria-describedby`, `aria-invalid="true"`. Changed-in-edit fields (coach edit): inset 2 px warning-fill, bg warning-field, helper "Původně {old}" in warning.
Textarea (notes): min-height 88; counter bottom-right `N / 200` (13 px muted, tabular). At limit: counter turns danger, typing blocked.

### 6.11 Stepper
Width 180, height 52; − / + buttons 52 × 52 on neutral-50; value Barlow 24/700. Min 1, max 99. `aria-label` on buttons ("Ubrat", "Přidat").

### 6.12 Chip (assistant) / AddChip
Height 36, radius 18. Assistant chip: neutral-50, name 14/600, remove button 28 px with `aria-label="Odebrat {name}"`. Add chip: primary-100 bg, primary text `+ Přidat asistenta`.

### 6.13 BottomSheet
Scrim `scrim`; sheet white, top radius 24, padding 10/20/28 (+ safe area), `shadow-sheet`, grabber 40 × 4. Header: title (`text-sheet-title`) + close button 44 × 44 circle `neutral-50` (`aria-label="Zavřít"`). `role="dialog"` `aria-modal="true"` `aria-labelledby`. Focus trap, Esc closes, restore focus to trigger. Swipe-down to close on touch. Tall sheets (Přidat sportovce) start 48 px from top.
Use for: booking, choosing coaches, "Vytvořit", closing registration.

### 6.14 Dialog (centered alert)
Scrim `scrim-strong`; card left/right 20 px, radius 24, padding 24/20/20, `shadow-dialog`. Icon tile 52 × 52 radius 16 (neutral / warning / danger soft bg). Title `text-sheet-title` (26/30 allowed for long titles). Buttons: two equal columns `[outline cancel] [primary confirm]`, or stacked for destructive (`outline "Nezrušovat"` above `danger "Zrušit trénink"`). `role="alertdialog"`. Initial focus on the **safe** button.
Use for: capacity override, capacity reduction, eligibility change, cancel training.

### 6.15 Notice (inline)
Radius 12, padding 12–14, icon 20–22 + title 15/700 + text 14. Variants: `warning` (warning-soft), `info` (primary-100), `danger` (danger-soft), `neutral` (bg). Not dismissible. `role="status"` (or `role="alert"` for blocking validation such as "Není dostatek volných míst").

### 6.16 Toast
White card radius 16, `shadow-toast`, 16 px from screen sides, 28 px above bottom nav/footer. Leading 32 px circle (success-soft + success check). Text 15/600. **No action button** (decision: no "Vrátit"). Auto-dismiss 3 s. `role="status"`, `aria-live="polite"`.

### 6.17 BottomNav
Guardian: 4 items — Tréninky, Moje tréninky, Moji sportovci, Účet. Coach/admin: 3 items — Tréninky, Sportovci, Více. Icon 22 stroke 1.8 + label 11/600; active `primary`, inactive `muted`. `aria-current="page"`.

### 6.18 FAB (coach)
Extended pill 56 px high, radius 28, primary, `+ Vytvořit`, `shadow` `0 8px 24px rgb(43 85 224 / .35)`; right 16, above nav. Opens "Vytvořit" sheet.

### 6.19 Avatar
Circle 28 / 36 / 40 / 56 / 72; initials 11–24 px/700; active: primary-100 + primary; inactive/ineligible: neutral-200 + muted. Photo replaces initials when present (object-fit cover).

### 6.20 DetailList (dl)
White panel radius 16, padding 4/16; rows grid `112px 1fr`, padding 12/0, divider `line`. `dt` 14 muted, `dd` 15/600. Empty optional value: `—` in muted/400 (row stays visible).

### 6.21 EmptyState
Compact (no big illustrations): 48 px icon tile, one sentence 16/600, optional primary button. Copy from brief:
- `Momentálně nejsou vypsané žádné tréninky.`
- `Zatím nemáte žádný nadcházející trénink.`
- `Přidejte prvního sportovce a můžete začít rezervovat tréninky.` + `Přidat sportovce`
- `Zatím není přidaný žádný trenér.` + `Přidat trenéra`

### 6.22 Skeletons / loading
Card-shaped skeletons (neutral-50 blocks, 1.2 s shimmer), max 3 per list. Buttons show loading state instead of full-screen spinners.

---

## 7. Formatting helpers (implement once in `lib/format.ts`)

Timezone: `Europe/Prague`. Locale `cs-CZ`.

| Helper | Output example | Notes |
|---|---|---|
| `formatDateGroup(d)` | `Neděle 27. září` | `Intl.DateTimeFormat("cs-CZ",{weekday:"long",day:"numeric",month:"long"})`, capitalize first letter, remove comma |
| `formatDateShort(d)` | `Ne 27. 9.` | weekday 2-letter: Po Út St Čt Pá So Ne |
| `formatTimeRange(a,b)` | `09:00–10:00` | en dash, no spaces |
| `formatDeadline(d)` | `so 3. 10. 21:00` | lowercase weekday in running text |
| `formatDateTime(d)` | `27. 9. 18:42` | roster "booked at" |
| `relativeDayLabel(d)` | `Dnes` / `Zítra` / null | drives TodayChip ("Zítra" uses neutral chip) |

## 8. Czech plurals & gender

Use `Intl.PluralRules("cs")` → `one` (1), `few` (2–4), `many` (fractions), `other` (0, 5+). Keep copy in a message catalog (`messages/cs.json`, ICU syntax) so English can be added later.

| Key | one | few | other |
|---|---|---|---|
| free places | `1 volné místo` | `3 volná místa` | `5 volných míst` |
| remaining | `Zbývá 1 místo` | `Zbývají 2 místa` | `Zbývá 5 míst` |
| book N athletes (CTA) | `Přihlásit 1 sportovce` | `Přihlásit 2 sportovce` | `Přihlásit 5 sportovců` |
| create N trainings | `Vytvořit 1 trénink` | `Vytvořit 3 tréninky` | `Vytvořit 9 tréninků` |
| N will be created | `Vytvoří se 1 trénink` | `Vytvoří se 3 tréninky` | `Vytvoří se 9 tréninků` |
| N not eligible | `1 přihlášený sportovec nesplňuje novou věkovou podmínku.` | `4 přihlášení sportovci nesplňují…` | `5 přihlášených sportovců nesplňuje…` |
| already booked | `Na tento trénink je již přihlášen 1 sportovec.` | `…přihlášeni 3 sportovci.` | `…přihlášeno 8 sportovců.` |

**Gender (decided):** the product does not collect gender. Always use the masculine form for actor verbs and participles, for any person: `Přihlásil Milana Kotova · 27. 9. 18:42`, `Odhlásil …`, `Přidal trenér …`, `Zrušil …`, `Přihlášen: Anna Kotova`, `Narozen 8. 6. 2017`. Do not generate feminine variants.

## 9. Responsive

- Guardian: always the mobile layout; on ≥ 640 px center a 480 px column; bottom nav stays at the bottom of the column.
- Coach/admin ≥ 1024 px: left list (training list / coach list, 420 px) + right detail pane (session detail / edit form). Sheets become right-side panels or centered modals (max-width 480). Dialogs stay centered. Bottom nav becomes a slim top bar with the same 3 items — no enterprise sidebar.

## 10. Accessibility checklist

- Contrast: text ≥ 4.5:1 (`muted` #55607A passes on white and bg; `subtle` #8791A6 does **not** — decorative/disabled only).
- Touch targets ≥ 44 × 44 (chevrons are inside larger row targets).
- Real `<button>`, `<a>`, `<input>` + `<label>`; no clickable divs.
- Visible focus ring on every interactive element (`shadow-focus`).
- Status by text + color; badges have text; icons in notices are `aria-hidden`.
- Sheets/dialogs: focus trap, Esc, restore focus, `aria-modal`.
- Form errors tied to fields; first invalid field focused on submit.
- Respect `prefers-reduced-motion` (disable segment animation, sheet slide becomes fade).

## 11. Human error messages (map API errors → copy)

| Code (internal) | Copy |
|---|---|
| `SESSION_FULL` | `Trénink je již obsazený.` |
| `ALREADY_BOOKED` | `Tento sportovec už je přihlášený.` |
| `BOOKING_CLOSED` | `Přihlášení již není možné.` |
| `NOT_ELIGIBLE` | `Některý z vybraných sportovců už nesplňuje podmínky tréninku.` |
| `NOT_ENOUGH_PLACES` | Notice: `Není dostatek volných míst` / `Na tréninku zbývá pouze {n} místo. Vyberte prosím {n} sportovce.` |
| `CANCEL_DEADLINE_PASSED` | `Odhlášení již není možné. Kontaktujte trenéra.` |
| `SESSION_CANCELLED` | `Trénink byl zrušen trenérem.` |
| network / unknown | `Něco se nepovedlo. Zkuste to prosím znovu.` |

Never show SQL/RPC names or HTTP codes.
