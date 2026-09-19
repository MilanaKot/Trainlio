# Data Model

Trainlio — Sports Training Booking Platform

The authoritative definition is `/supabase/schema`. This document explains the
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

## users
Backed by Supabase Auth.

Application profile table:
- id UUID, FK auth.users
- display_name
- created_at
- updated_at

## workspace_members

Workspace-scoped staff membership:
- id
- workspace_id
- user_id
- role: COACH | ADMIN
- is_active
- created_at
- updated_at

A user may hold several roles in a workspace, so role checks use existence, never
equality.

The role enum deliberately excludes USER: being a guardian is an athlete
relationship, not a workspace membership.

## platform_admins

Platform-level administration, distinct from workspace ADMIN:
- user_id
- created_at

Supersedes the earlier `user_roles` sketch, which had no place to store a
platform-level administrator. Pending confirmation — see `OPEN_DECISIONS.md`
(D-17).

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
- user_id
- athlete_id
- relationship_code
- permission_level
- status
- invited_by_user_id nullable
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

| Constraint | Guarantees |
|---|---|
| `(athlete_sport_profile_id, athlete_id)` → `athlete_sport_profiles` | the profile belongs to this athlete |
| `(athlete_sport_profile_id, sport_id)` → `athlete_sport_profiles` | `sport_id` is that profile's sport |
| `(workspace_id, sport_id)` → `workspaces (id, primary_sport_id)` | that sport is the workspace's sport |

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
- main_coach_user_id
- start_at timestamptz
- end_at timestamptz
- changing_room nullable
- capacity integer default 10
- eligibility_mode
- birth_year_from nullable
- birth_year_to nullable
- status
- notes nullable
- series_id nullable
- last_significant_change_at nullable
- created_by_user_id
- created_at
- updated_at
- cancelled_at nullable
- cancelled_by_user_id nullable

Eligibility modes:
- ALL
- BIRTH_YEAR_RANGE

`last_significant_change_at` replaces the former `updated_marker` boolean. As a
timestamp it can be compared against a booking's creation time, so a guardian who
booked after a change is not shown a stale `ZMĚNĚNO` badge, and the question of
when a boolean flag would be cleared does not arise.

Composite foreign keys enforce that the facility belongs to the location, the
location belongs to the workspace, and the sport is the workspace's sport.
A check constraint keeps `status = 'CANCELLED'` and the cancellation columns in
agreement.

## session_series

- id
- workspace_id, sport_id, location_id, facility_id, main_coach_user_id
- frequency — WEEKLY in MVP
- by_weekday — ISO 1 = Monday .. 7 = Sunday
- local_date_from, local_date_to
- local_start_time, local_end_time
- generated_in_timezone, generated_count, generated_at
- template fields: capacity, eligibility_mode, birth_year_from/to, changing_room, notes
- created_by_user_id, created_at, updated_at

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
- created_by_user_id
- created_by_role
- coach_capacity_override boolean
- created_at
- cancelled_at nullable
- cancelled_by_user_id nullable

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
restrict the capacity override flag to bookings created by a coach or admin.

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
- recipient_user_id
- recipient_email
- payload jsonb — per-recipient content, notably that guardian's affected athletes
- status — PENDING, SENDING, SENT, FAILED
- attempt_count, last_error
- provider_message_id nullable
- created_at, updated_at, sent_at nullable

Unique on `(event_id, recipient_user_id)`: this is the deduplication mechanism,
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
- actor_user_id nullable — null for system actions
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
