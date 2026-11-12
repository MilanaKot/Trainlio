# Task for Claude Code: year filter, blue chips, Série tab, Více sections, button radius (handoff v3.6)

Paste this into Claude Code from the repo root. First replace `docs/design/` with the folder from the zip. This is a small UI task. It does not depend on v3.4/v3.5 beyond the screens that already exist.

---

The design handoff in `docs/design/` was updated to v3.6. Read these first:

- `README.md`: decisions 49–51 and the changelog
- `coach/SPEC.md`: **K12** (rewritten), test 11, **K15** entry, K20 entry
- `admin/SPEC.md`: A0 (`Přehledy`)
- `shared/DESIGN_SYSTEM.md`: §6.28 FilterChips (selected colour + the YearGrid variant), Button sizes, §6.18 FAB
- Prototype: `coach/prototype.html`: K12, K12b, K1, K14, K15, A0
- Source: `design-source/screens/K12-Sportovci.dc.html`, `K12b-Rocnik2017.dc.html`

The specs win over the prototypes.

Work in small commits, in this order.

1. **Selected chip colour.** In the shared `FilterChips` component, the selected chip becomes primary `#2B55E0` (token `--color-primary`) with white text instead of ink/black. Check every use: K1 `Všechny / Moje`, K20 and K20b. No screen keeps a black selected chip. Update the component's Vitest snapshot/test.
2. **YearGrid** (variant of FilterChips, DS §6.28):
   - white panel, radius 16, padding 12;
   - CSS grid with 4 equal columns, gap 8, chips centred, height 36;
   - `Všechny` first, then the years **newest first**, each with its count (13/500, muted; white 80 % on the selected chip);
   - all years always visible: no collapse, no horizontal scroll, more years just add rows;
   - single select, `role="group"` + `aria-label="Ročník"`, each chip `aria-pressed`.
3. **K12 Sportovci** (`/coach/athletes`):
   - remove the old horizontally scrolling year chips;
   - YearGrid under the search; default `Všechny`, **not remembered**: a new visit always starts on `Všechny` (no localStorage, no URL param needed);
   - years and counts come from active athletes; inactive athletes are not counted;
   - groups and grid in the same order (newest first);
   - with a year selected: only that group plus inactive athletes of that year; header meta `{shown} z {n}`;
   - search and year combine (AND); no match → `Nikdo neodpovídá hledání.`;
   - no athletes at all → hide the grid, show the existing empty state.
4. **Série tab.**
   - The Tréninky segmented control gets a third tab: `Nadcházející · Minulé · Série` (3 equal columns), on K1, K1b, K14 and K15.
   - K15 (`/coach/series`) becomes that tab: same header as K1, no back link, bottom nav `Tréninky` active (fix the longest-prefix rule if needed). Helper text + `+ Nová série` button under the tabs; the button only with `isAdmin || canEditTrainings`.
   - K16 back link → `‹ Série`.
5. **Více (A0).**
   - Remove the `Plánování` section and the `Série tréninků` row.
   - New section `Přehledy` with the `Statistiky` row → K20.
   - Order: profile, `Přehledy`, `Správa` (admin only), `Účet`, sign out.
6. **Button radius.** One token `--radius-button: 12px` used by every text button: Button md/sm/lg, FAB (no longer a pill), header actions (`+ Nová série`, `+ Přidat sportovce`), secondary/outline buttons, the toast `Vrátit`, and the e-mail CTA in the templates (+ VML `arcsize` ≈ 25 %). Chips/filters stay pills; StatusToggle keeps §6.36. Grep for leftover `rounded-full` / radius 10 / 28 on buttons.
7. **Tests.**
   - Update coach test 11 (Playwright 390×844): seed 9 birth years and assert every chip is in the viewport without horizontal scrolling; selecting `2018` filters and shows `x z n`; leaving the tab and coming back shows `Všechny` selected.
   - Vitest for YearGrid: order, counts, `aria-pressed`.
   - Playwright: from K1 tap `Série` → K15 with the tab selected and `Tréninky` active in the bottom nav; A0 has no `Série tréninků` row.
   - Axe: no serious violations on K12, K15 and A0.

## Done when

- All of the above tests pass.
- `tsc --noEmit`, lint and Vitest are green.
- Send me screenshots of K12 (`Všechny`), K12 with `2017` selected, K1 and K20 (to check the blue chips), K15 (Série tab), A0 Více and one form screen (buttons with the new radius).

If something is ambiguous, ask me instead of guessing.
