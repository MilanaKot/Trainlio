# Database

Trainlio — Sports Training Booking Platform

Migrations, applied in filename order.

| Migration | Layer |
|---|---|
| `…01_enums.sql` | Database invariants |
| `…02_core_tables.sql` | Database invariants |
| `…03_operational_tables.sql` | Database invariants |
| `…04_outbox_and_audit.sql` | Notification outbox, audit trail |
| `…05_triggers_and_indexes.sql` | Database invariants |
| `…06_authz_helpers.sql` | RLS authorization |
| `…07_rls_policies.sql` | RLS authorization, table and column grants |
| `…08_storage_policies.sql` | RLS authorization |
| `…09_seed_reference.sql` | Reference data, needed in every environment |
| `…10_auth_integration.sql` | Supabase Auth → actor record |

Reference data is a migration, not `seed.sql`: production needs the workspace,
Příbram and MH/VH too. `supabase/tests/fixtures.sql` holds dev and test fixtures
and is wired to `[db.seed]`.

The domain operations layer — the booking, cancellation, session and series
functions — is specified in [`docs/DOMAIN_OPERATIONS.md`](../docs/DOMAIN_OPERATIONS.md)
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
- **Internal session notes are a separate table, not a column.** Row level
  security is row-level; guardians must read the session row, so a column on it
  could not be hidden.
- **The occupancy trigger takes its own row lock before recounting.** Without it
  the projection drifts under concurrent inserts. See `VALIDATION.md`.
- **Nothing in the domain references `auth.users`.** Actor columns point at
  `app_profiles`, so history survives account deletion.
- **A policy must not inline a subquery against a table the caller cannot read.**
  Use a `SECURITY DEFINER` predicate in file 06.

- **A profile is created by trigger on signup.** Without migration 10 every
  policy resolves to null and the whole application reads as empty.
- **`app_profiles` grants UPDATE on `display_name` only.** The identity columns
  are what all history points at.

## Types

`src/types/database.generated.ts` is generated from these migrations.

```bash
pnpm db:types                                   # local Supabase stack
pnpm db:types:url "postgresql://…" [outfile]    # any reachable Postgres
```

The second form calls the same two libraries the CLI runs in its container, so
the output is identical; it exists because the CLI needs Docker even when given
a connection string.

## Production email

`config.toml` is the local-development configuration, and an
`[auth.email.smtp]` block in it applies locally too — where it takes mail away
from Mailpit and leaves the OTP code unreadable. Production SMTP is therefore
configured on the project itself, in Authentication → Emails → SMTP:

| Field | Value |
|---|---|
| Host | `smtp.resend.com` |
| Port | `587` |
| Username | `resend` |
| Password | the Resend API key |
| Sender | an address on a domain verified in Resend |
| Sender name | `Trainlio` |

Supabase's built-in SMTP is rate limited to a handful of messages per hour and
is not a production option (D-16).

## Validation

`pnpm db:validate` — lint plus three suites. Results in
[`VALIDATION.md`](VALIDATION.md), suites in [`tests/`](tests/).
