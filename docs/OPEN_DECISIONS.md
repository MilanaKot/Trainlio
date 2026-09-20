# Open Decisions

Trainlio — Sports Training Booking Platform

**One item remains open.** D-01 through D-17 are all decided; the resulting
design is in `ARCHITECTURE.md`, `DATA_MODEL.md`, `DOMAIN_OPERATIONS.md` and
`/supabase/migrations`, and its behaviour is verified in
`/supabase/VALIDATION.md`.

---

## Deferred — due before Phase 9

### D-18 — Account deletion and anonymisation

The **workflow** is deferred by decision, to be defined before production
launch. The **architectural constraint** is applied now and is verified:

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

Still to decide before launch: the retention period, the exact anonymisation
procedure, whether `notification_deliveries.recipient_email` is scrubbed on a
schedule, and who is controller (the coach) versus processor (the platform).

---

## Decided, recorded for traceability

| # | Question | Resolution |
|---|---|---|
| D-01 | Which sessions can a guardian see? | Non-DRAFT sessions in workspaces where they have an active athlete membership. DRAFT is staff-only. Possession of the app URL is not authorization. |
| D-02 | Exact cancellation boundary | `current_time <= start_at - deadline` is allowed. At exactly the deadline, cancellation is still permitted. Server time only. |
| D-03 | Is the deadline a constant? | `workspaces.cancellation_deadline_hours`, default 12. |
| D-04 | Who sets COMPLETED? | Nobody. Upcoming/Past derive from `end_at`; no scheduled job is required. COMPLETED stays a valid explicit status. |
| D-05 | Booking N children with fewer places | **Atomic.** All selected athletes or none, with the free-place count returned. One CTA must not split siblings. Coach additions stay independent. |
| D-06 | Re-booking after a coach removal | Blocked for guardians; only a coach may restore. A guardian's own cancellation is re-bookable. Enforced on the most recent booking record, not inferred from the unique index. |
| D-07 | Coach additions to a cancelled session | Not allowed. CANCELLED is terminal: no new booking of any kind, no reopening. Duplicate Session replaces a mistaken cancellation. |
| D-08 | Narrowing eligibility with bookings | Allowed after an explicit warning naming the affected count. Nothing is auto-cancelled; only affected guardians are emailed and only affected bookings show `Změněno`. |
| D-09 | Athlete deactivation | Blocks new bookings only. All history, bookings, profiles and memberships are preserved; cancellation still works; reactivation restores eligibility. |
| D-10 | Who creates the workspace membership? | The transactional athlete creation operation. Creating a hockey profile makes the child visible to that workspace's coaches, which is what makes booking possible. |
| D-11 | Which changes are significant? | Date, start, end, location, facility, main coach. Stored as `significant_changed_at`; the marker shows when it is later than `booking.created_at`. Changing room, capacity, assistant coaches and both notes fields are not significant. |
| D-12 | Is the changing room guardian-visible? | Yes — `Příbram · MH · Šatna 4`. May be null and added later. A changing-room-only update sends no email. |
| D-13 | Session notes | Split into `public_notes` (guardian-visible) and internal notes (staff only). Internal notes are a separate table, because a column on a row guardians can read cannot be hidden by row level security. |
| D-14 | `created_by_role` when a coach books their own child | Fixed by the entry point, never inferred. |
| D-15 / D-16 | Email provider | Resend, for both transactional email and Auth OTP via custom SMTP, behind an email service abstraction. The outbox stays provider-neutral. |
| D-17 | Platform vs workspace admin | `workspace_role` is COACH and WORKSPACE_ADMIN; platform administration is a separate `platform_admins` table and is never inferred from workspace membership. Guardians are not a staff role. The generic `app_role` enum is dropped. |
| D-19 | Signed URL lifetime | 60 minutes, issued server-side. |
| D-20 | Next.js router | App Router, Server Components, Server Actions calling the domain functions. |
