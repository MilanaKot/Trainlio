# Domain Operations

Trainlio — Sports Training Booking Platform

This document specifies the server-side domain functions. It is a contract for
Phase 1, not an implementation.

## Why this layer exists

Approved finding 5: guardians hold no `INSERT`/`UPDATE` privilege on `bookings`,
and coaches hold none on `training_sessions`. Every state change that carries a
business invariant, a notification or an audit consequence happens here.

| Layer | Answers | Mechanism |
|---|---|---|
| Database invariants | Can this row exist at all? | Constraints, composite FKs, triggers |
| RLS authorization | May this identity see or touch this row? | Policies + `SECURITY DEFINER` predicates |
| **Domain operations** | **Is this action permitted, now, given capacity, deadlines and eligibility — and what else must happen atomically?** | **This document** |
| Notification outbox | Who must be told, and was it delivered? | `notification_events` → `notification_deliveries` |
| Audit trail | What happened, by whom? | `audit_log`, append-only |

Every function here is `SECURITY DEFINER`, `set search_path = ''`, schema-qualified
throughout, with `EXECUTE` revoked from `PUBLIC` and granted only to `authenticated`
(or to no role at all, for the two service-role functions).

## Result shape

Functions return `jsonb` rather than raising, so the UI can render a specific
Czech message. Constraint violations still raise — those are bugs, not user errors.

```json
{ "ok": true,  "data": { } }
{ "ok": false, "code": "INSUFFICIENT_CAPACITY", "details": { } }
```

### Error codes

| Code | Meaning |
|---|---|
| `NOT_AUTHENTICATED` | No `auth.uid()` |
| `NOT_AUTHORIZED` | Caller is not an active coach of the workspace |
| `NOT_AUTHORIZED_FOR_ATHLETE` | Caller has no active `MANAGE` guardian access |
| `SESSION_NOT_FOUND` | |
| `SESSION_NOT_OPEN` | Status is not `OPEN` (`BR-030`) |
| `SESSION_ALREADY_STARTED` | `now() >= start_at` |
| `SESSION_CANCELLED` | D-07: the session is terminal and accepts no booking or edit |
| `NOT_ELIGIBLE` | Per-athlete reason in `details` |
| `ALREADY_BOOKED` | A `CONFIRMED` booking exists (`BR-031`) |
| `REMOVED_BY_COACH` | D-06: the coach removed this athlete from this session |
| `INSUFFICIENT_CAPACITY` | D-05: fewer free places than athletes requested |
| `DUPLICATE_ATHLETE_IN_REQUEST` | The same athlete id appears twice in one call |
| `EMPTY_SELECTION` | No athlete ids supplied |
| `BOOKING_NOT_FOUND` | |
| `BOOKING_NOT_CONFIRMED` | Already cancelled |
| `CANCELLATION_DEADLINE_PASSED` | `BR-040` |
| `CAPACITY_BELOW_OCCUPANCY` | Coach must resend with the confirmation flag (`BR-051`) |
| `BOOKINGS_WOULD_BECOME_INELIGIBLE` | D-08: narrowing the birth-year range past existing bookings |
| `SERIES_EMPTY` | The recurrence pattern generates no occurrence |

## The single serialization point

**Every** function that reads or changes the confirmed booking count first executes:

```sql
select confirmed_count
  from public.training_session_occupancy
 where training_session_id = p_training_session_id
   for update;
```

That includes guardian booking, coach booking, both cancellation paths and the
session update path when capacity changes. Because all of them contend on one row
per session, the capacity check cannot interleave (`BR-032`, `AC-022`), and
bookings for different sessions never block each other.

Order inside every booking function is fixed:

1. take the occupancy row lock;
2. re-read the session **after** the lock;
3. run all authorization, eligibility and capacity checks;
4. only then write.

No function validates before locking, and no function writes before all checks pass.

---

## Guardian operations

### `create_athlete_with_guardian(...) → jsonb`

Approved: athlete, guardian access, sport profile and workspace membership are one
transaction. Without it, a failure between statements strands an athlete row that
no RLS policy can ever select again (M-08) — invisible to its creator and
undeletable.

```
p_first_name         text
p_last_name          text
p_date_of_birth      date
p_sport_code         text     -- 'HOCKEY'
p_attributes         jsonb    -- {"position": "...", "stick_side": "..."}
p_club_name          text     null
p_team_or_category   text     null
p_jersey_number      text     null
p_workspace_id       uuid
```

Steps: insert `athletes` → insert `guardian_athlete_access` (caller, `MANAGE`,
`ACTIVE`) → insert `athlete_sport_profiles` (attributes validated by trigger) →
insert `workspace_athlete_memberships`.

D-10, resolved by this approval: the workspace membership is created here. The
privacy consequence is deliberate and should be stated in the UI — creating a
hockey profile makes the child visible to that workspace's coaches, which is what
makes booking possible. There is no separate join step in MVP.

Returns `{ athlete_id, athlete_sport_profile_id, workspace_athlete_membership_id }`.

### `book_athletes_as_guardian(p_training_session_id uuid, p_athlete_ids uuid[]) → jsonb`

**Atomic. All requested athletes are booked, or none are (D-05, changed).**

Partial success is explicitly rejected: one CTA must not split siblings into
booked and not-booked states.

```
1.  lock occupancy row
2.  reject empty selection                  -> EMPTY_SELECTION
3.  reject duplicate ids in the array       -> DUPLICATE_ATHLETE_IN_REQUEST
4.  re-read session
5.  status = 'OPEN'                         -> SESSION_NOT_OPEN
6.  now() < start_at                        -> SESSION_ALREADY_STARTED
7.  for each athlete:
      has_athlete_manage_access             -> NOT_AUTHORIZED_FOR_ATHLETE
      athlete_eligibility_for_session       -> NOT_ELIGIBLE
      no CONFIRMED booking                  -> ALREADY_BOOKED
      not guardian_rebooking_blocked        -> REMOVED_BY_COACH
8.  available := capacity - confirmed_count
    if array_length(p_athlete_ids) > available
                                            -> INSUFFICIENT_CAPACITY
9.  insert all bookings
      status = 'CONFIRMED'
      created_by = current_profile_id()
      created_by_role = 'USER'              -- D-14: fixed by the entry point,
      coach_capacity_override = false       --       never inferred from the caller
10. append audit BOOKING_CREATED_BY_GUARDIAN per booking
```

No row is written before step 9, so a failure at any step leaves nothing behind
without relying on rollback.

`INSUFFICIENT_CAPACITY` returns enough for the UI to recover:

```json
{ "ok": false, "code": "INSUFFICIENT_CAPACITY",
  "details": { "requested": 2, "available_places": 1, "capacity": 10, "confirmed_count": 9 } }
```

The picker then asks the guardian to reduce the selection and retry. It never
silently books a subset.

`NOT_ELIGIBLE` returns the per-athlete reason so the UI can explain which child
and why:

```json
{ "ok": false, "code": "NOT_ELIGIBLE",
  "details": { "athletes": [ { "athlete_id": "…", "reason": "BIRTH_YEAR_OUT_OF_RANGE" } ] } }
```

### `cancel_booking_as_guardian(p_booking_id uuid) → jsonb`

```
1. lock occupancy row for the booking's session
2. load booking + session + workspace
3. has_athlete_manage_access(booking.athlete_id)  -> NOT_AUTHORIZED_FOR_ATHLETE
4. booking.status = 'CONFIRMED'                   -> BOOKING_NOT_CONFIRMED
5. session.status <> 'CANCELLED'                  -> SESSION_CANCELLED
6. start_at - now() >= (workspaces.cancellation_deadline_hours || ' hours')::interval
                                                  -> CANCELLATION_DEADLINE_PASSED
7. update -> CANCELLED_BY_USER, cancelled_at = now(), cancelled_by = auth.uid()
8. append audit BOOKING_CANCELLED_BY_GUARDIAN
```

The deadline is computed from `start_at` on the server, from the workspace's own
configured value. A client-supplied `can_cancel` flag is never read (`PERMISSIONS`).

D-02, decided: step 6 is `now() <= start_at - deadline`, so cancellation is
permitted at exactly the deadline. 12:00:01 before start is allowed, 12:00:00 is
allowed, 11:59:59 is blocked. Evaluated on server time; a client-supplied
`can_cancel` is never read.

D-09: this path never consults `athletes.is_active`. A guardian can cancel the
booking of a deactivated athlete, which is what keeps deactivation from stranding
a family.

---

## Coach operations

### `book_athlete_as_coach(p_training_session_id uuid, p_athlete_id uuid, p_confirm_over_capacity boolean default false) → jsonb`

One athlete per call. Coach additions stay independent operations (approved under
D-05) because a coach adding three athletes to a full session is a deliberate,
per-athlete decision.

Differs from the guardian path in four ways:

- `is_workspace_coach(session.workspace_id)` replaces guardian access;
- capacity may be exceeded, but only when `p_confirm_over_capacity` is true —
  otherwise `CAPACITY_BELOW_OCCUPANCY` is returned so the UI can show the
  over-capacity warning (`AC-050`, `UI_SPEC`);
- `guardian_rebooking_blocked` does **not** apply: this is how a coach restores a
  previously removed athlete (D-06);
- allowed while the session is `DRAFT`, `OPEN`, `CLOSED` or `COMPLETED`; rejected
  when `CANCELLED`, which is terminal (D-07). The database enforces this too, so
  no code path can add a booking to a cancelled session.

Records `created_by_role = 'COACH'` and `coach_capacity_override = true` when the
booking took the count past capacity. Appends `BOOKING_CREATED_BY_COACH`, plus
`BOOKING_CAPACITY_OVERRIDDEN` when the override applied (`BR-034`).

### `cancel_booking_as_coach(p_booking_id uuid, p_reason text default null) → jsonb`

No deadline (`BR-042`, `AC-042`). Sets `CANCELLED_BY_COACH`, which is what makes
`guardian_rebooking_blocked` true for that athlete and session. Appends
`BOOKING_CANCELLED_BY_COACH`.

### `create_training_session(...) → jsonb`

Inserts the session and its `MAIN` coach row; the mirror column is maintained by
trigger. The occupancy row is created by trigger. Appends `SESSION_CREATED`.

### `update_training_session(...) → jsonb`

The only path that may change a published session. It computes the change set,
applies the change, sets the marker, queues notifications and writes audit in one
transaction — which is precisely why coaches have no `UPDATE` policy on the table.

```
1. lock occupancy row
2. is_workspace_coach                        -> NOT_AUTHORIZED
3. session.status <> 'CANCELLED'             -> SESSION_CANCELLED
4. diff requested fields against current
5. if new capacity < confirmed_count and not p_confirm_over_capacity
                                             -> CAPACITY_BELOW_OCCUPANCY
                                                { confirmed_count, requested_capacity }
6. if eligibility narrowed so existing confirmed bookings fall outside it
   and not p_confirm_ineligible_bookings     -> BOOKINGS_WOULD_BECOME_INELIGIBLE
7. apply update
8. classify the change set (see below)
9. queue notification_events for significant changes
10. append audit SESSION_UPDATED (+ SESSION_CAPACITY_CHANGED if capacity moved)
```

Change classification (D-11):

| Changed field | `significant_changed_at` | Notification event |
|---|---|---|
| `start_at`, `end_at` | set | `SESSION_SCHEDULE_CHANGED` |
| `location_id` | set | `SESSION_LOCATION_CHANGED` |
| `facility_id` | set | `SESSION_FACILITY_CHANGED` |
| main coach | set | `SESSION_MAIN_COACH_CHANGED` |
| `changing_room` | **not set** | none (D-12) |
| `public_notes`, internal notes | not set | none |
| `capacity` | not set | none (`BR-064`) |
| assistant coaches | not set | none |

A main-coach change is significant because Trainlio is a system for booking
training *with a coach*. Assistant coach changes are not.

The guardian badge is computed as `significant_changed_at > booking.created_at`,
so a guardian who booked after the change sees nothing. The audit log, not this
timestamp, records what actually changed.

Step 5 is the server-side form of the capacity warning. Existing bookings are
always preserved (`BR-052`, `AC-052`); the flag confirms intent, it does not
change the outcome for booked athletes.

Step 6 implements D-08. Narrowing the birth-year range never auto-cancels a
booking. The warning names how many confirmed bookings would fall outside the new
range, obtained from `bookings_outside_birth_year_range()`. On confirmation:

- existing bookings stand, still `CONFIRMED`;
- the affected bookings get `eligibility_narrowed_at`, so only they show
  `Změněno` — a session-level marker would flag every booked guardian;
- one `SESSION_ELIGIBILITY_NARROWED` event is queued whose payload carries
  `affected_athlete_ids`, which scopes expansion to those guardians only;
- a `SESSION_ELIGIBILITY_NARROWED` audit entry is appended;
- new booking attempts use the new rule.

Guardians of unaffected athletes are not emailed.

### `set_session_booking_state(p_training_session_id uuid, p_open boolean) → jsonb`

`OPEN` ⇄ `CLOSED` (`BR-024`). Appends `SESSION_BOOKING_CLOSED` /
`SESSION_BOOKING_REOPENED`.

### `cancel_training_session(p_training_session_id uuid) → jsonb`

Sets `status = 'CANCELLED'`, `cancelled_at`, `cancelled_by`.

D-07: this is terminal. The session can never be reopened, and no booking of any
kind can be added afterwards; both rules are enforced by database trigger as well
as here. A coach who cancelled by mistake uses `duplicate_training_session`. The
cancelled session is preserved as historical evidence, which is precisely why
reopening is refused: cancellation emails may already have gone out.

**Bookings are not modified.** They stay `CONFIRMED` so the roster of who was
booked at the moment of cancellation is preserved (`BR-071`), and the session's own
status carries the cancellation into My Bookings (`BR-070`, `AC-070`). Occupancy is
therefore unchanged, which is correct: it describes the session, not its validity.

Queues one `SESSION_CANCELLED` event. Appends `SESSION_CANCELLED`.

### `duplicate_training_session(p_training_session_id uuid, ...) → jsonb`

Copies configuration and the coach roster. Never copies bookings, `series_id`,
`significant_changed_at` or cancellation columns.

This is also the supported recovery from a mistaken cancellation (D-07). Appends `SESSION_DUPLICATED`
with the source id in `metadata`.

### `create_session_series(...) → jsonb`

Timezone-aware generation (approved finding 2). One transaction: a partially
generated series is worse than none, because the coach cannot tell what exists
(`S-C4`, `AC-080`).

```
1. is_workspace_coach                         -> NOT_AUTHORIZED
2. read workspaces.timezone
3. generate LOCAL DATES:
     d := first date >= local_date_from whose ISO weekday = by_weekday
     while d <= local_date_to:
         emit d
         d := d + 7          -- date arithmetic, no time component, DST-free
4. if no dates emitted                        -> SERIES_EMPTY
5. insert session_series
     generated_in_timezone = workspaces.timezone
     generated_count, generated_at
6. for each local date d, convert INDEPENDENTLY:
     start_at := (d + local_start_time) AT TIME ZONE ws.timezone
     end_at   := (d + local_end_time)   AT TIME ZONE ws.timezone
7. insert all training_sessions with series_id
8. append audit SESSION_SERIES_CREATED
```

Step 6 is the correctness point. Adding a fixed 7×24h interval to a `timestamptz`
is prohibited: for the PRD's own example series (Sundays 09:00, 4 Oct → 29 Nov
2026, Europe/Prague) it yields 09:00 for the first three occurrences and 08:00 for
the remaining six, because Czech DST ends on 25 October 2026 — itself an
occurrence date.

Generated sessions are fully independent from creation onward (`BR-081`,
`AC-081`, `AC-082`). There is no "this and all following" editing in MVP; the
series row is provenance, not a live template.

Local times that do not exist or are ambiguous on a DST transition day are
resolved by Postgres (forward for a gap, earlier offset for an overlap). Czech
transitions occur at 02:00/03:00, so no realistic training time is affected; the
behaviour is recorded here so it is a known outcome rather than a surprise.

---

## Service-role operations

Not callable by `authenticated`. Invoked by the notification drain job.

### `expand_notification_event(p_event_id uuid) → integer`

Turns one event into deduplicated per-guardian deliveries.

```
1. skip if dispatched_at is not null            -- idempotent re-run
2. collect athletes with CONFIRMED bookings on the event's session
3. collect ACTIVE guardians of those athletes
4. group by guardian  -> one row per profile (BR-073, AC-072)
     for SESSION_ELIGIBILITY_NARROWED, restrict step 2 to
     payload.affected_athlete_ids, so unaffected guardians are not emailed (D-08)
5. per row, payload = { athletes: [ { first_name, last_name } ], session: { … } }
6. read the email from auth.users via app_profiles.auth_user_id, server-side
     -- never from a domain table; null means the login was removed (D-18)
7. insert notification_deliveries (unique (event_id, recipient_profile_id))
8. set dispatched_at
```

Step 4 is where `AC-072` and `AC-073` are satisfied: a guardian with two booked
children gets one row whose payload names both.

### Drain job

A Vercel Cron route handler, authenticated by a shared secret, using the service
role. It claims `PENDING`/`FAILED` rows, sends through the email service
abstraction, and records `SENT`/`FAILED` with `attempt_count` and `last_error`.

The provider is Resend (D-15, decided). Nothing provider-specific reaches the
database: `notification_deliveries.provider_message_id` is a generic column, and
the drain job talks to an `EmailSender` interface with a single Resend
implementation. Supabase Auth OTP uses Resend as custom SMTP (D-16); Supabase's
default SMTP is not a production option.
