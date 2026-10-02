# Open Decisions

Trainlio — Sports Training Booking Platform

**Nothing remains open.** D-01 through D-20 are decided; the resulting design
is in `ARCHITECTURE.md`, `DATA_MODEL.md`, `DOMAIN_OPERATIONS.md` and
`/supabase/migrations`, and its behaviour is verified in
`/supabase/VALIDATION.md`.

D-18's workflow was the last to close, in Phase 9. Two of its values are
**policy, not architecture**, and the club owns them — they are workspace
settings with defaults, changed with SQL and not with a deploy:

| Setting                                    | Default        | Meaning                                                                                                                 |
| ------------------------------------------ | -------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `workspaces.delivery_email_retention_days` | 90             | How long the delivery audit keeps the address it sent to                                                                |
| `dormant_profiles(p_inactive_days)`        | 1095 (3 years) | The window a review uses to find inactive accounts. A parameter, not stored: dormancy never erases anything on its own. |

Ninety days comfortably covers "did the cancellation reach the parents?", which
is the only question the address itself answers. Three years is the length of a
child's time in one age group, and it is a suggestion to a human reviewer rather
than a rule anything acts on.

---

## Closed in Phase 9

### D-18 — Account deletion and anonymisation

The **architectural constraint** was applied in Phase 1 and has been verified
since:

- personally identifiable account data is separable from operational history —
  email lives only in `auth.users`, display name in `app_profiles`, and every
  operational table holds an opaque profile id;
- bookings, audit records and session history are preservable without retaining
  personal data;
- no domain history depends on an `auth.users` row physically existing —
  `app_profiles.auth_user_id` is nullable with `ON DELETE SET NULL`, so deleting
  an authentication record severs the login and leaves history intact and still
  attributed;
- actor references point at the durable profile, not the authentication record,
  so a later strategy can blank a display name and stamp `anonymized_at` without
  rewriting history.

Validation confirms all four: deleting a guardian's `auth.users` row left both
their bookings attributed and both guardian links intact.

**The workflow, decided in Phase 9** (migration 19, `validation_retention.sql`):

- **Erasure is on request, never on a schedule.** `anonymize_profile()` clears
  the display name, stamps `anonymized_at`, deletes the authentication record,
  scrubs that recipient's addresses from the delivery audit, revokes their
  active guardian access, and deactivates staff membership. It deletes no
  booking, session, audit entry or delivery row, and rewrites no actor
  reference: a parent's erasure must not remove a training from the club's
  history.
- **Look before acting.** `anonymization_preview()` reports the blast radius —
  including which athletes would be left with no active guardian, the
  consequence an operator is most likely to miss.
- **A child is a different data subject.** Athlete names are cleared only on
  explicit request, and only where the profile being erased was their last
  active guardian.
- **The erasure is audited**, one entry per workspace the person was active in,
  recording who they were while that was still knowable.
- **Addresses decay on a schedule.** `scrub_notification_emails()` runs from the
  notification drain and clears `recipient_email` on settled deliveries past
  `workspaces.delivery_email_retention_days`. The delivery record and its
  profile attribution are kept.
- **Dormancy is a list, never an action.** `dormant_profiles()` finds accounts a
  retention policy would cover; a person decides. Erasure is irreversible by
  construction, and a list is not a decision.
- **Controller and processor.** The club is the controller and answers a
  parent's request; Trainlio is the processor. The procedure a coach follows is
  in `RUNBOOK.md`.

Every function is `service_role` only. There is no interface for erasure and
there is not meant to be.

---

## Decided, recorded for traceability

| #           | Question                                             | Resolution                                                                                                                                                                                                                               |
| ----------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-01        | Which sessions can a guardian see?                   | Non-DRAFT sessions in workspaces where they have an active athlete membership. DRAFT is staff-only. Possession of the app URL is not authorization.                                                                                      |
| D-02        | Exact cancellation boundary                          | `current_time <= start_at - deadline` is allowed. At exactly the deadline, cancellation is still permitted. Server time only.                                                                                                            |
| D-03        | Is the deadline a constant?                          | `workspaces.cancellation_deadline_hours`, default 12.                                                                                                                                                                                    |
| D-04        | Who sets COMPLETED?                                  | Nobody. Upcoming/Past derive from `end_at`; no scheduled job is required. COMPLETED stays a valid explicit status.                                                                                                                       |
| D-05        | Booking N children with fewer places                 | **Atomic.** All selected athletes or none, with the free-place count returned. One CTA must not split siblings. Coach additions stay independent.                                                                                        |
| D-06        | Re-booking after a coach removal                     | Blocked for guardians; only a coach may restore. A guardian's own cancellation is re-bookable. Enforced on the most recent booking record, not inferred from the unique index.                                                           |
| D-07        | Coach additions to a cancelled session               | Not allowed. CANCELLED is terminal: no new booking of any kind, no reopening. Duplicate Session replaces a mistaken cancellation.                                                                                                        |
| D-08        | Narrowing eligibility with bookings                  | Allowed after an explicit warning naming the affected count. Nothing is auto-cancelled; only affected guardians are emailed and only affected bookings show `Změněno`.                                                                   |
| D-09        | Athlete deactivation                                 | Blocks new bookings only. All history, bookings, profiles and memberships are preserved; cancellation still works; reactivation restores eligibility.                                                                                    |
| D-10        | Who creates the workspace membership?                | The transactional athlete creation operation. Creating a hockey profile makes the child visible to that workspace's coaches, which is what makes booking possible.                                                                       |
| D-11        | Which changes are significant?                       | Date, start, end, location, facility, main coach. Stored as `significant_changed_at`; the marker shows when it is later than `booking.created_at`. Changing room, capacity, assistant coaches and both notes fields are not significant. |
| D-12        | Is the changing room guardian-visible?               | Yes — `Příbram · MH · Šatna 4`. May be null and added later. A changing-room-only update sends no email.                                                                                                                                 |
| D-13        | Session notes                                        | Split into `public_notes` (guardian-visible) and internal notes (staff only). Internal notes are a separate table, because a column on a row guardians can read cannot be hidden by row level security.                                  |
| D-14        | `created_by_role` when a coach books their own child | Fixed by the entry point, never inferred.                                                                                                                                                                                                |
| D-15 / D-16 | Email provider                                       | Resend, for both transactional email and Auth OTP via custom SMTP, behind an email service abstraction. The outbox stays provider-neutral.                                                                                               |
| D-17        | Platform vs workspace admin                          | `workspace_role` is COACH and WORKSPACE_ADMIN; platform administration is a separate `platform_admins` table and is never inferred from workspace membership. Guardians are not a staff role. The generic `app_role` enum is dropped.    |
| D-19        | Signed URL lifetime                                  | 60 minutes, issued server-side.                                                                                                                                                                                                          |
| D-20        | Next.js router                                       | App Router, Server Components, Server Actions calling the domain functions.                                                                                                                                                              |
| D-18        | Account deletion and anonymisation                   | Closed in Phase 9 — see above.                                                                                                                                                                                                           |

## Decided by the design handoff, v3 (2 October 2026)

The designer answered `docs/design/DESIGN_REQUESTS.md`; the answers are in
`docs/design/DESIGN_REQUESTS_ANSWERS.md` and the numbered decisions 23–32 of
`docs/design/README.md`. Four of them changed what the schema has to do, and
are recorded here because a later reader will meet the consequence before the
reason.

| #    | Question                                         | Resolution                                                                                                                                                                                                                                                                                                      |
| ---- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-21 | Where does a coach's telephone number live?      | `staff_contacts`, a table with row level security on, no policy and no grant — not a column on `app_profiles`, which every parent may read for a staff member in order to learn who leads a training. A parent is given the number in exactly two places: the removed-booking footer (§G6d) and the e-mail E07. |
| D-22 | Where does an invited coach's e-mail live?       | The same table. `app_profiles` holds no e-mail by design, and an invited coach has no `auth.users` row yet — there is nowhere else for it to be until they first sign in. It is unique across the whole application, because the first sign-in attaches the authentication record to the profile that holds it. |
| D-23 | One e-mail per changed field, or per save?       | Per save. A coach who moves a training and changes the hall in one edit sends one message with both rows highlighted, under `SESSION_CHANGED`; a single change keeps its own event type so the subject can still name it.                                                                                       |
| D-24 | Is a parent told when a coach books their child? | Yes — E08, with the deadline by which they can undo it, and for an over-capacity addition too. A guardian's own booking still raises nothing.                                                                                                                                                                   |
