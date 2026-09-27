# Trainlio — UI handoff for Claude Code

Design direction: **C3 "Tablo / Cobalt"** (mobile-first, Czech UI). Source canvas: the "Trainlio" Design artifact (mood boards, flows, design-system board).

```
trainlio-handoff/
├── README.md                ← this file
├── shared/
│   ├── tokens.css           ← Tailwind 4 @theme tokens (import from app/globals.css)
│   └── DESIGN_SYSTEM.md     ← principles, type scale, components, formatting, plurals, a11y, error copy
├── guardian/
│   ├── prototype.html       ← clickable prototype G1–G16 (open in a browser)
│   └── SPEC.md              ← routes, data, per-screen behaviour, copy, tests, open questions
├── coach/
│   ├── prototype.html       ← K1–K11 (+ A0)
│   └── SPEC.md
├── admin/
│   ├── prototype.html       ← A0–A3
│   └── SPEC.md
├── brief/DESIGN_BRIEF.md    ← original product brief
└── design-source/screens/   ← source of every canvas screen (.dc.html, reference only)
```

## How to use with Claude Code

Put this folder in the repo (e.g. `docs/design/`) and work one role at a time. Suggested prompts:

1. **Foundation** — "Read `docs/design/shared/DESIGN_SYSTEM.md` and `tokens.css`. Set up fonts with next/font, import tokens in `app/globals.css`, and build the shared components in `components/ui/` (Button, Badge, TodayChip, BookedChip, CapacityMeter, PickerRow, SegmentedControl, Field, Textarea with counter, Stepper, BottomSheet, Dialog, Notice, Toast, BottomNav, Avatar, DetailList, EmptyState) with Vitest + Testing Library tests. Add `lib/format.ts` and the cs message catalog with plurals."
2. **Guardian** — "Implement `docs/design/guardian/SPEC.md` screen by screen using the shared components. Match `guardian/prototype.html` visually. Add the Playwright tests from §6."
3. **Coach** — same with `coach/SPEC.md`.
4. **Admin** — same with `admin/SPEC.md`.

The prototypes are visual references with sample data (names like Jan Novák, Eliška Procházková, dates in Sept–Nov 2026 are placeholders). Specs win over prototypes when they differ.

## Decisions made during design review (binding)

1. Booked child on a training card → chip `Přihlášen: {name}`; `Přihlásit` stays only if another eligible child exists (otherwise disabled).
2. Ineligible children are shown disabled with a reason, not hidden.
3. Cancellation deadline is shown in advance (`Odhlásit lze do …`); after it the button stays visible but disabled with an explanation.
4. No waiting list in MVP — `Obsazeno` is final.
5. Over-capacity `8 / 6` = full meter + neutral `+2`, never an error.
6. "Minulé" shows both coach cancellations (strike-through, red badge) and self-cancellations (neutral badge, no strike).
7. Coach management lives under `Více` (no separate tab).
8. One FAB `+ Vytvořit` → sheet with `Trénink` / `Série tréninků`.
9. All buttons on a card are the same size (124 × 44).
10. `Změněno` is orange and stays until the guardian opens the booking.
11. Booking cards open a detail screen (chevron `›`).
12. Buttons: primary = cobalt; cancel = white outline; red only for `Zrušit trénink`.
13. Full capacity = cobalt meter; `Dnes` = green chip; date group headings = cobalt.
14. Notes have a 200-character limit; public note has a default text.
15. Duplicate supports a single date or a period (weekday + range with per-date opt-out).
16. Toasts have no undo action.
17. Czech actor verbs/participles always use the masculine form (`Přihlásil`, `Odhlásil`, `Přihlášen`, `Narozen`); gender is not collected.
18. Coaches see the guardian's phone (optional field) and can call/SMS from the roster.
19. Coach can remove a child from a session (optional message to the parent). Parent sees an orange `Odhlášeno trenérem` badge (no strike-through), gets an e-mail, and may re-book if a place is free.

Open questions are listed at the end of each SPEC.md.
