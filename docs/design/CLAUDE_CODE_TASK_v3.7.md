# Task for Claude Code: parents confirm attendance — Půjde / Nepůjde (handoff v3.7)

Paste this into Claude Code from the repo root. First replace `docs/design/` with the folder from the zip. Do v3.4 (attendance, payment, K13) and v3.5 (statistics) first: this task changes how attendance is counted.

---

The design handoff in `docs/design/` was updated to v3.7. Read these first:

- `README.md`: decisions 52–55 and the changelog
- `guardian/SPEC.md`: G4 footer, G5 self-cancelled, G6 footer, **Účast — Půjde / Nepůjde (G6f–G6i)**, tests 4 and 11–14
- `coach/SPEC.md`: **K2 · Účast rodičů (K2, K2n)**, **K13 · Účast**, tests 30–33
- `shared/EMAILS.md`: **E10** and §4
- `shared/DESIGN_SYSTEM.md`: **§6.38 ResponseBlock**
- Prototypes:
  - `guardian/prototype.html`: G4, G6f, G6g, G6h, G6i;
  - `coach/prototype.html`: K2, K2n, K13, K13z.
- E-mail: `emails/E10-Omluvenka.html`

The specs win over the prototypes. G6 and G6b in the prototype still show the old `Odhlásit` footer; build them with the v3.7 Účast block and footer instead. G6c (cancel locked) was removed.

Work in small commits, in this order.

1. **Data + security.**
   - Migration on `bookings`:
     - `guardian_response` (`going` / null), `responded_at`, `responded_by`;
     - new status value `cancelled_by_guardian` (reuse the existing self-cancel status if there is one, and rename it in the UI only);
     - `cancel_reason` (text, 1–200 after trim, required for this status), `cancelled_at`, `cancelled_by`, `cancel_late` (boolean).
   - Server actions, validated with Zod, allowed only to a guardian of that athlete:
     - `confirmGoing(bookingId)`: allowed until the session start;
     - `cancelWithReason(bookingId, reason)`: allowed until the session start. In one transaction it sets the status, the reason, `cancel_late = now() > cancellation deadline` and frees the place. Then it sends E10.
   - Remove the old guardian `cancelBooking` action, or make it call `cancelWithReason`. No guardian cancellation without a reason.
   - RLS: the reason is readable by all coaches of the session (also read-only coaches) and by the guardians of that athlete; never by other guardians.
   - Re-booking after `Nepůjde` is allowed while there is capacity and the session has not started. It creates a new booking with no response.
2. **Attendance counting** (`lib/stats.ts`, K13, G8b): percent = Byl / (Byl + Nebyl + guardian cancellations). Count the cancellations of held sessions only. Coach removals (E07) and cancelled sessions are excluded. Update the existing Vitest cases and add new ones.
3. **Guardian UI.**
   - **ResponseBlock** (DS §6.38): a shared component with Vitest tests.
   - **G4:** the badge `Potvrďte účast`; card footers per spec; remove the `Odhlásit` dialog.
   - **G6:** the Účast block above the DetailList; footer = deadline hint only; remove the G6c locked state.
   - **G6g:** the reason sheet with quick chips; a chip prefills `{chip} – ` and focuses the textarea; counter `x / 200`; confirm disabled until valid.
   - **G6i:** the cancelled state with `Přihlásit znovu`.
   - **G5:** self-cancelled cards get the `Nepůjde` badge.
   - Toasts: `Potvrzeno: {Jméno} půjde`, `Odhlášeno`.
4. **Coach UI.**
   - **K2n** (before start): `Půjde` / `Nepotvrzeno` at the start of the card meta; `Potvrdili účast x z n`; `Byl –`; `Ostatní byli` disabled.
   - **K2 / K2n:** the `NEPŮJDOU · n` section with reason quotes and the `Pozdě` tag; footnote.
   - **K2b** (read-only) shows the same section.
   - **K13:**
     - Tréninky tab: response in the upcoming rows, cancelled rows with the reason, footnote;
     - Zprávy tab: an `Omluvenka od rodiče` entry.
5. **E-mail E10** per `shared/EMAILS.md`:
   - sent to the main coach, or to all admins when the session has no main coach;
   - Reply-To = the guardian;
   - the `Upozornění` row when late;
   - plain-text part.
6. **Tests.**
   - Playwright 390×844: guardian tests 11–14 and the updated test 4; coach tests 30–33.
   - Vitest: attendance counting and reason validation (trim, 200 chars).
   - Axe: no serious violations on G6f, G6g, G6i, K2n.

## Done when

- All of the above tests pass.
- `tsc --noEmit`, lint and Vitest are green.
- Send me screenshots of:
  - G4 with an unconfirmed and a confirmed card;
  - G6f, G6g (filled), G6h and G6i;
  - K2n and the `NEPŮJDOU` section in K2;
  - K13 Tréninky and Zprávy;
  - E10.

If something is ambiguous, ask me instead of guessing.
