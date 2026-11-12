# Task for Claude Code: design handoff v3 (answers to DESIGN_REQUESTS.md)

Paste this into Claude Code from the repo root. It assumes the handoff lives in `docs/design/`.

---

The design handoff in `docs/design/` was updated to v3. It answers every entry of `docs/DESIGN_REQUESTS.md`.

Read these first:
1. `docs/design/DESIGN_REQUESTS_ANSWERS.md`
2. `docs/design/README.md`: decisions 23–32 and the changelog

Then:
- Record the decisions in `docs/DESIGN_DEVIATIONS.md` / `docs/OPEN_DECISIONS.md`.
- Clear the answered entries out of `docs/DESIGN_REQUESTS.md`. That file should only hold what is still open.

Implement in this order, one small PR or commit per step. The specs win over the prototypes.

1. **DR-04: footers of a booking removed by the coach** (`guardian/SPEC.md` G4b, G6d).
   - Add the migration for an optional `coach.phone`.
   - On the G4b card, replace the current sentence with `Znovu přihlásit může jen trenér`.
   - G6d: add the coach contact block with `tel:` / `sms:` links. When the coach has no phone, show no buttons.
   - Update AC-042a and add a test for the contact links.
2. **DR-13: HEIC.**
   - Accept heic/heif files.
   - Convert them in the browser with a lazily loaded converter.
   - Use the states and error text from `guardian/SPEC.md` (photo row).
3. **DR-12 + DR-05: e-mails** (`shared/EMAILS.md`, visual reference `emails/*.html`).
   - Rebuild the layout from §1: Arial/Helvetica, a 520 px card, and an HTML button that is not an image.
   - Implement E01–E08, including the new `BOOKING_ADDED_BY_COACH`.
   - Merge several significant changes made in one save into a single e-mail.
   - Plain-text part with the same content.
   - Snapshot tests per event, plus AC-072/073 (two children in one e-mail).
4. **DR-02: coach past trainings** (`coach/SPEC.md` K1, K14).
   - Segmented control on K1.
   - Past rows show a count with Czech plurals and no meter.
   - No FAB on the past tab.
5. **DR-01: coach athletes** (`coach/SPEC.md` K12, K13).
   - Search: diacritics-insensitive, also matches guardian names.
   - Year chips and grouping by birth year.
   - New athlete screen, read-only except the internal note.
   - Add an RLS test: the internal note never reaches a guardian session.
6. **DR-03: series** (`coach/SPEC.md` K15, K15b, K16, `admin/SPEC.md` A0 row `Série tréninků`).
   - Series list, empty state, filtered list of one series.
   - Show `Upraveno mimo sérii` on a training that was changed individually.
   - No series editing anywhere.
7. **DR-07: coach invitation** (`admin/SPEC.md` A1, A2, A3–A3c, A6; `coach/SPEC.md` K0).
   - Coach fields: `email`, `invitedAt`, `firstSignInAt`, `lastSeenAt`. Derive the access state from them.
   - Invitation e-mail. The link opens login with the e-mail prefilled and sends the code.
   - Resend limited to once an hour.
   - A unique e-mail across coaches and guardians.
   - K0 shown once.
   - Admin tests 11–13.
8. **DR-08: admin role** (`admin/SPEC.md` A3 `ROLE`, A3d, A3e).
   - Server-side `LAST_ADMIN` guard.
   - Deactivating a coach revokes the role.
   - Confirmation when an admin removes their own role.
   - Admin tests 14–15.
9. **DR-06: components** (`shared/DESIGN_SYSTEM.md` §6.11, 6.13, 6.17, 6.24–6.31).
   - Align the existing Stepper, Switch, CodeInput, radio pills, tab bar and picker sheets with the entries.
   - Add SearchField, FilterChips, WeekdayBadges, AccessStatus and ContactActions as shared components with Vitest tests.

## Done when

- The new acceptance tests pass in Playwright at 390×844:
  - coach tests 10–15;
  - admin tests 11–15;
  - guardian test 7b (updated).
- Axe shows no serious violations on K12, K13, K14, K15, A2, A3b, G6d.
- `tsc --noEmit`, lint and Vitest are green.
- Send me screenshots of K12, K13, K14, K15, K16, A3b, A3d, G6d, and one rendered e-mail (E02 with two children).

If something conflicts with a **Fixed** constraint from `DESIGN_REQUESTS.md`, or is ambiguous, ask me instead of guessing.
