# Task for Claude Code: assistants, edit permission and "Moje" filter (handoff v3.2)

Paste this into Claude Code from the repo root. It assumes the handoff lives in `docs/design/`.

---

The design handoff in `docs/design/` was updated to v3.2. Read these first:

- `README.md`: decision 33 and the changelog
- `admin/SPEC.md`: A1, A2, A3 (`ROLE A OPRÁVNĚNÍ`), tests 16–17
- `coach/SPEC.md`: K1 (filter + role label), K2b, tests 16–18
- `shared/DESIGN_SYSTEM.md` §6.28 FilterChips and §6.34 RoleLabel
- Visual reference:
  - `coach/prototype.html`: K1, K1b, K2b
  - `admin/prototype.html`: A1, A2, A3

The specs win over the prototypes.

Work in small commits, in this order.

1. **Data + security (server first).**
   - Migration: `coach.can_edit_trainings boolean not null default true`.
   - Constraint: an admin always has `can_edit_trainings = true`. Enforce it in the DB check / trigger and in the server action.
   - **Rule:** `canEdit(session) = isAdmin || canEditTrainings || session.mainCoachId === coach.id`. The main coach can **always** edit their own training, even without the permission. Creating (new / duplicate / series) requires `isAdmin || canEditTrainings`.
   - A coach without the permission cannot change `mainCoachId` of their own training (K3 field locked, server refuses).
   - Add one helper, `assertCanEditSession(coach, session)` (plus `assertCanCreate(coach)`), and call it in every mutation:
     - create / edit / duplicate / series;
     - close / reopen registration;
     - cancel;
     - add / remove an athlete;
     - notes.
   - The helper returns `FORBIDDEN_EDIT`.
   - Mirror the rule in RLS for `sessions`, `bookings` (when made by a coach) and `session_notes`.
   - Tests:
     - a coach without the permission gets `FORBIDDEN_EDIT` on sessions where they are only an assistant, and can still read them (roster with guardian phones, internal note);
     - on sessions where they are main coach, every mutation except changing the main coach succeeds;
     - creating returns `FORBIDDEN_EDIT`.
2. **Admin UI** (A2, A3, A1).
   - A2: section `OPRÁVNĚNÍ` with the switch `Může upravovat všechny tréninky` (sub `Vytvářet nové a upravovat i tréninky jiných trenérů`), default on, plus the helper text from the spec.
   - A3: section renamed `ROLE A OPRÁVNĚNÍ`, with the second switch `Může upravovat všechny tréninky` and, when it is off, the info box `Upravuje jen tréninky, které vede jako hlavní trenér…`.
     - When `Administrátor` is on, this switch is on and disabled.
     - Turning admin off keeps the earlier value.
   - A1: meta `Jen prohlížení`.
   - Use the existing Switch component (DS §6.24).
3. **Coach list K1.**
   - FilterChips `Všechny / Moje`.
     - `Moje` = sessions where I am main coach or assistant.
     - Remember the choice per user in localStorage, with try/catch.
     - Default `Moje` for coaches without the permission.
     - Apply the same filter on K14.
   - RoleLabel `Hlavní trenér` / `Asistent` on rows where I take part.
   - Make RoleLabel a shared component with a Vitest test.
4. **UI by permission.**
   - **Session where `canEdit(session)` is false** (the coach is an assistant or is not on it) → K2b:
     - notice `Jen pro čtení` with `Tento trénink vede {main coach}. Upravit ho může hlavní trenér nebo administrátor.`;
     - **hide**, not disable: `Přidat sportovce`, the `AKCE` section, `Zrušit trénink`, removing athletes, editing notes;
     - `/edit` of such a session redirects server-side to K2b.
   - **Own training as main coach, without the permission** → the normal K2 with all actions, except:
     - `Duplikovat` is hidden;
     - in K3 the `Hlavní trenér` row is disabled, with the helper `Hlavního trenéra může změnit administrátor.`.
   - **Creating, without the permission:**
     - K1 / K14: no FAB;
     - `/new`, `?from=`, `?mode=series` redirect to K1;
     - K15 / K16: no `+ Nová série`.
   - K13: `Upravit poznámku` only with `isAdmin || canEditTrainings`.
5. **Tests.** Playwright at 390×844:
   - coach tests 16–18 (test 17 covers both cases: assistant → K2b; own training → full K2 without `Duplikovat` and with the main-coach field locked);
   - admin tests 16–17.

   Axe must show no serious violations on K1 (Moje), K2b and A3.

## Done when

- All of the above tests pass.
- `tsc --noEmit`, lint and Vitest are green.
- Send me screenshots of: K1 (Všechny), K1b (Moje, coach without the permission), K2b (his assistant training), K2 + K3 of his own training (main coach), A2, and A3 with the permission off.

If something is ambiguous, ask me instead of guessing.
