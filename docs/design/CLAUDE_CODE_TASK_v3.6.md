# Task for Claude Code: year filter in Sportovci + blue selected chips (handoff v3.6)

Paste this into Claude Code from the repo root. First replace `docs/design/` with the folder from the zip. This is a small UI task. It does not depend on v3.4/v3.5 beyond the screens that already exist.

---

The design handoff in `docs/design/` was updated to v3.6. Read these first:

- `README.md`: decision 49 and the changelog
- `coach/SPEC.md`: **K12** (rewritten) and test 11
- `shared/DESIGN_SYSTEM.md`: §6.28 FilterChips (selected colour + the YearGrid variant)
- Prototype: `coach/prototype.html`, K12 and K12b (group "Athletes")
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
4. **Tests.**
   - Update coach test 11 (Playwright 390×844): seed 9 birth years and assert every chip is in the viewport without horizontal scrolling; selecting `2018` filters and shows `x z n`; leaving the tab and coming back shows `Všechny` selected.
   - Vitest for YearGrid: order, counts, `aria-pressed`.
   - Axe: no serious violations on K12.

## Done when

- All of the above tests pass.
- `tsc --noEmit`, lint and Vitest are green.
- Send me screenshots of K12 (`Všechny`), K12 with `2017` selected, K1 and K20 (to check the blue chips).

If something is ambiguous, ask me instead of guessing.
