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
| `CAPACITY_BELOW_OCCUPANCY` | Session edit: the requested capacity is below the confirmed count. Coach must resend with the confirmation flag (`BR-051`) |
| `WOULD_EXCEED_CAPACITY` | Coach manual booking: the addition would take the count past capacity. Coach must resend with the confirmation flag (`BR-033`) |
| `BOOKINGS_WOULD_BECOME_INELIGIBLE` | D-08: narrowing the birth-year range past existing bookings |
| `SERIES_EMPTY` | The recurrence pattern generates no occurrence |
| `INVALID_NAME` | Athlete first or last name is blank |
| `INVALID_DATE_OF_BIRTH` | Missing, before 1900, or in the future |
| `INVALID_ATHLETE_DATA` | A core athlete constraint was violated |
| `INVALID_SPORT_ATTRIBUTES` | Position, stick side, or an attribute key the sport does not define |
| `SPORT_NOT_FOUND` | No sport with that code |
| `SPORT_NOT_IN_WORKSPACE` | The workspace does not run that sport |
| `SPORT_PROFILE_EXISTS` | The athlete already holds a profile for that sport |
| `WORKSPACE_NOT_FOUND` | No such workspace, or it is inactive |

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

The four inserts share the function's inner block, so a failure in any of them
rolls back all four and the function still returns a structured error rather
than raising. "All or nothing" therefore holds without the caller managing a
transaction.

### `joinable_workspaces() → setof (id, name, primary_sport_id, sport_code, timezone)`

Workspaces the caller may register an athlete into.

Exists because of a chicken-and-egg problem in the very first thing a parent
does: `create_athlete_with_guardian` takes a workspace id, but
`workspaces_select_related` only shows a workspace to someone who already has an
athlete there (D-01). A parent with no athlete can read no workspace, so the
registration form has nothing to submit.

Widening the row policy would make every workspace readable to every
authenticated user for all purposes. This exposes one fact — which workspaces
accept a registration — and returns no member counts, coach identities or
session counts. When invitation-based joining arrives (PRD §6, post-MVP), this
function is the only thing that changes.

### `upsert_athlete_sport_profile(...) → jsonb`

Adds or updates one sport profile, and ensures the workspace membership when a
workspace is given.

This exists rather than letting the client insert through the row policy because
an `athlete_sport_profiles` row without a matching membership is a profile the
coach cannot see and the athlete cannot be booked with — broken in a way nothing
reports. AC-101 follows from writing exactly one `(athlete, sport)` row: editing
a hockey profile cannot touch a swimming one.

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
  otherwise `WOULD_EXCEED_CAPACITY` is returned, with
  `{ capacity, confirmed_count }` in `details`, so the UI can show the
  over-capacity warning (`AC-050`, `UI_SPEC`).

  A distinct code from the session-edit case, deliberately. Both are "the coach
  must confirm exceeding capacity", but they are opposite movements:
  `CAPACITY_BELOW_OCCUPANCY` is the capacity being lowered under a fixed
  roster, `WOULD_EXCEED_CAPACITY` is the roster being raised past a fixed
  capacity. They carry different `details`, produce different warning text and
  are recovered from by different actions. Sharing one code would force the UI
  to branch on which call it had just made rather than on what the server
  said;
- `guardian_rebooking_blocked` does **not** apply: this is how a coach restores a
  previously removed athlete (D-06);
- allowed while the session is `DRAFT`, `OPEN`, `CLOSED` or `COMPLETED`; rejected
  when `CANCELLED`, which is terminal (D-07). The database enforces this too, so
  no code path can add a booking to a cancelled session.

```
1. lock occupancy row
2. current_profile_id()                      -> NOT_AUTHENTICATED
3. session exists                            -> SESSION_NOT_FOUND
4. is_workspace_coach                        -> NOT_AUTHORIZED
5. session.status <> 'CANCELLED'             -> SESSION_CANCELLED
6. athlete_eligibility_for_session           -> NOT_ELIGIBLE { athlete_id, reason }
7. no CONFIRMED booking for this athlete     -> ALREADY_BOOKED
8. if confirmed_count >= capacity and not p_confirm_over_capacity
                                             -> WOULD_EXCEED_CAPACITY
                                                { capacity, confirmed_count }
9. insert booking, append audit
```

Records `created_by_role = 'COACH'` and `coach_capacity_override = true` when the
booking took the count past capacity. Appends `BOOKING_CREATED_BY_COACH`, plus
`BOOKING_CAPACITY_OVERRIDDEN` when the override applied (`BR-034`).

Eligibility is checked before capacity and is **not** overridable: PRD §10 gives
the coach "eligible managed athletes", and capacity is the only rule the override
flag reaches. A coach who needs an out-of-range athlete widens the session's
birth-year range, which is a visible, audited change to the session.

### `session_roster(p_training_session_id uuid) → setof`

The roster a coach reads (`BR-092`, `AC-090`): every booking for the session,
confirmed and cancelled, with the athlete's sport profile for the session's
sport, `booked_by_name`, `booked_at`, `capacity_override` and the cancellation
reason. Authorized by `is_workspace_coach(session.workspace_id)`; returns no rows
to anyone else, including the guardian who made the booking.

A `SECURITY DEFINER` function rather than a widened policy. `app_profiles` is
readable only for your own profile or for visible workspace staff, so a
guardian's profile is not coach-readable — deliberately. Widening that policy so
the roster could join to it would make every guardian profile in the workspace
readable by a coach for any purpose. This returns the one name, in the one place
the specification asks for it.

### `coach_session_candidates(p_training_session_id uuid) → setof`

Who the coach may add: every athlete with an active membership of the session's
workspace, each with `athlete_eligibility_for_session`'s verdict, their latest
booking status, and `can_add`.

Unlike `guardian_session_athletes` this keeps the ineligible athletes, with their
reason. A coach adding a child by hand needs to know why a name is unavailable,
because "wrong birth year" and "already booked" call for different actions; a
guardian only needs to know who they may pick. `can_add` deliberately does not
consider capacity: a full session is a warning the coach may override, not a bar.

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

---

## Notification outbox operations

Every function in this section is **service_role only**. The drain job is the
one caller and it runs outside any user's request. Expansion reads `auth.users`
for the recipient's address; granting EXECUTE to `authenticated` would hand a
guardian every booked family's email address through a function call, which is
exactly the leak the grant and policy layers both exist to prevent.

### `notification_event_recipients(p_event_id uuid) → setof`

The guardians with ACTIVE access to an athlete holding a CONFIRMED booking on
the event's session (`BR-072`), one row each, carrying `athlete_ids` and
`athlete_names` for that guardian's own children. This is what makes `AC-072`
and `AC-073` a property of the data rather than of the email template.

D-08 narrows it: `SESSION_ELIGIBILITY_NARROWED` goes only to the guardians of
the athletes in `payload.affected_athlete_ids`. The other booked families are
unaffected and telling them would be noise.

### `expand_notification_event(p_event_id uuid) → jsonb`

Creates one `notification_deliveries` row per recipient and sets
`dispatched_at`. Returns `{ created, already_dispatched }`.

Idempotent (`AC-151`), and by two mechanisms that are both needed:

- the row lock on the event, so two drains running at once do not both pass the
  `dispatched_at` check and race into the same insert;
- the `unique (event_id, recipient_profile_id)` constraint, which is also the
  deduplication for `BR-073` — a guardian with two booked children cannot
  produce two rows, so they cannot receive two emails. This holds even if
  `dispatched_at` were cleared by hand.

The recipient's address is snapshotted here rather than joined at send time.
`auth_user_id` is severable (D-18): a profile whose login was removed keeps its
delivery history, and a delivery already made keeps the address it was made to.

| Code | Meaning |
|---|---|
| `EVENT_NOT_FOUND` | |

### `pending_notification_events(p_limit integer default 50) → setof uuid`

Undispatched events, oldest first.

### `claim_notification_deliveries(p_limit, p_max_attempts, p_stale_after) → setof`

Claims a batch to send: `FOR UPDATE SKIP LOCKED`, marking each row `SENDING`
and stamping `claimed_at` inside the claiming transaction. Two overlapping drain
runs — which a cron schedule plus a slow provider makes ordinary — must not both
pick up the same delivery, because the second send is a duplicate email to a
parent and cannot be recalled.

Returns the recipient address, the attempt count, the workspace name and
timezone, this guardian's athlete names, and a `session_payload` composed from
the **event's** snapshot with the facility and location names resolved live. The
snapshot matters: if a coach moves a session twice before the drain runs, the
first email must describe the first move.

Not claimed:

- `attempt_count >= p_max_attempts`. The budget stops a permanently broken
  address from being retried for the life of the workspace.
- `recipient_email is null`. Left `PENDING` rather than failed — a future
  anonymisation clears the address deliberately (D-18), and the record of the
  intent is preserved either way.
- a `SENDING` row claimed less than `p_stale_after` ago. Past that it **is**
  reclaimed: that state means the process died between claiming and recording,
  the one case where Trainlio cannot know whether the message went out.
  Retrying is the right choice, because a parent who receives the cancellation
  twice is inconvenienced while a parent who never receives it takes their child
  to a training that is off.

`claimed_at` is a column of its own rather than a reading of `updated_at`.
`updated_at` is maintained by the `set_updated_at` trigger, so it answers "when
was this row last touched at all" — any unrelated write resets it, and nothing
outside the trigger can set it.

### `record_notification_delivery(p_delivery_id, p_ok, p_provider_message_id, p_error) → jsonb`

`SENT` with `sent_at`, or `FAILED` with `last_error`. The provider id is plain
text in a column that names no vendor (`AC-152`).

| Code | Meaning |
|---|---|
| `DELIVERY_NOT_FOUND` | |

### `notification_queue_depth() → jsonb`

Counts only, no addresses: `undispatched_events`, `pending`, `sending`,
`failed`, `sent`. The drain returns it so an operator can see a backlog without
reading the outbox.

## The drain

`src/server/notifications/drain.ts`, on a Vercel Cron schedule
(`vercel.json`, every five minutes) behind `/api/notifications/drain`.

Two phases, deliberately separate. Expansion is idempotent and cheap, so
re-running it costs nothing; sending is neither, which is why a claim marks the
row inside the claiming transaction. Each outcome is recorded one delivery at a
time rather than batched at the end: a batch write means a crash halfway through
loses the record of everything already sent, and the next run sends those emails
again.

The route is authenticated by a shared secret compared in constant time, not by
being obscure — the approved review is explicit that possession of a URL is not
authorization, and this route reads guardian email addresses with the service
role.

The provider lives behind `EmailProvider` with one implementation (Resend). A
4xx from the provider is not retried, because the request is wrong in a way
retrying cannot fix and the attempt budget is small enough that spending it
there means a deliverable message never gets another attempt; 429 and 5xx are.
