# Task for Claude Code: attendance, payment, notes, messages, player card, app icon (handoff v3.4)

Paste this into Claude Code from the repo root. First replace `docs/design/` with the folder from the zip.

This task **replaces `CLAUDE_CODE_TASK_payment.md`** (v3.3). If you already started v3.3, keep the data and actions, and change the UI as described below. If v3 (`CLAUDE_CODE_TASK_v3.md`) and assistants (`CLAUDE_CODE_TASK_assistants.md`) are not done yet, do those first. This task relies on `canEdit(session)` from the assistants task.

---

The design handoff in `docs/design/` was updated to v3.4. Read these first:

- `README.md`: decisions 34–46 and the changelog. Decisions 38–46 win over 34–36 where they differ.
- `coach/SPEC.md`:
  - K2 item 6 (roster v3.4);
  - K2b, K2c, **K2e**;
  - **K13** (4 tabs);
  - K14;
  - `RosterEntry` type;
  - tests 19–26.
- `admin/SPEC.md`: A3, deactivating a main coach (**A3f**)
- `guardian/SPEC.md`: **G8b** (attendance), G6e (`Zaplaceno` + coach message), G6 `Trenér bude upřesněn`
- `shared/EMAILS.md`: E09; §4 (no e-mail for payment or attendance)
- `shared/DESIGN_SYSTEM.md`: §6.16 (undo toast exception), **§6.36 StatusToggle**, **§6.37 PlayerCard**
- Tap zones and states: `design-source/screens/K02s-StavyKarty.dc.html`
- Prototypes:
  - `coach/prototype.html`: K2, K2b, K2e, K13…K13z, K14
  - `admin/prototype.html#A03f-DeaktivovatTrenera`
  - `guardian/prototype.html`: G8b, G6e
- `shared/app-icon/README.md`

The specs win over the prototypes.

Work in small commits, in this order.

1. **Data + security.**
   - Migration on `bookings`:
     - `attendance` (`present` / `absent` / null), `attendance_by`, `attendance_at`;
     - `paid_at`, `paid_by`;
     - `coach_note` (≤ 200);
     - `parent_message` (≤ 500), `parent_message_sent_at`, `parent_message_sent_by`.
   - `coach_note` must never be readable by a guardian: column privilege or view, plus RLS. Guardians may read only these fields of their own children's bookings: `paid` (boolean), `attendance`, and the parent message fields.
   - Server actions, all guarded by `canEdit(session)`, all validated with Zod:
     - `setAttendance(bookingId, present|absent)`: refused before the session start; allowed any time after it;
     - `setPaid(bookingId, bool)`: allowed before the session too;
     - `markAllPresent(sessionId)`: only unmarked bookings;
     - `markAllPaid(sessionId)`: only unpaid bookings; one transaction; keeps existing `paid_by` / `paid_at`;
     - `setCoachNote`;
     - `sendParentMessage`: saves and sends E09.
   - **No rule links payment and attendance.**
   - Derived values:
     - percent = present / (present + absent);
     - unmarked bookings of ended sessions count as absent;
     - cancelled sessions are excluded.
   - Main-coach deactivation (A3f): one transaction that sets `main_coach_id = null` and removes him as assistant on **future** sessions only. Assigning a new main coach later sends E05.
2. **Shared UI.**
   - `StatusToggle` (§6.36): attendance and payment variants, disabled and read-only states, pressed feedback, haptic.
   - `PlayerCard` (§6.37): left link zone, right toggle zone, the exact hit areas, an 8 px scroll threshold, no long-press.
   - Undo toast variant (§6.16).
   - Vitest tests for each, including "click on a toggle never triggers the card link".
3. **Coach K2 roster**:
   - column header with live counters `Byl x/n` and `Platba x/n`;
   - cards with toggles; the left zone opens K13;
   - `Ostatní byli` without a dialog;
   - `Zaplatili všichni` opens K2c; static `Zaplatili všichni ✓` when everyone paid;
   - the attendance footnote.
   - Remove the v3.3 green bar, the PaymentChips and the K17 sheet if they were built.
4. **K13 player card** with tabs `Tréninky · Hráč · Rodiče · Zprávy` (`?tab=`):
   - **Tréninky:** month/year period, two stat tiles, upcoming sessions (attendance toggle disabled, payment toggle, `Odhlásit z tréninku` using the existing remove flow + E07), past sessions with toggles, paging.
   - **Hráč:** profile and general coach note.
   - **Rodiče:** contacts with call/SMS.
   - **Zprávy:** per-session coach notes and parent messages (E09 on send and on re-send).
   - K12 rows and K2 cards link here.
   - Delete K19 if it exists.
5. **K14** counters, **K2b** read-only roster, **K2e** + K1 `Bez hlavního trenéra` + guardian `Trenér bude upřesněn`, **A3f** sheet.
6. **Guardian:**
   - G8b attendance block (Byl/Nebyl only, month/year);
   - G6e `Zaplaceno` badge (only when paid) and coach message.
7. **E-mail E09** per `shared/EMAILS.md`, if not done in v3.3.
8. **App icon:**
   - files and `app/manifest.ts` from `shared/app-icon/`;
   - remove any club logo used as a favicon.
9. **Tests.** Playwright at 390×844, coach tests 19–26. Axe must show no serious violations on K2, K13 (all tabs), G8b and A3f.

## Done when

- All of the above tests pass.
- `tsc --noEmit`, lint and Vitest are green.
- Send me screenshots of:
  - K2 (mixed states);
  - the undo toast;
  - K2c;
  - K13 in all 4 tabs;
  - K14;
  - K2e;
  - A3f;
  - G8b;
  - the favicon in a browser tab.

If something is ambiguous, ask me instead of guessing.
