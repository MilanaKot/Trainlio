# Architecture

Trainlio — Sports Training Booking Platform

This document exists to keep five concerns separate. Most of the failure modes
found in the architecture review came from collapsing two of them into one: a
count that was both a privacy boundary and a concurrency control, an outbox that
was doing duty as an audit log, a policy layer expected to enforce business
rules.

## The five layers

```text
┌──────────────────────────────────────────────────────────────────────┐
│ 1. DATABASE INVARIANTS       Can this row exist at all?              │
│    constraints · composite foreign keys · triggers                   │
│    Independent of who is asking. Cannot be bypassed by any caller,   │
│    including the service role.                                       │
├──────────────────────────────────────────────────────────────────────┤
│ 2. RLS AUTHORIZATION         May this identity see or touch this row?│
│    policies · SECURITY DEFINER predicates                            │
│    Defence in depth. Bypassed by the service role by design.         │
├──────────────────────────────────────────────────────────────────────┤
│ 3. DOMAIN OPERATIONS         Is this action permitted, now?          │
│    transactional RPCs                                                │
│    Capacity, deadlines, eligibility. The only writer for bookings    │
│    and published sessions.                                           │
├──────────────────────────────────────────────────────────────────────┤
│ 4. NOTIFICATION OUTBOX       Who must be told, and did it arrive?    │
│    notification_events → notification_deliveries → drain job         │
│    Mutable, retried, drained, eventually complete.                   │
├──────────────────────────────────────────────────────────────────────┤
│ 5. AUDIT TRAIL               What happened, and by whom?             │
│    audit_log                                                         │
│    Append-only, never drained, never mutated, retained.              │
└──────────────────────────────────────────────────────────────────────┘
```

### 1. Database invariants

Enforced by the schema in migrations 02–05.

What belongs here: anything true regardless of the caller. Session end after
start. Capacity in range. A cancelled booking has a cancellation timestamp. A
facility belongs to its location, a location to its workspace, a sport profile to
its athlete. Exactly one main coach per session. An audit entry cannot be edited.

Why composite foreign keys rather than application checks: multi-tenant isolation
must not depend on application code. A session referencing another workspace's
location is invisible while one workspace exists and is a tenant breach the day
a second one appears.

What does not belong here: anything requiring `auth.uid()`, anything time-relative
beyond a column comparison, anything that must produce a user-facing message.

### 2. RLS authorization

Defined in migrations 06–08, specified in `PERMISSIONS.md`.

What belongs here: visibility. Which athletes a guardian can read, which sessions
a workspace's coaches can read, that DRAFT is staff-only, that photos are reachable
only by an active guardian or a coach of an active workspace membership.

Two deliberate absences carry weight:

- **No DELETE policy on any table.** With RLS enabled and no DELETE policy,
  deletion is impossible for client roles. That absence is the enforcement
  mechanism for the no-hard-delete rule.
- **No guardian INSERT/UPDATE on `bookings`, no coach UPDATE on
  `training_sessions`.** Those mutations exist only as domain operations.

Policies never query the table they protect; membership lookups go through
SECURITY DEFINER predicates, or they recurse infinitely.

### 3. Domain operations

Specified in `DOMAIN_OPERATIONS.md`.

What belongs here: everything time-relative or count-relative, everything that
must happen atomically with a side effect. Capacity. The cancellation deadline.
Eligibility. The coach-removal re-booking block. Producing a notification event
and an audit entry in the same transaction as the change they describe.

This is the layer that makes RLS's absences safe. A guardian's permission to book
is exercised here, not through table access, so capacity and eligibility cannot
be skipped by a client that talks to the REST API directly.

Every function that reads or changes the confirmed booking count locks the
session's occupancy row first. That single lock is what makes concurrent booking
correct, and it is per-session, so different sessions never contend.

### 4. Notification outbox

`notification_events` records that something happened which people must be told
about. `notification_deliveries` records one intended message per recipient, and
is where deduplication happens — one row per guardian per event, carrying that
guardian's own list of affected athletes.

The database stays provider-neutral. Nothing in it names Resend;
`provider_message_id` is a generic column. The provider lives behind an email
service abstraction with a single implementation, so replacing it is a code change
in one module and not a migration.

The outbox is mutable by design: status changes, attempts increment, errors are
recorded. That mutability is exactly why it cannot serve as an audit trail.

### 5. Audit trail

`audit_log` records that a domain action occurred: who, what, when, to which
entity, with before and after state.

Append-only, enforced by a trigger that rejects UPDATE and DELETE for every role
including the service role. Corrections are made by appending.

The outbox and the audit log answer different questions and have opposite
lifecycles. A session cancellation produces exactly one audit entry and N
delivery rows; the delivery rows are drained and completed, the audit entry is
never touched again.

## Cross-cutting decisions

### The occupancy projection

One table resolves three otherwise-conflicting requirements:

| Requirement | Without the projection |
|---|---|
| Guardians see `3 / 10` (BR-091) | A client-side count over `bookings` returns only the caller's own rows |
| Guardians never read others' bookings (BR-090) | — |
| Occupancy updates in real time | Realtime applies RLS per subscriber, so a guardian never receives events for another family's booking row |
| Two concurrent bookings cannot exceed capacity (BR-032) | `count` then `insert` has no row to conflict on; the default isolation level does not prevent the race |

It holds a count and nothing else, is written only by a trigger on `bookings`, is
the only booking-derived object in the realtime publication, and is the row every
booking path locks.

### Time

Every workspace carries an IANA timezone. All wall-clock reasoning happens in it:
session display, day grouping, and above all recurring series generation, where
occurrences are produced as local dates and converted individually. Adding fixed
UTC intervals is prohibited — it silently shifts a series by an hour across a
daylight-saving boundary.

The device timezone is never used for display.

### Actor identity and account deletion

Every operational table references `app_profiles`, never `auth.users`. The
profile is the durable actor; `auth_user_id` is a severable link.

This is what keeps the deferred deletion strategy (D-18) possible. Personal data
is confined to `auth.users` (email) and `app_profiles` (display name); everything
else holds an opaque profile id. Deleting an authentication record sets
`auth_user_id` to null and leaves every booking, session and audit row intact and
still correctly attributed — verified in `VALIDATION.md`.

The cost is one indirection: authorization resolves the caller through
`current_profile_id()` rather than comparing `auth.uid()` directly.

### Roles

Three distinct things, deliberately not collapsed:

| | Held in | Grants |
|---|---|---|
| Guardian | `guardian_athlete_access` + `workspace_athlete_memberships` | access to their own athletes and to sessions in workspaces where those athletes are members |
| Workspace staff | `workspace_members`, role COACH or WORKSPACE_ADMIN | coach operations within that workspace only |
| Platform admin | `platform_admins` | nothing through RLS; platform tooling runs under the service role |

A guardian is never workspace staff, and platform administration is never
inferred from workspace membership.

### Language

UI text is Czech; code, schema, comments and documentation are English. Enum
values are stable internal codes and Czech labels are resolved in the i18n layer,
so no translated label is ever stored as business data.

Czech plural agreement is a real constraint, not a formatting detail: the booking
place-count messages need plural categories, which rules out string concatenation.

### Multi-workspace readiness

Nothing in the MVP hardcodes the single workspace. The timezone, the cancellation
deadline and the primary sport are workspace columns. Tenancy is enforced by
composite foreign keys. Athletes are global and reach a workspace through an
explicit membership, so one athlete can belong to several workspaces and several
sports without duplication.
