# Schema Validation

Trainlio — Sports Training Booking Platform

The proposed schema was applied to a clean PostgreSQL 16 instance and its
invariants exercised, so the claims below are observed behaviour rather than
intent. Supabase-provided objects (`auth.users`, `auth.uid()`, `storage.objects`,
`storage.foldername`, the `supabase_realtime` publication, and the `anon`,
`authenticated` and `service_role` roles) were stubbed locally.

All eighteen files applied in order with no errors.

**428 of 428 cases pass**, and the database lint reports no error-level finding:

| Suite | Cases |
|---|---|
| [`tests/lint.sql`](tests/lint.sql) | 0 errors, 33 informational |
| [`tests/validation.sql`](tests/validation.sql) | 40 |
| [`tests/validation_rls.sql`](tests/validation_rls.sql) | 28 |
| [`tests/validation_auth.sql`](tests/validation_auth.sql) | 17 |
| [`tests/validation_athletes.sql`](tests/validation_athletes.sql) | 35 |
| [`tests/validation_sessions.sql`](tests/validation_sessions.sql) | 51 |
| [`tests/validation_series.sql`](tests/validation_series.sql) | 34 |
| [`tests/validation_bookings.sql`](tests/validation_bookings.sql) | 42 |
| [`tests/validation_roster.sql`](tests/validation_roster.sql) | 73 |
| [`tests/validation_notifications.sql`](tests/validation_notifications.sql) | 67 |
| [`tests/validation_qa.sql`](tests/validation_qa.sql) | 41 |

Plus the concurrency and daylight-saving cases below, which need parallel
connections and are run separately.

Run everything with `pnpm db:validate`.

Four defects were found and fixed across these rounds. They are recorded at the
end, because each is a mistake worth not repeating.

## Database invariants

| Attempted | Result |
|---|---|
| Session referencing a facility from another location | rejected — `training_sessions_facility_at_location` |
| Session referencing a location from another workspace | rejected — `training_sessions_location_in_workspace` |
| Membership referencing another athlete's sport profile | rejected — `wam_profile_belongs_to_athlete` |
| Membership whose sport differs from the workspace sport | rejected — `wam_profile_sport_matches` |
| Session coach who is not staff of that workspace | rejected — `assert_profile_is_workspace_staff` |
| Hockey profile with `position: "STRIKER"` | rejected — invalid position |
| Hockey profile with an extra `salary` key | rejected — unknown attribute key |
| Workspace timezone `Europe/Praha` | rejected — unknown IANA timezone |
| Second CONFIRMED booking for the same athlete and session | rejected — partial unique index |
| CONFIRMED booking carrying a cancellation timestamp | rejected — `bookings_cancellation_consistent` |
| Capacity override flag on a guardian-created booking | rejected — `bookings_override_requires_privileged_creator` |
| Deleting an athlete that has history | rejected — restrict |
| Deleting a session that has bookings | rejected — restrict |
| `UPDATE` / `DELETE` on `audit_log` | rejected — append-only trigger |

## D-02 — cancellation boundary

Computed from `start_at` and the workspace's own deadline, on server time.

| Distance from start | Result |
|---|---|
| 12:00:01 | allowed |
| 12:00:00 | **allowed** |
| 11:59:59 | blocked |

## D-07 — a cancelled session is terminal

| Attempted on a CANCELLED session | Result |
|---|---|
| Reopen to `OPEN` | rejected — `enforce_cancelled_session_is_terminal` |
| Guardian booking | rejected — `enforce_booking_insert_rules` |
| Coach booking | rejected — same |
| Eligibility check | returns `SESSION_CANCELLED` |
| Existing bookings | preserved unchanged, as historical evidence |

## D-08 — narrowing eligibility with existing bookings

Session 2016–2018 narrowed to 2017–2018, with Tomáš (2016) already confirmed.

| Check | Result |
|---|---|
| Affected bookings counted before saving | 1 (Tomáš) — drives the coach warning |
| Existing bookings after the change | both still `CONFIRMED`, nothing auto-cancelled |
| Bookings marked as affected | 1 — Tomáš only, not the whole session |
| A *new* booking attempt for Tomáš | `BIRTH_YEAR_OUT_OF_RANGE` |

The per-booking `eligibility_narrowed_at` stamp is what keeps this precise. A
session-level marker would show `Změněno` to every booked guardian, when only the
affected families are notified.

## D-09 — athlete deactivation

| Check | Result |
|---|---|
| Existing confirmed booking | preserved |
| Sport profile | preserved |
| Workspace membership | preserved |
| New booking attempt | `ATHLETE_INACTIVE` |
| Guardian cancelling the existing booking | still works |
| After reactivation | `ELIGIBLE` |

## D-11 — significant main-coach change

The mirror column follows the canonical `MAIN` row, and both the notification
event type and the audit action exist. A guardian can read the main coach's
display name; guardian email addresses remain unreadable.

## D-12 / D-13 — what a guardian may read on a session

| Field | Guardian | Coach |
|---|---|---|
| `changing_room` — `Příbram · MH · Šatna 4` | visible | visible |
| `public_notes` | visible | visible |
| internal notes | **no rows returned** | readable |

Internal notes live in their own table precisely so this holds. As a column on
`training_sessions` no policy could hide them, because row level security is
row-level and guardians must be able to read the session row.

## D-17 — workspace admin versus platform admin

| | WORKSPACE_ADMIN | PLATFORM_ADMIN | Guardian |
|---|---|---|---|
| `is_workspace_admin` | true | false | false |
| may run coach operations | true | **false** | false |
| `is_platform_admin` | **false** | true | false |
| can read `platform_admins` | denied | — | denied |
| reads athlete data through RLS | via workspace | **none** | own only |
| `is_workspace_member` | true | false | **false** |

Platform administration is explicit membership of `platform_admins` and is never
inferred from a workspace role. A platform admin gains no athlete access through
RLS; platform support runs through server-side tooling under the service role,
which keeps family data out of reach of a role that exists for operational
troubleshooting.

Guardians are never workspace staff. `guardian_can_see_workspace` is true for
them while `is_workspace_member` is false — authorization runs through athlete
access and workspace athlete membership, exactly as D-17 requires.

## Privacy model

Exercised as the `authenticated` role with a JWT subject claim.

| Actor | Observed |
|---|---|
| Family B | sees their own athlete only; 0 of family A's bookings; cannot read family A's profile |
| Family B | **does** see the occupancy count, which includes family A's booking |
| Guardian | sees occupancy only for sessions they can see; DRAFT excluded |
| Stranger with no athlete | 0 sessions, 0 athletes |
| Coach | sees the DRAFT session and the full roster |

The second row is the point of the whole design: a guardian reads the aggregate
without reading any row behind it.

Direct writes are refused at the grant layer, before RLS is consulted: guardian
`INSERT` into `bookings`, coach `UPDATE` of `training_sessions`, `DELETE` from
`bookings`, and any read of `audit_log` or `notification_deliveries` by either a
guardian or a coach.

## D-18 — history survives account deletion

Deleting the `auth.users` row for a guardian who had bookings:

| Check | Result |
|---|---|
| Login link (`auth_user_id`) | severed to null |
| Their bookings | still present, still attributed to their profile |
| Their guardian links | intact |

No domain history depends on an `auth.users` row physically existing, which is
the architectural property D-18 asked to preserve. The deletion and anonymisation
*workflow* remains deferred.

## Concurrency (AC-022, BR-032)

Run by [`tests/concurrency.sh`](tests/concurrency.sh) against the real
`book_athletes_as_guardian`, with six guardians reaching for one place on
genuinely parallel connections, five rounds.

| | Result |
|---|---|
| **Control** — count-then-insert, no lock | overbooks to **6/1** |
| **Real** — the occupancy row lock | exactly 1 booking, 1/1, every round |

The control is not decoration. The first version of this script wrapped each
attempt in an advisory lock so the two transactions would "overlap", which
serialised them so completely that the occupancy lock was never contended: it
passed while testing nothing. A concurrency test that cannot fail is worthless,
so the suite now proves the harness observes overbooking before claiming the
lock prevents it.

Two mechanisms, both needed: the trigger's own lock guarantees the projection
never lies about what exists, and the RPC's lock guarantees capacity is never
exceeded in the first place.

## Recurring series

The PRD's own example — Sundays 09:00–10:00, 4 October to 29 November 2026,
`Europe/Prague`. Czech DST ends on 25 October 2026, which is itself an
occurrence date.

| Occurrence | Per-occurrence local conversion | Fixed 7×24h stepping |
|---|---|---|
| 4, 11, 18 Oct | 09:00 | 09:00 |
| 25 Oct, and 1, 8, 15, 22, 29 Nov | 09:00 | **08:00** |

Six of nine occurrences land an hour early under the naive approach.

Generation is now exercised end to end rather than demonstrated:

| Check | Result |
|---|---|
| Occurrences generated | 9, every one on the requested weekday |
| Distinct local start times | **1** — `09:00` (AC-080a) |
| Distinct absolute gaps between them | **2** — which is the corollary, and the reason a fixed interval is wrong |
| First and last occurrence | on the start date and on or before the end date |
| Timezone and pattern recorded on the series | `Europe/Prague`, weekday and local times (AC-080c) |
| Each occurrence's MAIN coach row, internal note, occupancy row | created |
| Cancelling one occurrence | only that one; the other eight untouched (AC-081) |
| Editing one occurrence | only that one; the series row does not follow (AC-082) |
| A pattern matching no date, an inverted range, a bad weekday | refused |
| A creation that fails partway | leaves no series row and no occurrence (AC-080b) |
| A guardian reading `session_series` | no rows |

The preview a coach approves and the rows the server creates run the same rule,
but only the server's is authoritative: the dates are never submitted, so a
stale preview cannot decide what exists.

---

## Defects found and fixed in this round

**1. The occupancy projection could drift under concurrent inserts.**
Two concurrent bookings produced three `CONFIRMED` rows but a `confirmed_count`
of 2. At `READ COMMITTED`, an `UPDATE` that blocks on a row lock re-reads its
target row but does not re-evaluate its subqueries, so each trigger recounted
from a snapshot that excluded the other's committed row. Fixed by having the
trigger acquire the occupancy row lock itself before recounting, which makes the
projection correct regardless of caller discipline — a later migration or admin
script that writes a booking outside an RPC can no longer desynchronise it.

**2. A session's coach was not required to be staff of that session's workspace.**
Found while validating D-11. A session could name a coach from another
workspace: a cross-tenant leak of the same family as the composite foreign keys,
but not expressible as one, because `workspace_members` is unique on
`(workspace_id, profile_id, role)` and a user may hold two roles. Fixed with
`assert_profile_is_workspace_staff`, enforced on both the session and the
session-coach tables.

**3. An RLS policy queried an RLS-protected table inline.**
The policy exposing coach display names to guardians used an inline `EXISTS`
against `workspace_members`. That subquery runs as the calling role, guardians
cannot select from `workspace_members`, so it silently evaluated to false and the
coach's name disappeared from the guardian view. Fixed by moving it into
`is_visible_staff_profile()`. This is the same trap as S-R1, and a note in
migration 07 now states when an inline subquery is safe and when it needs a
`SECURITY DEFINER` predicate.

**4. Nothing created the actor record on signup.**
Found while wiring authentication. Every policy resolves the caller through
`current_profile_id()`, which reads `app_profiles` by `auth_user_id`; Supabase
Auth creates a row in `auth.users` and nothing else. A real user would have
signed in successfully and then found an empty application, with no error
anywhere to explain it. Fixed by migration 10, which adds the trigger, a
backfill for identities that predate it, and `ensure_current_profile()` for
identities the trigger never saw.

**5. Appending to a `text[]` treated the element as an array literal.**
`v_events := v_events || 'SESSION_SCHEDULE_CHANGED'` raises *malformed array
literal*: with no cast, Postgres parses the untyped literal on the right of `||`
as an array rather than as one element. Every significant change therefore
failed while every insignificant one succeeded — so a coach could rename a
changing room but not move a session, and the failure surfaced only as a
rejected call. Found by the session suite; fixed with an explicit `::text` on
each append.

**6. `Number('')` is `0`, not `NaN`.**
An empty birth-year field passed the integer check and was reported as an
out-of-range year instead of a missing one, sending a coach to look for a
problem with the value they had not entered. Found by a unit test; both the
birth-year and capacity fields now check for an empty string before converting.

## Database lint

The Supabase database linter's rules, written out in
[`tests/lint.sql`](tests/lint.sql) so they run against any PostgreSQL instance
and in CI. Split by severity, because blanket-indexing every foreign key would
slow every insert to speed up deletions that `ON DELETE RESTRICT` exists to
refuse.

**Error-level: zero findings.** RLS is enabled on every table in `public`; no
table has a policy without RLS or RLS without a policy; every function pins its
`search_path`; no `SECURITY DEFINER` function is executable by `PUBLIC` or
`anon`; no policy reads `auth.uid()` directly or `user_metadata`; no `DELETE`
policy or grant exists anywhere; no write grant on `bookings`,
`training_sessions` or the occupancy projection; no client grant on the outbox,
the audit log or `platform_admins`; nothing is granted to `anon`; `bookings` is
absent from the Realtime publication; no extension is installed in `public`.

**Informational: 33 unindexed foreign keys.** Each was weighed rather than
fixed in bulk. Most are supported by a partial index that serves the query but
not the referential check — correct, because the query is the hot path and the
parent is never deleted. Two were genuinely missing an index that serves a real
coach-facing query ("my sessions", on the association table and the mirror
column) and were added.

## Auth integration

| Check | Result |
|---|---|
| A new authentication identity gets a profile | yes, by trigger |
| `display_name` on signup | null — no personal data written |
| The email in a domain table | never |
| `current_profile_id()` resolves | yes, so every policy can authorize |
| Backfill re-run | idempotent |
| `ensure_current_profile()` on an existing profile | returns it, creates nothing |
| Guardian sets own `display_name` | allowed |
| Guardian sets own `auth_user_id` | denied |
| Guardian sets own `anonymized_at` | denied |
| Guardian creates a profile | denied |
| Guardian edits another profile | matches no row; the other profile is untouched |
| Guardian reads `auth.users` | denied |

The three denials are column-level grants, not a trigger. A trigger would have
had to ask which role was acting, so that the service role could still sever a
link or stamp `anonymized_at` when the deferred D-18 workflow is built; a column
grant simply does not extend to those columns for `authenticated`.

Without this migration the authorization model is inert: signing in creates an
`auth.users` row and nothing else, so every predicate returns null and the
application reads as empty for everyone.

## Athlete management

| Check | Result |
|---|---|
| A guardian with no athlete sees no workspace row | 0 |
| …but `joinable_workspaces()` offers one to register into | 1 |
| Creating an athlete writes all four rows in one call | athlete, access, sport profile, membership |
| The creator can then see their own athlete | yes |
| A second family can see neither | 0 |
| An invalid position, stick side, blank name or future birth date | rejected, and **no athlete row stranded** |
| HOCKEY and SWIMMING profiles on one athlete | coexist |
| Editing the hockey profile | leaves the swimming profile untouched |
| A sport the workspace does not run | `SPORT_NOT_IN_WORKSPACE` |
| Another family editing a sport profile | `NOT_AUTHORIZED_FOR_ATHLETE` |
| A coach updating an athlete's core profile | matches no row; the profile is unchanged |
| …though the coach can still read it | yes |
| Deactivating an athlete | sport profiles and memberships survive; the athlete stays visible |

The stranding cases are the point of the transactional function. Row level
security grants no INSERT on `athletes` precisely because an athlete row without
its `guardian_athlete_access` row is invisible to every policy, including its
creator's, and cannot be deleted.

## Coach session management

| Check | Result |
|---|---|
| A coach creates a session from local wall clock | stored as the right instant in the workspace zone |
| A guardian creating a session | `NOT_AUTHORIZED` |
| A workspace admin creating one | allowed (D-17) |
| Changing room or notes changed | **not** significant; no marker, no email |
| Capacity changed | **not** significant; audited, no email (BR-064) |
| Date, time, facility or main coach changed | significant; marker set, event queued |
| Capacity below occupancy without confirmation | `CAPACITY_BELOW_OCCUPANCY`, reporting how many are booked |
| …with confirmation | applied, every booking preserved (AC-052) |
| Narrowing past a booked athlete without confirmation | `BOOKINGS_WOULD_BECOME_INELIGIBLE`, naming the count |
| …with confirmation | applied; nothing auto-cancelled; only the affected booking marked |
| The eligibility event's payload | carries only the affected athletes (AC-174) |
| A cancelled session: reopen, edit, cancel again | all refused (AC-160) |
| A cancelled session: its bookings | untouched, preserving the roster (AC-070a) |
| A cancelled session: duplicate | allowed — the recovery path (AC-164) |
| A duplicate | copies the coach roster, never bookings or the change marker |
| A duplicate onto a date past a DST change | keeps the same local time |

The two warnings are server-side gates, not dialogs. Without the flag the
change is refused and the count comes back with it, so the interface cannot
grant either one by failing to render it.

## Booking engine

| Check | Result |
|---|---|
| Two siblings booked in one action | both, occupancy 2/2 (AC-024) |
| Two siblings into one free place | **neither** booked; the parent is told 1 place remains (AC-024a) |
| Reducing the selection to one and retrying | succeeds (AC-024b) |
| One ineligible child in the selection | the whole action refused, naming the child and reason (AC-024c) |
| Booking into a full session | `INSUFFICIENT_CAPACITY`, 0 places reported (AC-021) |
| The same athlete twice | `ALREADY_BOOKED` (AC-023); the same id twice in one call is refused outright |
| A closed session with places free | `SESSION_NOT_OPEN` (BR-024) |
| A started session | refuses everyone, for the one reason that applies |
| A cancelled session | `SESSION_CANCELLED`; existing bookings preserved (AC-070a) |
| An athlete a coach removed | `REMOVED_BY_COACH`, and the picker stops offering them (D-06) |
| 2017 athlete into a 2017–2018 session | eligible (AC-030); a 2016 sibling is not |
| Cancelling well before the session | allowed; occupancy drops (AC-040, AC-043) |
| …inside the deadline | `CANCELLATION_DEADLINE_PASSED` (AC-041), and the booking stands |
| Booking inside the deadline window | still allowed — the deadline governs cancelling, not booking (PRD §10) |
| Another family cancelling your booking | `NOT_AUTHORIZED_FOR_ATHLETE` |
| A cancelled booking | preserved as `CANCELLED_BY_USER`, never deleted (BR-044) |

Every booking and cancellation writes its own audit entry.

## Realtime occupancy

Verified on the running stack, not asserted from the schema:

| Check | Result |
|---|---|
| A guardian subscribes to `training_session_occupancy` | SUBSCRIBED |
| A booking elsewhere | the count change arrives over the socket |
| Another family reads the count | yes |
| …and the bookings behind it | none (BR-090) |
| A family with **no** athlete in the workspace | reads no occupancy at all (D-01) |

That last row is the one worth keeping. Three probes failed before this was
understood: Realtime applies row level security per subscriber, so a guardian
with no athlete receives nothing — which is D-01 working, not a fault. The same
property is why `bookings` is absent from the publication: a guardian would only
ever receive their own rows, and the number would appear frozen.

## Reproducing

See [`tests/README.md`](tests/README.md). Phase 8 replaces this with the
Supabase CLI local stack and a committed Vitest suite; these cases become its
seed.
