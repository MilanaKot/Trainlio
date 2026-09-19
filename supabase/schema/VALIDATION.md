# Schema Validation

Trainlio — Sports Training Booking Platform

The proposed schema was applied to a real PostgreSQL 16 instance and its
invariants exercised, so the claims below are observed behaviour rather than
intent. Supabase-provided objects (`auth.users`, `auth.uid()`, `storage.objects`,
`storage.foldername`, the `supabase_realtime` publication, and the `anon`,
`authenticated` and `service_role` roles) were stubbed locally.

All nine files applied in order with no errors.

## Database invariants

| Attempted | Result |
|---|---|
| Session referencing a facility from another location | rejected — `training_sessions_facility_at_location` |
| Session referencing a location from another workspace | rejected — `training_sessions_location_in_workspace` |
| Membership referencing another athlete's sport profile | rejected — `wam_profile_belongs_to_athlete` |
| Membership whose sport differs from the workspace sport | rejected — `wam_profile_sport_matches` |
| Hockey profile with `position: "STRIKER"` | rejected — invalid position |
| Hockey profile with an extra `salary` key | rejected — unknown attribute key |
| Workspace timezone `Europe/Praha` | rejected — unknown IANA timezone |
| Second CONFIRMED booking for the same athlete and session | rejected — partial unique index |
| CONFIRMED booking carrying a cancellation timestamp | rejected — `bookings_cancellation_consistent` |
| Capacity override flag on a guardian-created booking | rejected — `bookings_override_requires_privileged_creator` |
| Deleting an athlete that has a sport profile | rejected — restrict |
| Deleting a session that has bookings | rejected — restrict |
| `UPDATE` / `DELETE` on `audit_log` | rejected — append-only trigger |

## Occupancy projection

Created automatically at 0 when the session was inserted, moved to 1 on booking,
back to 0 when the coach removed the athlete, and matched a recount of booking
rows at every point. Never written by anything but the trigger.

## Coach-removal re-booking block (D-06)

The full cycle behaves as specified:

| State | `guardian_rebooking_blocked` | Guardian insert |
|---|---|---|
| Coach removed the athlete | true | rejected |
| Coach added the athlete back | false | — |
| Guardian then cancelled their own booking | false | accepted |

## Privacy model

Exercised as the `authenticated` role with a JWT subject claim.

| Actor | Observed |
|---|---|
| Family B | sees their own athlete only; sees 0 of family A's bookings |
| Family B | **does** see the occupancy count, which includes family A's booking |
| Stranger with no athlete | sees 0 sessions, 0 occupancy rows, 0 athletes |
| Guardian, DRAFT session | sees 0 sessions |
| Coach | sees the full roster and both families' athletes |

The second row is the point of the whole design: a guardian reads the aggregate
without reading any row behind it.

Direct writes were refused at the grant layer before RLS was even consulted:
guardian `INSERT` into `bookings`, guardian `UPDATE` of `training_sessions`,
`DELETE` from `bookings`, and any read of `audit_log` or
`notification_deliveries`.

## Concurrency

Capacity 2, one place left, two transactions whose reads overlap:

| Design | Transaction A | Transaction B | Final |
|---|---|---|---|
| Count-then-insert, no lock | read 1/2 → booked | read 1/2 → booked | **3/2 — capacity exceeded** |
| `SELECT … FOR UPDATE` on the occupancy row | read 2/2 → refused | read 1/2 → booked | 2/2 |

This is `BR-032` and `AC-022`. The unlocked variant is what a straightforward
implementation produces, and it overbooks.

## Daylight saving (approved finding 2)

The PRD's own example series — Sundays 09:00–10:00, 4 October to 29 November
2026, `Europe/Prague` — generates nine occurrences. Czech DST ends on
25 October 2026, which is itself an occurrence date.

| Occurrence | Per-occurrence local conversion | Fixed 7×24h stepping |
|---|---|---|
| 4, 11, 18 Oct | 09:00 | 09:00 |
| 25 Oct, and 1, 8, 15, 22, 29 Nov | 09:00 | **08:00** |

Six of nine occurrences land an hour early under the naive approach.

## Reproducing

Phase 1 replaces this with the Supabase CLI local stack and a committed test
suite. The local run used a plain PostgreSQL 16 cluster with the stubs listed
above.
