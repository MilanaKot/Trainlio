# Architecture Review — Pre-Implementation

Trainlio — Sports Training Booking Platform

Status: **reviewed and decided.** Retained as the record of how the current
architecture was arrived at.

The five must-fix findings and the S-items were approved. D-05 was decided
against this document's recommendation: multi-athlete guardian booking is
atomic, not partial-success. Decisions still outstanding are tracked in
`OPEN_DECISIONS.md`; the resulting design is in `ARCHITECTURE.md`,
`DATA_MODEL.md`, `DOMAIN_OPERATIONS.md` and `/supabase/schema`.

Scope reviewed: `CLAUDE.md`, `README.md`, `PRD.md`, `DATA_MODEL.md`, `BUSINESS_RULES.md`,
`PERMISSIONS.md`, `USER_FLOWS.md`, `UI_SPEC.md`, `ACCEPTANCE_CRITERIA.md`,
`IMPLEMENTATION_PLAN.md`, `supabase_schema.sql`.

This review preserves the declared MVP scope. It adds no out-of-scope features
(no payments, waiting list, attendance, push, chat, calendar UI, analytics) and
does not weaken the multi-sport / multi-athlete / multi-guardian / multi-workspace
architecture.

Findings are numbered so they can be accepted or rejected individually.

---

## 1. Requirements review — contradictions and missing decisions

### 1.1 Blocking contradictions

**C-01 — Realtime occupancy is incompatible with the privacy rule as specified.**
`USER_FLOWS §3.9` and `IMPLEMENTATION_PLAN Phase 5` require occupancy to update in
real time for guardians. `BR-090`/`BR-091`/`AC-090` require that a guardian cannot
read other families' bookings. Supabase Realtime `postgres_changes` applies RLS per
subscriber: a guardian will **never** receive change events for another family's
booking row, so occupancy will never move on their screen. The same conflict breaks
occupancy on first load — a client-side `count(*)` over `bookings` returns only the
caller's own rows.

Both symptoms have one cause: occupancy is a cross-tenant aggregate that guardians
must see, derived from rows they must not see.

Resolution (recommended): a trigger-maintained projection table
`training_session_occupancy(training_session_id pk, confirmed_count, updated_at)`,
written **only** by a trigger on `bookings`, readable by anyone who can read the
session, and included in the Realtime publication. Guardians subscribe to the
projection, not to `bookings`.

This must be reconciled with `BR-050` ("confirmed booking count is derived from
booking rows; it is not stored as a manually maintained counter"). The projection
satisfies the *intent* of BR-050 — `bookings` remains the sole source of truth and
no application code ever writes the counter — but it does store a count. I recommend
amending BR-050 to read: *"…it is not maintained by application code. Any stored
count must be a database-maintained projection of booking rows."* A nightly
reconciliation assert should be part of Phase 8.

**C-02 — DST breaks recurring series generation, using the PRD's own example.**
`PRD §16` specifies a series: every Sunday 09:00–10:00, 4 Oct → 29 Nov. Those are
Sundays in 2026. Czech DST ends **25 Oct 2026**, which is itself an occurrence date.
Generating occurrences by adding 7×24h in UTC yields 07:00Z throughout, which is
09:00 local for the first three occurrences and **08:00 local** for the remaining six.

Nothing in the documents or the schema names a timezone. Every timestamp is
`timestamptz`, which is correct for storage but insufficient for generation and
display.

Resolution: add `workspaces.timezone text not null default 'Europe/Prague'`; generate
occurrences as local wall-clock dates and convert each independently
(`(date + time) AT TIME ZONE workspace_tz`); render all dates in workspace time, not
browser time. Assumption to confirm: session times are **workspace-local wall clock**,
so a 09:00 session stays 09:00 across the DST boundary.

**C-03 — "Registration available to users who receive the app link" is not enforceable
as described.** `PRD §7` frames registration as link-gated, but email OTP with
`shouldCreateUser: true` lets anyone self-register. There is no invite gate in the
schema or the MVP scope.

Resolution (recommended, no new features): accept open registration, and make it
harmless by requiring workspace athlete membership for session visibility (see
D-01). A self-registered stranger then sees an empty app. Amend PRD §7 to say the
link is a *distribution* channel, not an access control. The alternative — building
an invite/allowlist gate — is new scope and I do not recommend it for MVP.

**C-04 — "Série tréninků" is a navigable coach area with no entity behind it.**
`PRD §18` and `UI_SPEC` list a series area and a series creation form, but the schema
has no series table and `PRD §16` only says separate rows are created. A coach cannot
list, review or identify a series after creation.

Resolution: add `session_series` + nullable `training_sessions.series_id` (S-14). This
is not new scope — it is the minimum backing for a screen already specified. Editing a
series as a unit stays out of scope (`BR-081`: each occurrence is independently
editable).

**C-05 — `/docs` does not exist.** `CLAUDE.md` ("Read all files in `/docs`") and
`README.md` ("See `/docs`") both point at a directory that isn't in the repository;
all specification files sit at the repo root. Fix in Phase 0 by moving them (R-01).

### 1.2 Undecided rules that block correct implementation

Each of these must be answered before the corresponding phase. My recommendation is
given; all are cheap to change if you disagree.

| # | Question | Recommendation |
|---|---|---|
| D-01 | Which sessions can a guardian **see**? | Non-`DRAFT` sessions in workspaces where the guardian has ≥1 athlete with an active membership. `CLOSED`/full/ineligible sessions are visible with a disabled CTA (`UI_SPEC` shows this); `DRAFT` and other workspaces are invisible. This is the primary `training_sessions` SELECT policy. |
| D-02 | Exact 12-hour boundary | `start_at - now() >= interval '12 hours'`. At exactly 12:00:00 cancellation is **allowed**. (`BR-040` "at least" and `AC-040` "more than" disagree; pick one.) |
| D-03 | Is the 12h deadline a constant? | Store as `workspaces.cancellation_deadline_hours int not null default 12`. Same value, but not hardcoded — required by principle 11. |
| D-04 | Who sets `COMPLETED`? | Nothing in the stack schedules jobs. Derive "Minulé" from `end_at < now()`; leave `COMPLETED` as an allowed manual/admin status with no MVP writer. Otherwise the Past/Upcoming split silently depends on a job nobody is building. |
| D-05 | Booking N children when fewer places remain | **Decided otherwise.** The recommendation here was partial success; the approved rule is that multi-athlete guardian booking is atomic — all selected athletes or none, with the free-place count returned so the guardian can reduce the selection. One CTA must not split siblings into booked and not-booked states. See `BR-035a`–`BR-035c`. |
| D-06 | Can a guardian re-book after `CANCELLED_BY_COACH`? | **No.** Otherwise a parent silently undoes a coach's removal. The coach can re-add. The partial unique index does not cover this — it needs an explicit RPC check. |
| D-07 | Can a coach add athletes to a `CANCELLED` session? | No. Allowed on `DRAFT`/`OPEN`/`CLOSED`/`COMPLETED` (late roster correction). |
| D-08 | Coach narrows the birth-year range on a session with bookings | Preserve existing bookings, warn the coach. Consistent with `BR-052` and principle 9. Never auto-cancel. |
| D-09 | Athlete set to `is_active = false` | Blocks new bookings; existing bookings untouched; no cascade. |
| D-10 | Who creates `workspace_athlete_memberships`? | `USER_FLOWS §1.9` implies automatic. MVP: auto-create for the single active workspace when a sport profile matching that workspace's primary sport is created, via `SECURITY DEFINER` RPC. Document it as the join mechanism that an explicit join/invite flow replaces post-MVP. Note the privacy consequence: creating a hockey profile makes the child visible to that coach. |
| D-11 | Which changes set `ZMĚNĚNO`? Does it ever clear? | Set for date / start / end / facility / changing room / notes. **Not** for capacity-only or coach-roster-only changes (`BR-064`). Never cleared; shown only for future sessions to guardians with a confirmed booking. Replace the boolean with a timestamp (S-11). |
| D-12 | Is `changing_room` visible to guardians? | Yes, but only to guardians with a confirmed booking on that session. `UI_SPEC` shows it on the coach card only; parents need it on the day. |
| D-13 | Is `notes` visible to guardians? | Coach-internal for MVP. If parents should see it, it needs a second field — do not make one field dual-purpose. |
| D-14 | `created_by_role` when a coach books their own child | The role under which the RPC was invoked. The normal booking RPC always records `USER`; the coach RPC always records `COACH`. Never inferred. |
| D-15 | Transactional email provider and outbox drain | Not chosen anywhere. Recommend Resend + a Vercel Cron route handler that drains `notification_deliveries` using the service role. The alternative (`pg_cron` + `pg_net` → Edge Function) keeps it inside Supabase but adds a second runtime. |
| D-16 | Supabase Auth SMTP | Default Supabase SMTP is rate-limited to a handful of emails per hour and is not viable for OTP login. Custom SMTP must be configured in Phase 1 or Phase 1 cannot be demonstrated. |
| D-17 | Platform admin vs workspace admin | `DATA_MODEL` describes `user_roles` with a nullable `workspace_id`; the schema only has `workspace_members`, so there is nowhere to store a platform-level `ADMIN`. Recommend: `workspace_members` holds workspace-scoped roles; add a separate `platform_admins` table for platform staff. Reconcile the two documents. |
| D-18 | GDPR: erasure of a child's record | Subjects are minors in the EU. Principle 9 forbids hard deletion, and the FKs currently cascade (S-01). Decide now: erasure is satisfied by **anonymization** (blank names, drop photo, retain booking rows keyed by ID) via an admin RPC, not `DELETE`. Also settle who is controller (coach) vs processor (platform) before launch. |
| D-19 | Signed URL TTL for athlete photos | 60 minutes, generated server-side only. |
| D-20 | Next.js router | App Router, Server Components, Server Actions for mutations. Should be stated so it is not rediscovered per-phase. |

---

## 2. Data model and schema review

The domain model is sound. Sport-independent athlete identity, sport profiles with a
JSONB attribute bag, separate workspace membership, an M:N guardian table from day one,
soft-cancelled bookings, a partial unique index for one confirmed booking per
athlete/session, and an outbox pair for notifications — these are the right calls and I
would not change any of them.

The problems below are integrity and enforcement gaps, not modelling mistakes.

**M-01 — Cascades destroy operational history.** `bookings.training_session_id` and
`bookings.athlete_id` are `on delete cascade`. Deleting one athlete row silently erases
their entire booking history, contradicting principle 9, `BR-044` and `BR-071`. The same
applies to `workspace_athlete_memberships` and to `training_sessions` → workspace.
Meanwhile `bookings.created_by_user_id` has no cascade and would *block* user deletion —
so the deletion policy is currently self-contradictory.

**M-02 — Composite FKs are missing; three cross-entity invariants are unenforced.**
- `training_sessions(location_id, facility_id)` — nothing prevents a facility from a
  different location. `facilities` is unique on `(location_id, code)` but the session
  references the facility alone.
- `training_sessions(workspace_id, location_id)` — nothing prevents a location from
  another workspace being used. This is a **multi-tenant leak in data**, not just a bug.
- `workspace_athlete_memberships(athlete_id, athlete_sport_profile_id)` — nothing
  prevents a profile belonging to a *different* athlete.
- Nothing requires the membership's sport profile to match the workspace's primary sport.

Principle 3 says invariants are database-enforced. These need composite unique keys plus
composite FKs (S-02..S-05).

**M-03 — `confirmed_booking_count()` is wrong under RLS.** It is `stable` but not
`security definer`, so it runs with the caller's privileges. A guardian calling it gets
the count of *their own* bookings. Every occupancy display built on it will be wrong.
Must be `security definer` with `set search_path = ''` (S-06).

**M-04 — State columns have no consistency constraints.** Nothing requires
`status in ('CANCELLED_BY_USER','CANCELLED_BY_COACH')` ⇒ `cancelled_at is not null`, or
`status = 'CONFIRMED'` ⇒ `cancelled_at is null`. Same for
`training_sessions.status = 'CANCELLED'` ↔ `cancelled_at` / `cancelled_by_user_id`.
Cheap check constraints; principle 3 (S-07).

**M-05 — `updated_at` is never maintained.** The columns exist on six tables with no
trigger. Every one will freeze at insert time (S-08).

**M-06 — `main_coach_user_id` can diverge from `training_session_coaches`.**
`DATA_MODEL` calls the association table canonical and permits the mirror, but nothing
keeps them in sync and nothing enforces exactly one `MAIN` row per session (S-09).

**M-07 — No audit table.** `CLAUDE.md` principle 8 requires auditing important
booking/session changes. `notification_events` is an outbox, not an audit log, and
`coach_capacity_override` alone does not satisfy `BR-034`'s "explicit and auditable".
An `audit_log` table is in scope (S-13).

**M-08 — Orphan athletes are possible.** Creating an athlete and then inserting guardian
access is two statements. If the second fails, the athlete row exists, is invisible
under RLS to everyone including its creator, and cannot be deleted. Athlete creation
must be a single `SECURITY DEFINER` RPC (S-15, and RPC list in §3).

**M-09 — `notification_deliveries.recipient_email` conflicts with the email-privacy
rule.** `PERMISSIONS` says not to copy emails into domain tables. Storing it here is
justified — you must know where a message was sent — but the table must be
**service-role only**, with no `SELECT` policy for any authenticated role. Record the
exception explicitly rather than leaving it as an apparent violation.

**M-10 — Per-recipient email payload is missing.** `AC-073` requires one email listing
*both* of a guardian's affected athletes. The event payload is per-session; the
delivery row has no payload, so the athlete list cannot be personalized per recipient
(S-12).

**M-11 — Indexes for RLS-heavy paths are missing.** Every guardian query filters through
`guardian_athlete_access`; every coach query through `workspace_members`. Neither has
the covering indexes those access paths need, and `bookings(athlete_id)` is unindexed
(S-16).

**M-12 — `attributes` JSONB accepts unknown keys.** `validate_hockey_attributes` checks
`position` and `stick_side` but permits arbitrary additional keys. Add a key whitelist
for `HOCKEY`. I deliberately do **not** recommend a generic per-sport attribute schema
registry — that is the over-engineering principle 12 warns against.

**M-13 — `birth_year_from/to` are unbounded integers.** A sanity range check
(1900–2100) plus an assertion that the range is consistent with `eligibility_mode`
(already partly present) closes this. Minor.

---

## 3. Security, concurrency, RLS and multi-tenant risks

### 3.1 Concurrency

**S-C1 — The capacity race (`AC-022`, `BR-032`).** `count(*)` then `insert` is a classic
lost-update race: two transactions both read 9/10 and both insert. Postgres' default
`READ COMMITTED` does not prevent it, because there is no row to conflict on.

Serialization point: `SELECT ... FROM training_session_occupancy WHERE
training_session_id = $1 FOR UPDATE` at the top of the booking RPC. This takes a real
row lock on a per-session row, so concurrent bookings for *different* sessions do not
contend. The occupancy projection introduced for C-01 thus does double duty. Advisory
locks (`pg_advisory_xact_lock`) are the fallback if the projection is rejected.

Order inside `book_athlete_normal`: lock occupancy row → re-read session → all
validations → insert → trigger updates projection. Never validate before locking.

**S-C2 — The unique index is a backstop, not the mechanism.** 
`uq_confirmed_booking_per_athlete_session` correctly prevents double-booking
(`BR-031`, `AC-023`) and correctly allows rebooking after cancellation. The RPC must
still check explicitly and return a typed error, because a raw `23505` surfaced to the
UI is not an actionable Czech message. It also does not cover D-06.

**S-C3 — Multi-athlete booking (D-05) must not take locks in inconsistent order.** All
athletes in one call target the same session, so there is one lock. Do not "optimize"
by looping the RPC client-side per athlete — that reopens the race window between
attempts and produces confusing partial states.

**S-C4 — Series creation must be one transaction (`AC-080`).** Nine occurrences must be
all-or-nothing; a partially generated series leaves the coach with no way to tell what
was created.

**S-C5 — Capacity reduction is itself a race.** A coach lowering capacity 10→6 while a
parent books the 10th place must not produce an inconsistent state. The session update
RPC should take the same occupancy lock, and must require an explicit
`p_confirm_over_capacity boolean` from the coach (`BR-051`, `AC-051`) — the warning is a
server-side gate, not a dialog.

### 3.2 RLS

**S-R1 — Recursive policy definitions will deadlock the design.** A policy on
`workspace_members` that queries `workspace_members`, or on `guardian_athlete_access`
that queries itself, causes infinite recursion in Postgres RLS. This is the single most
common way a Supabase schema of this shape fails. All membership predicates must be
`SECURITY DEFINER STABLE` helper functions with `set search_path = ''`:
`is_workspace_coach(ws)`, `is_workspace_member(ws)`, `has_athlete_access(athlete)`,
`is_platform_admin()`.

**S-R2 — `SECURITY DEFINER` without a pinned `search_path` is a privilege-escalation
vector.** Any definer function that resolves an unqualified name can be hijacked via a
schema earlier in the caller's `search_path`. Every definer function in this project must
carry `set search_path = ''` and fully qualify every identifier. The Supabase database
linter flags this; it should be run as part of Phase 1's exit criteria.

**S-R3 — No `DELETE` policies should exist at all.** With RLS enabled and no `DELETE`
policy, deletes are impossible for non-service roles. That is exactly what principle 9
wants. State it as an explicit design decision so nobody "fixes" it later.

**S-R4 — Guardians must not be able to `INSERT` or `UPDATE` bookings directly.** All
booking mutations go through RPCs. `bookings` should have a guardian `SELECT` policy
(own athletes) and *no* guardian `INSERT`/`UPDATE` policy. `PERMISSIONS` says "create
normal bookings for own linked athletes" — that permission is exercised through the RPC,
not through table access. Otherwise the client can insert a booking that bypasses
capacity, eligibility and the 12-hour rule entirely.

**S-R5 — Same for `training_sessions` `UPDATE`.** Coaches get `SELECT` on their
workspace's sessions, but writes go through RPCs so that the marker, notification events
and audit rows are produced atomically with the change. A direct table `UPDATE` policy
would let a coach change a time without generating the legally-required email
(`BR-061`).

**S-R6 — `notification_events` / `notification_deliveries`: service role only.** No
policies for authenticated users. See M-09.

**S-R7 — `auth.users` is not readable by the anon/authenticated role.** Guardian email
lookup for notifications (`BR-072`) must happen in the drain job under the service role.
`app_profiles` must not gain an `email` column to work around this (`PERMISSIONS`,
email privacy).

**S-R8 — Storage RLS is separate and easy to forget.** A private bucket is not enough;
`storage.objects` needs its own policies. Enforce a path convention
`athletes/{athlete_id}/{uuid}.jpg` and derive authorization from the first path segment
via `has_athlete_access()` / workspace coach membership. Uploads must be validated for
content type and size server-side.

### 3.3 Multi-tenancy

**S-T1 — `bookings` has no `workspace_id`.** Every tenant check on a booking must join
through `training_sessions`. Correct, but it makes RLS predicates two hops deep on the
hottest table. Acceptable for a single-workspace MVP; revisit if predicate cost shows up.
I do **not** recommend denormalizing now — a redundant `workspace_id` that can disagree
with the session's is a worse tenant bug than a slow join.

**S-T2 — Cross-workspace references are structurally possible.** See M-02: a session can
today reference another workspace's location. In a single-workspace MVP this is
invisible; the day a second workspace exists it is a data-level tenant breach. Composite
FKs fix it permanently and cost nothing.

**S-T3 — Athletes are global, not workspace-scoped, by design.** That is correct
(`BR-102`) but it means the `athletes` SELECT policy is the most security-sensitive
object in the system: it must grant coaches access **only** through an *active*
`workspace_athlete_memberships` row in a workspace where they are an *active* member.
A coach whose membership is deactivated must lose athlete visibility immediately.
`AC-091` is the test for this.

**S-T4 — Service role key handling.** It must never appear in a `NEXT_PUBLIC_*` variable
or be imported into a Client Component. Recommend a single `src/lib/supabase/admin.ts`
with a `server-only` import guard, plus a lint rule, so this cannot regress.

**S-T5 — Anon-key clients must always carry the user JWT.** Server Actions and Route
Handlers should use the request-scoped SSR client so RLS applies. Service role is for
the notification drain and admin tooling only.

### 3.4 Privacy

**S-P1 — Occupancy is the only cross-family fact a guardian may learn.** The projection
table (C-01) must expose `confirmed_count` and nothing else — no athlete IDs, no last
booker, no timestamps that could correlate to a specific family's action.

**S-P2 — Realtime publication membership is a disclosure decision.** `bookings` must
**not** be added to the Realtime publication for guardian channels. Only
`training_session_occupancy` and `training_sessions` should be.

**S-P3 — Enumeration.** `PRD §6` forbids finding children by name + DOB. There is no
such search in MVP scope; the constraint is satisfied by not building it and by the
`athletes` SELECT policy. Keep it out of the coach athlete list too (coach sees their
workspace's athletes only, not a global search).

### 3.5 Required server-side functions

All `SECURITY DEFINER`, `set search_path = ''`, each returning a typed result rather
than raising bare exceptions:

| Function | Notes |
|---|---|
| `create_athlete_with_access` | Atomic athlete + guardian access (M-08) |
| `upsert_athlete_sport_profile` | Also auto-creates workspace membership (D-10) |
| `book_athlete_normal` | Occupancy lock → all checks → insert. Accepts an athlete array (D-05) |
| `book_athlete_as_coach` | Records `coach_capacity_override`, writes audit (BR-034) |
| `cancel_booking_as_guardian` | Server-computed 12h rule (D-02, D-03). Never trusts a client flag |
| `cancel_booking_as_coach` | Any time (BR-042) |
| `update_training_session` | Change detection → marker + notification event + audit, atomically. Requires `p_confirm_over_capacity` (S-C5) |
| `cancel_training_session` | Status + event + dedup recipient expansion |
| `create_session_series` | One transaction, timezone-correct generation (C-02, S-C4) |
| `duplicate_training_session` | Copies config and coaches; never bookings |
| `session_occupancy(session_ids[])` | Bulk aggregate for list screens |

---

## 4. Proposed repository structure

```text
trainlio/
├── docs/                              # R-01: all existing specs move here
│   ├── PRD.md  DATA_MODEL.md  BUSINESS_RULES.md  PERMISSIONS.md
│   ├── USER_FLOWS.md  UI_SPEC.md  ACCEPTANCE_CRITERIA.md
│   ├── IMPLEMENTATION_PLAN.md  ARCHITECTURE_REVIEW.md
│   └── adr/                           # one file per decision in §1.2
├── supabase/
│   ├── config.toml
│   ├── migrations/
│   │   ├── 0001_extensions_enums.sql
│   │   ├── 0002_core_tables.sql
│   │   ├── 0003_integrity_constraints.sql   # composite FKs, checks, updated_at
│   │   ├── 0004_indexes.sql
│   │   ├── 0005_authz_helpers.sql           # SECURITY DEFINER predicates (S-R1)
│   │   ├── 0006_rls_policies.sql
│   │   ├── 0007_occupancy_projection.sql    # C-01
│   │   ├── 0008_booking_rpcs.sql
│   │   ├── 0009_session_rpcs.sql
│   │   ├── 0010_series_rpcs.sql
│   │   ├── 0011_notifications.sql
│   │   ├── 0012_audit.sql
│   │   ├── 0013_storage_policies.sql
│   │   └── 0014_realtime_publication.sql
│   ├── seed/{01_reference.sql,02_dev_fixtures.sql}
│   └── tests/                         # pgTAP: RLS matrix, constraints
├── src/
│   ├── app/
│   │   ├── (auth)/prihlaseni/
│   │   ├── (guardian)/
│   │   │   ├── treninky/[id]/
│   │   │   ├── moje-treninky/
│   │   │   ├── moji-sportovci/[athleteId]/
│   │   │   └── ucet/
│   │   ├── (coach)/trener/
│   │   │   ├── treninky/[id]/          # detail + roster
│   │   │   ├── novy-trenink/
│   │   │   ├── serie/
│   │   │   └── sportovci/
│   │   ├── api/
│   │   │   ├── cron/send-notifications/route.ts   # D-15, CRON_SECRET guarded
│   │   │   └── photos/[athleteId]/route.ts        # signed URL issuance, D-19
│   │   └── layout.tsx
│   ├── components/
│   │   ├── ui/                        # shadcn primitives
│   │   ├── session/  booking/  athlete/  layout/
│   ├── server/
│   │   ├── actions/{booking,session,athlete,series}.ts
│   │   └── notifications/{dispatch.ts,templates/}
│   ├── lib/
│   │   ├── supabase/{browser,server,admin,middleware}.ts
│   │   ├── domain/                    # pure, unit-testable, mirrors SQL rules
│   │   │   ├── eligibility.ts  capacity.ts  cancellation.ts
│   │   │   ├── recurrence.ts   session-diff.ts
│   │   ├── time/{workspace-tz.ts,format-cs.ts}
│   │   ├── i18n/{messages/cs.json,index.ts}
│   │   └── enums/{hockey.ts,session.ts,booking.ts}   # code → cs label maps
│   └── types/database.generated.ts
├── tests/
│   ├── unit/            # Vitest: domain/*
│   ├── integration/     # Vitest + local Supabase: RPCs, RLS, concurrency
│   └── e2e/             # Playwright: guardian.spec.ts, coach.spec.ts
├── .github/workflows/ci.yml
└── CLAUDE.md  README.md  package.json  ...
```

Structural decisions worth stating:

- **Route groups by audience**, with Czech URL segments. Czech is the product language;
  English URLs would be a needless translation layer.
- **`src/lib/domain` holds pure functions with no Supabase import.** Eligibility,
  the 12-hour rule and capacity logic are duplicated deliberately: SQL is the
  authority (principle 5), TypeScript drives UI affordances. The duplication is
  acceptable only because both are tested against the same `ACCEPTANCE_CRITERIA` table.
- **`src/lib/enums`** maps stable codes to Czech labels in one place, satisfying
  `PRD §21` — no Czech label is ever stored as business data.
- **Mutations are Server Actions that call RPCs.** No mutation path reaches a table
  directly (S-R4, S-R5).

---

## 5. Phased implementation plan

The existing `IMPLEMENTATION_PLAN.md` phases are kept; this version adds exit criteria
and folds in the findings above. Nothing new is introduced to the product surface.

**Phase 0 — foundation** *(awaiting your approval to start)*
Next.js App Router + TypeScript strict, Tailwind, shadcn/ui, Vitest, Playwright, ESLint
with a `server-only` guard on the admin client, env schema validation, Czech message
structure, docs moved to `/docs` (R-01), ADR files for every §1.2 decision, CI workflow.
*Exit:* `pnpm lint typecheck test build` green; empty app deploys to Vercel.

**Phase 1 — database, authz and auth**
Migrations 0001–0006 and 0013–0014. All schema changes from §6. RLS on every
user-facing table; helper predicates as definer functions. Reference seed (HOCKEY,
workspace, Příbram, MH/VH). Supabase Auth OTP with **custom SMTP** (D-16). Generated
types.
*Exit:* Supabase linter clean; pgTAP RLS matrix passes — a guardian cannot read another
family's athlete, booking or photo (`AC-091`); no table is writable without RLS.

**Phase 2 — athlete management**
Guardian athlete CRUD via `create_athlete_with_access`, hockey sport profile form,
private photo upload with signed URLs, multi-child support, auto workspace membership.
*Exit:* `AC-010`–`AC-015`, `AC-092`, `AC-100`–`AC-102`, `AC-110`–`AC-111`.

**Phase 3 — coach session management**
Create / edit / close / cancel / duplicate, capacity warning gated server-side,
change detection feeding the marker.
*Exit:* `AC-051`, `AC-052`, `AC-060`, `AC-062`, `AC-070`.

**Phase 4 — recurring series**
`session_series`, timezone-correct generation (C-02), date preview, one-transaction
bulk creation.
*Exit:* `AC-080`–`AC-082`, plus an explicit DST test: the PRD's own 4 Oct → 29 Nov 2026
series produces nine occurrences all at 09:00 Europe/Prague.

**Phase 5 — booking engine**
Occupancy projection, `book_athlete_normal` with the row lock, multi-athlete picker,
guardian cancellation RPC, Realtime on the projection.
*Exit:* `AC-020`–`AC-025`, `AC-030`–`AC-032`, `AC-040`, `AC-041`, `AC-043`, `AC-090`.
`AC-022` proven by a concurrency test with genuinely parallel connections, not a loop.

**Phase 6 — coach roster**
Roster with booked-by and timestamp, manual booking, override confirmation, coach
cancellation.
*Exit:* `AC-042`, `AC-050`, `BR-092`; audit rows exist for every override.

**Phase 7 — notifications**
Outbox drain job, email provider, change and cancellation emails, per-recipient
deduplication with the athlete list.
*Exit:* `AC-061`, `AC-071`–`AC-073`; verified that one guardian with two booked children
receives exactly one email naming both.

**Phase 8 — QA**
Unit (domain), integration (RLS matrix, all RPCs, concurrency), Playwright guardian and
coach flows, mobile viewport review, occupancy reconciliation assert.
*Exit:* every AC has a named test.

**Phase 9 — deployment**
Vercel production, Supabase production project, SMTP, secrets, cron secret, backup and
point-in-time-recovery notes, runbook for coach-side incidents.

Recommended review checkpoints with you: after Phase 1 (schema + RLS frozen) and after
Phase 5 (booking correctness), since those two carry nearly all the irreversible risk.

---

## 6. Recommended schema changes before implementation

Ordered by severity. Each is independently acceptable or rejectable.

### Must fix

- **S-01 — Replace destructive cascades.** `bookings.training_session_id` and
  `bookings.athlete_id` → `on delete restrict`. Same for
  `workspace_athlete_memberships.athlete_id`, `athlete_sport_profiles.athlete_id`, and
  `training_sessions.workspace_id`. Deletion is not a supported operation (D-18).
- **S-02 — `facilities`: add `unique(id, location_id)`;** `training_sessions` gains
  `foreign key (facility_id, location_id) references facilities(id, location_id)`.
- **S-03 — `locations`: add `unique(id, workspace_id)`;** `training_sessions` gains
  `foreign key (location_id, workspace_id) references locations(id, workspace_id)`.
- **S-04 — `athlete_sport_profiles`: add `unique(id, athlete_id)`;**
  `workspace_athlete_memberships` gains
  `foreign key (athlete_sport_profile_id, athlete_id) references athlete_sport_profiles(id, athlete_id)`.
- **S-05 — `athlete_sport_profiles`: add `unique(id, sport_id)`;**
  `workspace_athlete_memberships` gains `sport_id`, a composite FK to the profile's
  sport, and a composite FK to `workspaces(id, primary_sport_id)` (requiring
  `workspaces unique(id, primary_sport_id)`). This makes "the membership's sport matches
  the workspace's sport" structurally impossible to violate.
- **S-06 — `confirmed_booking_count`: make it `security definer` with
  `set search_path = ''`** and `revoke execute ... from public` / grant to
  `authenticated`.
- **S-07 — Add state check constraints** on `bookings` (cancelled status ⇔
  `cancelled_at`/`cancelled_by_user_id` present; `CONFIRMED` ⇒ both null) and on
  `training_sessions` (`CANCELLED` ⇔ `cancelled_at` present).
- **S-08 — Add a shared `set_updated_at()` trigger** on all six tables carrying
  `updated_at`.
- **S-10 — Add `training_session_occupancy`** (`training_session_id` PK → sessions,
  `confirmed_count int not null default 0 check (confirmed_count >= 0)`, `updated_at`)
  maintained by an `after insert/update/delete` trigger on `bookings`, plus a row created
  by a trigger on `training_sessions` insert. Required by C-01 and S-C1.
- **S-17 — Add `workspaces.timezone text not null default 'Europe/Prague'`** (C-02) and
  **`workspaces.cancellation_deadline_hours int not null default 12 check (> 0)`** (D-03).

### Should fix

- **S-09 — `training_session_coaches`: add
  `create unique index on training_session_coaches(training_session_id) where role = 'MAIN'`**
  and a trigger keeping `training_sessions.main_coach_user_id` in sync with the `MAIN`
  row (M-06).
- **S-11 — Replace `training_sessions.updated_marker boolean` with
  `last_significant_change_at timestamptz`.** Sortable, lets the UI show the marker only
  for changes made after a guardian's booking, and removes the "when does it clear?"
  question (D-11).
- **S-12 — Add `notification_deliveries.payload jsonb not null default '{}'`** for
  per-recipient athlete lists (`AC-073`, M-10). Also add
  `attempt_count int not null default 0`, `last_error text`, and
  `status text check (status in ('PENDING','SENT','FAILED'))` so the drain job is
  retry-safe and idempotent. Consider `notification_events.dispatched_at` to mark
  expansion as done.
- **S-13 — Add `audit_log`** (`id`, `workspace_id`, `actor_user_id`, `action text`,
  `entity_type text`, `entity_id uuid`, `before jsonb`, `after jsonb`, `created_at`),
  service-role/admin readable only. Required by principle 8 and `BR-034` (M-07).
- **S-14 — Add `session_series`** (`id`, `workspace_id`, `created_by_user_id`,
  recurrence fields: `weekday`, `date_from`, `date_to`, `start_time`, `end_time`, plus
  the template session config, `created_at`) and
  `training_sessions.series_id uuid null references session_series(id)`. Required by C-04.
  Occurrences stay fully independent (`BR-081`).
- **S-16 — Add indexes:** `guardian_athlete_access(user_id) where status = 'ACTIVE'`;
  `guardian_athlete_access(athlete_id) where status = 'ACTIVE'`;
  `workspace_members(user_id) where is_active`;
  `workspace_athlete_memberships(workspace_id, athlete_id) where is_active`;
  `bookings(athlete_id, status)`;
  `training_sessions(workspace_id, status, start_at)`.

### Nice to have

- **S-18 — `platform_admins(user_id pk)`** (or a JWT claim) to give the `ADMIN` role of
  `PRD §3` somewhere to live (D-17). Reconcile `DATA_MODEL.md`'s `user_roles` section
  with the actual `workspace_members` table either way.
- **S-19 — `training_sessions`: check `birth_year_from between 1900 and 2100`** and the
  same for `birth_year_to` (M-13).
- **S-20 — Extend `validate_hockey_attributes`** to reject unknown `attributes` keys for
  `HOCKEY` (M-12).
- **S-21 — Add `guardian_athlete_access.permission_level` as an enum** rather than free
  text, or drop it to `MANAGE`-only for MVP. As untyped text it invites divergent values
  before the second guardian flow exists.
- **S-22 — `bookings`: add `cancellation_reason text null`** — useful for the coach
  removal case and costs nothing. Optional.

### Document changes recommended alongside

- `BR-050` — amend for the occupancy projection (C-01).
- `BR-040` / `AC-040` — align the boundary wording (D-02).
- `PRD §7` — clarify that the link is distribution, not access control (C-03).
- `DATA_MODEL.md` — reconcile `user_roles` vs `workspace_members` (D-17).
- `CLAUDE.md` / `README.md` — `/docs` path (C-05).
