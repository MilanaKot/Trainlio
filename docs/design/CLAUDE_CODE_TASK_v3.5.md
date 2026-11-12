# Task for Claude Code: statistics + season periods (handoff v3.5)

Paste this into Claude Code from the repo root. First replace `docs/design/` with the folder from the zip. This task builds on v3.4 (attendance, payment, the K13 player card), so do `CLAUDE_CODE_TASK_v3.4.md` first.

---

The design handoff in `docs/design/` was updated to v3.5. Read these first:

- `README.md`: decisions 47–48 and the changelog
- `coach/SPEC.md`:
  - **K20**, **K20b**;
  - K13 period control;
  - tests 27–29.
- `admin/SPEC.md`: A0 row `Statistiky`
- `guardian/SPEC.md`: G8b period control
- Prototypes:
  - `coach/prototype.html`, group "Statistics": K20, K20b, K13 season view;
  - `guardian/prototype.html#G08b-ProfilDochazka`.

The specs win over the prototypes.

Work in small commits, in this order.

1. **Season helper.** Add `lib/period.ts`:
   - `Period = { kind: "month" | "season", start, end }`;
   - a season runs 1 August – 31 July, Europe/Prague;
   - labels: `Listopad 2026`, `Sezóna 2026/27`;
   - `prev` / `next`;
   - the default is the period that contains today.

   Unit tests: boundaries on 31 Jul / 1 Aug, DST, Czech month names.
2. **Rename `Rok` → `Sezóna`** everywhere the period switch exists: K13, G8b, and the new K20/K20b. The K13 season view has the same layout as the month view, with no charts.
3. **Statistics queries.** One server module `lib/stats.ts`, using SQL views or RPC; aggregate in Postgres, not in JS. Every metric takes `(period, yearFilter?, coachFilter?)`.
   - `sessionsHeld`: excludes cancelled sessions.
   - `occupancy`: Σ bookings / Σ capacity.
   - `attendance`: present / (present + absent). Unmarked bookings of ended sessions count as absent.
   - `paidRate`: paid / bookings of held sessions.
   - `unpaidByAthlete`: athletes with their count of unpaid bookings, sorted by count, descending.
   - `lowestAttendance`: only athletes with at least 3 sessions in the period.
   - `byCoach`: count and attendance per coach, either as main coach or as main coach + assistant.
   - `coachWeekly`: per week of a month, per month of a season.

   Use RLS-safe views: no guardian may read them.
4. **K20 Statistiky** (`/coach/stats`):
   - A0 row with a chart icon;
   - period control, year and coach dropdown chips;
   - 4 tiles;
   - `Nezaplaceno` (top 3 + `Vše`), `Nejnižší docházka` (top 3 + `Všichni hráči` full list);
   - `Trenéři` block, **admin only**;
   - footnote, empty state.
5. **K20b** (`/coach/stats/coach/[id]`):
   - chips `Hlavní trenér + asistent` / `Jen hlavní`;
   - 4 tiles;
   - bar chart with a text alternative;
   - list of sessions → K2.
   - Server check: a non-admin may open only his own id; anything else returns 403.
6. **Tests.** Coach tests 27–29, Vitest for `period.ts` and `stats.ts` (against a seeded DB), and Axe on K20 and K20b.

## Done when

- All of the above tests pass.
- `tsc --noEmit`, lint and Vitest are green.
- Send me screenshots of K20 (admin and non-admin), K20b, K13 in month and season view, and G8b in season view.

If something is ambiguous, ask me instead of guessing.
