# Schema

Trainlio — Sports Training Booking Platform

Reviewed schema proposal for Phase 1. These files are promoted to
`supabase/migrations/` once the architecture is approved; they are not applied
automatically, in keeping with the original warning that a domain sketch is not a
substitute for reviewed migrations.

Apply in order:

| File | Layer |
|---|---|
| `01_enums.sql` | Database invariants |
| `02_core_tables.sql` | Database invariants |
| `03_operational_tables.sql` | Database invariants |
| `04_outbox_and_audit.sql` | Notification outbox, audit trail |
| `05_triggers_and_indexes.sql` | Database invariants |
| `06_authz_helpers.sql` | RLS authorization |
| `07_rls_policies.sql` | RLS authorization |
| `08_storage_policies.sql` | RLS authorization |
| `09_seed_reference.sql` | Reference data |

The domain operations layer — the booking, cancellation, session and series
functions — is specified in [`docs/DOMAIN_OPERATIONS.md`](../../docs/DOMAIN_OPERATIONS.md)
and implemented in Phase 1 against that contract.

## Things that are easy to undo by accident

- **No table has a DELETE policy.** That is the enforcement mechanism for the
  no-hard-delete rule, not an omission.
- **Guardians have no INSERT/UPDATE policy on `bookings`; coaches have none on
  `training_sessions`.** Adding one would let a client bypass capacity,
  eligibility, the cancellation deadline, the notification outbox and the audit
  trail.
- **`bookings` is deliberately absent from the realtime publication.** Guardians
  subscribe to `training_session_occupancy`.
- **`confirmed_count` is written only by trigger.** No application code or domain
  function may write it.
- **Composite foreign keys look redundant.** They are what makes cross-tenant and
  cross-athlete references impossible rather than merely discouraged.
- **Every SECURITY DEFINER function sets `search_path = ''`.** Removing it is a
  privilege-escalation vector.
