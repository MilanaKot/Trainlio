# Schema Validation

Trainlio — Sports Training Booking Platform

The proposed schema was applied to a clean PostgreSQL 16 instance and its
invariants exercised, so the claims below are observed behaviour rather than
intent. Supabase-provided objects (`auth.users`, `auth.uid()`, `storage.objects`,
`storage.foldername`, the `supabase_realtime` publication, and the `anon`,
`authenticated` and `service_role` roles) were stubbed locally.

All nine files applied in order with no errors.

**68 of 68 cases pass**: 40 in [`../tests/validation.sql`](../tests/validation.sql)
and 28 in [`../tests/validation_rls.sql`](../tests/validation_rls.sql), plus the
concurrency and daylight-saving cases below, which need parallel connections and
are run separately.

Three defects were found and fixed during this round. They are recorded at the
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

## Concurrency

Capacity 2, one place left, two transactions whose reads overlap.

| Design | A | B | Bookings | Projection |
|---|---|---|---|---|
| Count-then-insert, no lock | read 1/2 → booked | read 1/2 → booked | **3 — capacity exceeded** | 3 (accurate) |
| `SELECT … FOR UPDATE` on the occupancy row | read 1/2 → booked | read 2/2 → refused | 2 | 2 |

This is `BR-032` and `AC-022`. The unlocked variant is what a straightforward
implementation produces, and it overbooks.

The two mechanisms are separate and both are needed: the trigger's own lock
guarantees the projection never lies about what exists, and the RPC's lock
guarantees capacity is never exceeded in the first place.

## Daylight saving (approved finding 2)

The PRD's own example series — Sundays 09:00–10:00, 4 October to 29 November
2026, `Europe/Prague` — generates nine occurrences. Czech DST ends on
25 October 2026, which is itself an occurrence date.

| Occurrence | Per-occurrence local conversion | Fixed 7×24h stepping |
|---|---|---|
| 4, 11, 18 Oct | 09:00 | 09:00 |
| 25 Oct, and 1, 8, 15, 22, 29 Nov | 09:00 | **08:00** |

Six of nine occurrences land an hour early under the naive approach.

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
`07_rls_policies.sql` now states when an inline subquery is safe and when it
needs a `SECURITY DEFINER` predicate.

## Reproducing

See [`../tests/README.md`](../tests/README.md). Phase 8 replaces this with the
Supabase CLI local stack and a committed Vitest suite; these cases become its
seed.
