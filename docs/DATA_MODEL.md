# Data Model

Trainlio — Sports Training Booking Platform

The authoritative definition is `/supabase/migrations`. This document explains the
shape and the reasoning; the SQL enforces it.

## Design principles

The athlete identity is sport-independent.

Sport-specific attributes live in sport profiles.

Workspace membership is separate from sports club membership.

Relationships that define tenancy are enforced by composite foreign keys, not by
application code. A session cannot reference a facility from another location, a
location from another workspace, or a sport that is not the workspace's sport.
A membership cannot reference a sport profile belonging to another athlete.

Tables carrying operational history use restrictive delete behaviour. Domain
entities are deactivated, never deleted.

## Entity relationships

```text
USER
  |
  | M:N
  v
GUARDIAN_ATHLETE_ACCESS
  |
  v
ATHLETE
  |
  | 1:N
  v
ATHLETE_SPORT_PROFILE ----> SPORT
  |
  | M:N through workspace memberships
  v
WORKSPACE_ATHLETE_MEMBERSHIP ----> WORKSPACE
                                     |
                                     +--> LOCATION --> FACILITY
                                     |
                                     +--> SESSION_SERIES
                                     |          |
                                     v          v (generates, independent after)
                              TRAINING_SESSION
                                     |
                    +----------------+----------------+
                    v                                 v
                 BOOKING                TRAINING_SESSION_OCCUPANCY
                    |                   (DB-maintained count only)
                    +--> (trigger) -----------^
```

Cross-cutting, workspace-scoped:

```text
WORKSPACE --> NOTIFICATION_EVENT --> NOTIFICATION_DELIVERY   (outbox, drained)
WORKSPACE --> AUDIT_LOG                                      (append-only, retained)
```

## app_profiles

The durable actor record. Every operational table references it; nothing in the
domain references `auth.users` directly.

- id
- auth_user_id — nullable, unique, FK to auth.users with ON DELETE SET NULL
- display_name
- anonymized_at
- created_at
- updated_at

The split exists so the deferred account-deletion strategy remains possible
(D-18). Email lives only in `auth.users` and is read server-side; display name
lives here; operational tables hold an opaque profile id and no personal data.
Because `auth_user_id` is severable, deleting an authentication record removes
the login and leaves every booking, session and audit row intact and still
correctly attributed.

Authorization resolves the caller through `current_profile_id()` rather than
comparing `auth.uid()` directly, since the link can be severed.

## workspace_members

Workspace-scoped staff membership:

- id
- workspace_id
- user_id
- role: COACH | WORKSPACE_ADMIN
- is_active
- created_at
- updated_at

A user may hold several roles in a workspace, so role checks use existence, never
equality.

The role enum deliberately excludes any guardian value: being a guardian is an
athlete relationship, not a workspace membership. Guardian authorization runs
through `guardian_athlete_access` and `workspace_athlete_memberships` (D-17).

A user may hold both COACH and WORKSPACE_ADMIN.

## platform_admins

Platform-level administration, distinct from workspace administration (D-17):

- profile_id
- granted_at, granted_by

Explicitly privileged and never inferred from workspace membership. A platform
admin gains no workspace coach rights and no athlete access through row level
security: platform support runs through server-side tooling under the service
role, which keeps family data out of reach of a role that exists for operational
troubleshooting.

Supersedes the earlier `user_roles` sketch, which had no place to store a
platform-level administrator.

## athletes

- id UUID
- first_name
- last_name
- date_of_birth DATE
- photo_path nullable
- is_active boolean
- created_at
- updated_at

No hockey-specific columns.

## guardian_athlete_access

- id
- profile_id
- athlete_id
- relationship_code
- permission_level
- status
- invited_by nullable
- created_at
- updated_at

Expected statuses:

- ACTIVE
- INVITED
- REVOKED

## sports

- id
- code unique
- name

Initial:

- HOCKEY

Future:

- FOOTBALL
- SWIMMING
- TENNIS
- etc.

## athlete_sport_profiles

- id
- athlete_id
- sport_id
- club_name nullable
- team_or_category nullable
- jersey_number nullable
- attributes JSONB
- is_active
- created_at
- updated_at

### Hockey attributes

```json
{
  "position": "CENTER",
  "stick_side": "LEFT"
}
```

Application validation must enforce allowed values.

## workspaces

- id
- name
- primary_sport_id
- timezone — IANA zone, `Europe/Prague` for the MVP workspace
- cancellation_deadline_hours — guardian self-cancellation deadline, 12 in MVP
- is_active
- created_at
- updated_at

Current:
Příbram hockey coach workspace.

`timezone` governs all wall-clock reasoning, most importantly recurring series
generation. `cancellation_deadline_hours` keeps the 12-hour rule out of the code
so a second workspace can differ without a schema change.

Carries a composite key `(id, primary_sport_id)` so sessions and memberships can
prove their sport matches the workspace.

## workspace_athlete_memberships

- id
- workspace_id
- athlete_id
- athlete_sport_profile_id
- sport_id — carried only to support the composite keys below
- is_active
- created_at
- updated_at

One athlete may be a member of multiple workspaces.

Three composite foreign keys make an inconsistent membership impossible:

| Constraint                                                          | Guarantees                          |
| ------------------------------------------------------------------- | ----------------------------------- |
| `(athlete_sport_profile_id, athlete_id)` → `athlete_sport_profiles` | the profile belongs to this athlete |
| `(athlete_sport_profile_id, sport_id)` → `athlete_sport_profiles`   | `sport_id` is that profile's sport  |
| `(workspace_id, sport_id)` → `workspaces (id, primary_sport_id)`    | that sport is the workspace's sport |

Created as part of the transactional athlete creation operation, together with
the athlete, the guardian access row and the sport profile.

## locations

- id
- workspace_id
- name
- address nullable
- is_active

Current:
Příbram.

Carries a composite key `(id, workspace_id)` so a session can prove its location
belongs to its workspace.

## facilities

- id
- location_id
- code
- name
- facility_type
- is_active

Carries a composite key `(id, location_id)` so a session can prove its facility
is at its location.

Current:

- MH / Malá hala / RINK
- VH / Velká hala / RINK

Future facility types:

- RINK
- PITCH
- COURT
- POOL
- LANE
- GYM
- ROOM
- OTHER

## training_sessions

- id
- workspace_id
- sport_id
- location_id
- facility_id
- main_coach_profile_id
- start_at timestamptz
- end_at timestamptz
- changing_room nullable — guardian-visible (D-12)
- capacity integer default 10
- eligibility_mode
- birth_year_from nullable
- birth_year_to nullable
- status
- public_notes nullable — guardian-visible (D-13)
- series_id nullable
- significant_changed_at nullable
- created_by
- created_at
- updated_at
- cancelled_at nullable
- cancelled_by nullable

Eligibility modes:

- ALL
- BIRTH_YEAR_RANGE

`significant_changed_at` replaces the former `updated_marker` boolean. As a
timestamp it can be compared against a booking's creation time, so a guardian who
booked after a change is not shown a stale `ZMĚNĚNO` badge, and the question of
when a boolean flag would be cleared does not arise. It is set by a change to the
date, start time, end time, location, facility or main coach — and by nothing
else (D-11).

Internal notes are deliberately **not** a column here. See
`training_session_internal_notes`.

## training_session_internal_notes

- training_session_id — primary key
- notes
- updated_at, updated_by

Coach and admin only (D-13). A separate table rather than a column, because row
level security is row-level: guardians must be able to read the session row, so
no policy could hide a column on it and any guardian could select internal notes
through the REST API. With a separate table, a guardian's query returns no row at
all.

`session_series` keeps its internal notes as a plain column, because the whole
series table is staff-only and there is no row a guardian can reach.

Composite foreign keys enforce that the facility belongs to the location, the
location belongs to the workspace, and the sport is the workspace's sport.
A check constraint keeps `status = 'CANCELLED'` and the cancellation columns in
agreement.

## session_series

- id
- workspace_id, sport_id, location_id, facility_id, main_coach_profile_id
- frequency — WEEKLY in MVP
- by_weekday — ISO 1 = Monday .. 7 = Sunday
- local_date_from, local_date_to
- local_start_time, local_end_time
- generated_in_timezone, generated_count, generated_at
- template fields: capacity, eligibility_mode, birth_year_from/to, changing_room, notes
- created_by, created_at, updated_at

The recurrence pattern is stored as local wall-clock dates and times. Occurrences
are generated by stepping whole days and converting each one to an absolute
timestamp individually, so a series spanning a daylight-saving change keeps its
local start time.

`generated_in_timezone` is a snapshot, not a reference to the current workspace
timezone: it records how the existing sessions were produced.

The series is provenance and generation metadata. It is not a live template —
generated sessions are fully independent, and changing a series record never
alters them.

## training_session_occupancy

- training_session_id — primary key
- confirmed_count
- updated_at

A database-maintained projection of confirmed bookings, and the answer to a
constraint that would otherwise be unsatisfiable: guardians must see `3 / 10`
while being unable to read another family's booking rows.

It serves three purposes:

1. **Privacy** — it holds a count and nothing else. No athlete ids, no booker
   ids, no per-booking timestamps. Nothing in it can identify who is booked.
2. **Realtime** — it is the only booking-derived object guardians subscribe to.
   `bookings` is never added to the realtime publication, because row level
   security would prevent those events from reaching a guardian anyway.
3. **Concurrency** — it is the row that every booking and cancellation path locks
   before checking capacity, making it the single serialization point.

`confirmed_count` is written only by a trigger on `bookings`. No application code
and no domain function ever writes it.

## training_session_coaches

- training_session_id
- user_id
- coach_role: MAIN | ASSISTANT

Main coach may be mirrored in training_sessions for simple querying, but association table is canonical for multiple coaches.

## bookings

- id
- training_session_id
- athlete_id
- status
- created_by
- created_by_role
- coach_capacity_override boolean
- created_at
- cancelled_at nullable
- cancelled_by nullable

Statuses:

- CONFIRMED
- CANCELLED_BY_USER
- CANCELLED_BY_COACH

A partial unique index prevents more than one CONFIRMED booking for the same
athlete and session. It is a backstop; the domain function checks first so the
guardian receives a typed error rather than a constraint violation.

Re-booking after a coach removal is blocked separately, because a partial unique
index cannot express a rule about a different row. The predicate is "the most
recent booking record for this athlete and session was cancelled by a coach",
which restores correctly when the coach adds the athlete back, and is enforced by
trigger as well as checked by the domain function.

Check constraints keep status and the cancellation columns in agreement, and
restrict the capacity override flag to bookings created by staff.

`eligibility_narrowed_at` marks the individual bookings that fell outside a
narrowed birth-year range (D-08). A session-level marker cannot express this: it
would show `Změněno` to every booked guardian when only the affected families are
notified. The booking stays CONFIRMED and valid; the column records that the rule
moved under it.

## notification_events

Outbox of intent to notify:

- id
- workspace_id
- training_session_id nullable
- event_type — SESSION_CANCELLED, SESSION_SCHEDULE_CHANGED, SESSION_FACILITY_CHANGED
- payload jsonb
- created_at
- dispatched_at nullable — set once recipients have been expanded, making
  expansion idempotent after a failed drain

## notification_deliveries

- id
- event_id
- recipient_profile_id
- recipient_email
- payload jsonb — per-recipient content, notably that guardian's affected athletes
- status — PENDING, SENDING, SENT, FAILED
- attempt_count, last_error
- provider_message_id nullable
- created_at, updated_at, sent_at nullable

Unique on `(event_id, recipient_profile_id)`: this is the deduplication mechanism,
so a guardian with two booked children receives one delivery. The per-recipient
`payload` is what lets that one email name both children — the event payload
alone cannot express it.

Storing `recipient_email` is a deliberate exception to the rule against copying
emails into domain tables: an audit of where a message was sent requires the
address used. The table has no policy for any authenticated role and is readable
only by the service role.

No column names a provider. `provider_message_id` is generic, and the sending
code sits behind an email service abstraction.

## audit_log

Append-only record of important domain actions:

- id
- workspace_id
- actor_profile_id nullable — null for system actions
- action
- entity_type, entity_id
- before jsonb, after jsonb
- metadata jsonb
- created_at

Covers session creation, edit, capacity change, booking close and reopen,
cancellation, series creation, duplication, guardian and coach booking creation,
capacity override, and guardian and coach cancellation.

Update and delete are rejected by trigger for every role, including the service
role. Corrections are made by appending.

This is not the notification outbox and does not substitute for it: the outbox
records intent to tell a person something and is drained; the audit log records
that a thing happened and is retained.

## future tables

Not required for MVP:

- attendance
- payments
- waiting_list
- athlete_performance
- push_subscriptions
