# Task for Claude Code: payment, coach notes and messages per booking + app icon (handoff v3.3)

Paste this into Claude Code from the repo root. It assumes the handoff lives in `docs/design/`. Replace that folder with the new one from the zip first.

---

The design handoff in `docs/design/` was updated to v3.3. Read these first:

- `README.md`: decisions 34–37 and the changelog
- `coach/SPEC.md`:
  - K2 item 6 (roster);
  - **K17 / K17b** (player card);
  - **K2c** (mark all as paid);
  - `RosterEntry` type;
  - tests 19–23.
- `guardian/SPEC.md`: **G6e** (`Zaplaceno` + message from the coach)
- `shared/EMAILS.md`: **E09** `COACH_MESSAGE_TO_GUARDIAN`, and §4 (no e-mail for payment)
- `shared/DESIGN_SYSTEM.md` §6.35 PaymentChip
- `shared/app-icon/README.md`
- Visual reference:
  - `coach/prototype.html`: K2, then group "Player card & payment"
  - `guardian/prototype.html#G06e-ZpravaZaplaceno`
  - `emails/E09-ZpravaTrenera.html`

The specs win over the prototypes.

Work in small commits, in this order.

1. **Data + security.**
   - Migration on `bookings`:
     - `paid_at timestamptz null`, `paid_by uuid null` (references coach);
     - `coach_note text null check (char_length(coach_note) <= 200)`;
     - `parent_message text null check (char_length(parent_message) <= 500)`, `parent_message_sent_at timestamptz null`, `parent_message_sent_by uuid null`.
   - Keep `coach_note` out of anything a guardian can read: a separate column privilege or view, plus RLS. Guardians may read only `paid` (boolean derived from `paid_at`) and the parent message fields of their own children's bookings.
   - Server actions, all guarded by `assertCanEditSession` (decision 33):
     - `setBookingPaid(bookingId, paid)`;
     - `markAllPaid(sessionId)`: one transaction, only bookings that are not yet paid;
     - `setCoachNote(bookingId, text)`;
     - `sendParentMessage(bookingId, text)`: saves and sends E09.
   - Validate everything with Zod.
   - Tests: RLS proves a guardian session never receives `coach_note`; `markAllPaid` leaves already-paid rows untouched.
2. **E-mail E09** (`shared/EMAILS.md`): reuse the existing template. Send to all guardians of the athlete. Plain-text part. Snapshot test. Payment changes send nothing.
3. **Shared UI.** `PaymentChip` (§6.35) with a Vitest test.
4. **Coach K2 roster.**
   - Payment bar `Zaplaceno {x} z {n}` + `Zaplatili všichni`. Show the static `Zaplatili všichni ✓` when nobody is left unpaid.
   - PaymentChip on each row.
   - Note / message indicators after the name.
   - A row opens K17.
5. **K17 player card** (BottomSheet):
   - guardian row with a call button;
   - payment checkbox that saves immediately (optimistic, rolls back on error with a toast);
   - coach note textarea that saves on blur, plus the read-only general athlete note;
   - parent message editor, then the sent state (K17b) with `Upravit a poslat znovu`;
   - `Hotovo`, and `Odhlásit z tréninku` (the existing remove flow).
   - Read-only variant for coaches who cannot edit that session.
6. **K2c** confirmation sheet for `Zaplatili všichni`: list the unpaid athletes, use Czech plurals.
7. **Guardian G6e.**
   - `Zaplaceno` badge in the detail header, only when paid.
   - `Zpráva od trenéra` section, also on past bookings.
   - No payment info on G4 cards.
8. **App icon.**
   - Put `favicon.ico`, `icon.svg` (= `favicon.svg`) and `apple-icon.png` (= `apple-touch-icon.png`) in `app/`.
   - Copy the PNGs to `public/icons/`.
   - Add `app/manifest.ts` from `shared/app-icon/README.md`.
   - Remove any club logo used as a favicon.
9. **Tests.** Playwright at 390×844, coach tests 19–23. Axe must show no serious violations on K2, K17 and G6e.

## Done when

- All of the above tests pass.
- `tsc --noEmit`, lint and Vitest are green.
- Send me screenshots of:
  - K2 with mixed payment;
  - K17 empty and K17b filled;
  - K2c;
  - G6e;
  - the rendered E09;
  - the browser tab showing the new favicon.

If something is ambiguous, ask me instead of guessing.
