# Permissions and RLS

Trainlio — Sports Training Booking Platform

## General rule
All application tables must have Row Level Security enabled.

Do not trust client-side role checks.

## What RLS is and is not

Row level security answers one question: may this identity see or touch this row
at all? It is defence in depth.

It does **not** enforce capacity, cancellation deadlines, eligibility,
notification or audit behaviour. Those are enforced by transactional domain
functions, specified in `DOMAIN_OPERATIONS.md`.

The division is deliberate and load-bearing:

| Layer | Question | Mechanism |
|---|---|---|
| Database invariants | Can this row exist at all? | Constraints, composite foreign keys, triggers |
| RLS authorization | May this identity see or touch this row? | Policies plus SECURITY DEFINER predicates |
| Domain operations | Is this action permitted now, and what else must happen atomically? | RPC / server-side transactions |
| Notification outbox | Who must be told, and was it delivered? | `notification_events` → `notification_deliveries` |
| Audit trail | What happened, and by whom? | `audit_log`, append-only |

## Mutations that are RPC-only

Guardians have **no** INSERT or UPDATE policy on `bookings`.
Coaches have **no** INSERT or UPDATE policy on `training_sessions`.

A guardian's permission to create a booking is exercised through the booking
function, not through table access. Without this, a client could insert a row
that ignores capacity, eligibility and the cancellation deadline. Likewise, a
direct session UPDATE would let a coach move a session without producing the
notification that BR-061 requires or the audit entry that BR-130 requires.

## Deletion

No table has a DELETE policy. With row level security enabled and no DELETE
policy, deletion is impossible for the anon and authenticated roles. That absence
is the enforcement mechanism for the no-hard-delete rule, not an oversight.

## SECURITY DEFINER helper predicates

Policies must not query the table they protect: a policy on `workspace_members`
that selects from `workspace_members` recurses infinitely. Membership lookups are
therefore wrapped in SECURITY DEFINER functions.

Every SECURITY DEFINER function in this project must:

- set an explicit, empty `search_path` and schema-qualify every identifier, so no
  attacker-controlled schema can shadow a referenced object;
- expose the minimum behaviour required, returning a boolean or a count rather
  than a row set that could leak identities;
- have EXECUTE revoked from PUBLIC and granted explicitly to the roles that need it.

Function EXECUTE privileges are reviewed explicitly rather than left at the
PostgreSQL default.

## Guardian

May:
- read own app profile;
- read athletes with ACTIVE guardian access;
- create an athlete and automatically receive guardian access;
- update athletes with ACTIVE guardian access;
- read sport profiles for athletes they can access;
- create/update sport profiles for athletes they can access;
- read non-DRAFT sessions in workspaces where at least one of their athletes
  holds an active membership;
- read own athletes' bookings, including bookings of a deactivated athlete;
- read a session's public notes, changing room and main coach name;
- create normal bookings for own linked athletes;
- cancel own athletes' bookings only when server-side cancellation rule allows.

May not:
- read sessions of a workspace where they have no athlete;
- read DRAFT sessions;
- read other families' athlete identities;
- insert or update booking rows directly;
- re-book an athlete a coach has removed from a session;
- read other families' bookings;
- read another user's email;
- read a session's internal notes;
- book into a cancelled session;
- exceed session capacity;
- modify sessions;
- bypass age eligibility;
- cancel inside 12 hours.

## Coach

May:
- read sessions in workspace;
- create/update/cancel sessions in workspace;
- read athlete profiles for athletes active in workspace;
- read sport profile relevant to workspace sport;
- read session roster;
- manually book workspace athletes;
- intentionally override capacity;
- cancel bookings at any time;
- see created_by user for bookings.

May not:
- edit athlete core profile;
- edit guardian relationships except through explicit admin/support features.

## Workspace admin

`WORKSPACE_ADMIN` is a workspace staff role alongside `COACH`. A user may hold
both, so role checks use existence, never equality.

May:
- run coach domain operations in their own workspace;
- manage that workspace's configuration.

May not:
- read or modify anything in another workspace;
- read `platform_admins`;
- gain platform administration by any route.

## Platform admin

An explicitly privileged role held in its own table. It is never inferred from
workspace membership.

A platform admin gains **no** workspace coach rights and **no** athlete access
through row level security. Platform support and investigation run through
server-side tooling under the service role, which keeps family data out of reach
of a role that exists for operational troubleshooting.

A technical support person may hold platform administration, or workspace
administration where access is intentionally limited to one workspace.

## Guardians are not a staff role

Guardian authorization runs entirely through athlete access and workspace athlete
membership. No guardian predicate consults `workspace_members`, and there is no
guardian value in the workspace role enum.

## Private athlete photos

Use a private Supabase Storage bucket.

Signed URLs or authenticated access only.

Access:
- active guardian of athlete
- coach in athlete's active workspace
- authorized admin

## Booking RPC

Normal booking occurs through a SECURITY DEFINER function that, in this order:

1. locks the session occupancy row, which is the single serialization point for
   every path that reads or changes the confirmed count;
2. re-reads the session after acquiring the lock;
3. rejects an empty selection or a duplicated athlete id;
4. checks session OPEN;
5. checks session has not started;
6. checks guardian access for every selected athlete;
7. checks workspace membership and sport profile for every selected athlete;
8. checks birth-year eligibility for every selected athlete;
9. checks duplicate booking for every selected athlete;
10. checks that no selected athlete was removed from this session by a coach;
11. rejects if the number of selected athletes exceeds the remaining places;
12. inserts all bookings.

No write occurs before step 12, so the operation is all-or-nothing without
relying on rollback. Multi-athlete booking is atomic: either every selected
athlete is booked, or none is, and the rejection reports the number of available
places.

Coach manual booking uses a separate privileged function, one athlete per call,
which records override status and may exceed capacity when the coach explicitly
confirms.

## Occupancy and privacy

Guardians must see occupancy without being able to read other families' bookings.
Occupancy is therefore read from a database-maintained projection that contains a
count and nothing else — no athlete identities, no booking identities, no
per-booking timestamps.

Booking rows are never added to the realtime publication. Guardian realtime
subscriptions use the occupancy projection.

The projection is also the lock target that serializes the capacity check.

## Cancellation RPC

Guardian cancellation must calculate the 12-hour rule on the server using session start_at.

Never accept a client-provided `can_cancel=true`.

## Session update RPC/server action

If capacity is reduced below occupancy:
- require explicit confirmation flag from coach;
- verify coach permission;
- preserve bookings.

## Notification and audit access

`notification_events`, `notification_deliveries` and `audit_log` have no policies
for any authenticated role. They are service-role only. `notification_deliveries`
in particular holds guardian email addresses.

The audit log rejects UPDATE and DELETE for every role, including the service
role. Corrections are made by appending.

## Email privacy

Guardian emails are not exposed to other guardians.

Application should use auth identity/email server-side for notifications rather than copying email into public domain tables unnecessarily.
