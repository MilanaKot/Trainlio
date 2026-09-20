# Implementation Plan

Trainlio — Sports Training Booking Platform

Revised after the approved architecture review. Each phase states exit criteria
so "done" is testable rather than declared.

Phase 0 is **not** started until this revised architecture is approved.

## Phase 0 — foundation ✅

- Next.js App Router, TypeScript strict mode
- Tailwind, shadcn/ui
- Vitest, Playwright
- Supabase client factories: browser, request-scoped server, admin
- `server-only` guard plus a lint rule so the service-role client can never be
  imported into a client component or a `NEXT_PUBLIC_` variable
- Environment schema validation that fails the build on a missing secret
- Czech message structure with plural categories (needed for the booking
  place-count messages)
- Workspace-timezone date formatting helper; no direct use of the device timezone
- CI: lint, typecheck, unit tests, build

Exit: `lint`, `typecheck`, `test`, `build` all green; an empty application
deploys to Vercel.

## Phase 1 — database, authorization and auth ✅

- Promote the reviewed schema to `/supabase/migrations`
- Supabase Auth integration: a profile is created for each new authentication
  identity, without which every policy resolves to null
- Reference seed: HOCKEY, workspace with `Europe/Prague` and a 12-hour deadline,
  Příbram, MH and VH
- Row level security on every user-facing table, with SECURITY DEFINER helper
  predicates and explicit EXECUTE grants
- Storage bucket and its policies
- Realtime publication: occupancy projection and sessions only
- Supabase Auth OTP with Resend as custom SMTP
- Generated database types

Exit: Supabase database linter clean; the RLS test matrix passes, proving a
guardian cannot read another family's athlete, booking or photo (AC-091,
AC-092); no table is writable without passing through a policy; AC-130 to AC-135,
AC-210 to AC-214 (roles) and AC-220 to AC-223 (account data separability) hold.

The pre-implementation validation in `/supabase/tests` already covers most of
these; Phase 1 ports them to the Supabase CLI local stack.

## Phase 2 — athlete management ✅

- Transactional athlete creation: athlete, guardian access, sport profile and
  workspace membership in one operation
- `joinable_workspaces()`, without which a parent registering their first child
  can read no workspace at all and the form has nothing to submit
- Hockey sport profile form driven by the enum codes
- Private photo upload with server-issued signed URLs
- Multiple children per guardian

Exit: AC-010 to AC-015, AC-092, AC-100 to AC-102, AC-110, AC-111, AC-180 to
AC-184 (athlete deactivation).

## Phase 3 — coach session management ✅

- Create, edit, close and reopen, cancel, duplicate
- Server-side capacity warning gate
- Change classification driving the significant-change marker

Exit: AC-051, AC-052, AC-060, AC-062, AC-070, AC-070a, AC-027, AC-160 to AC-164
(terminal cancellation), AC-170 to AC-175 (eligibility narrowing), AC-190 to
AC-194 (significant changes), AC-200 to AC-204 (notes and changing room).

## Phase 4 — recurring series ✅

- `session_series` with generation metadata
- Local wall-clock generation, per-occurrence conversion
- Date preview before save
- Single-transaction bulk creation

Exit: AC-080 to AC-080c. The daylight-saving case (AC-080a) is a required test,
not a manual check.

## Phase 5 — booking engine ✅

- Occupancy projection and its triggers
- Atomic multi-athlete guardian booking with the occupancy row lock
- Athlete picker showing only eligible athletes, with the insufficient-capacity
  recovery path
- Guardian cancellation against the workspace deadline
- Realtime occupancy on the projection

Exit: AC-020 to AC-028, AC-030 to AC-032, AC-040 to AC-041, AC-043, AC-090 to
AC-090d, AC-120 to AC-123. AC-022 is proven with genuinely parallel database
connections.

## Phase 6 — coach roster ✅

- `session_roster`: who is booked, who booked them and when, with the
  cancelled rows kept — a `SECURITY DEFINER` function rather than a widened
  `app_profiles` policy, because a coach needs one guardian name and not every
  guardian profile in the workspace
- `coach_session_candidates`: workspace-wide, keeping the ineligible athletes
  with their reason, unlike the guardian picker
- `book_athlete_as_coach`: one athlete per call, with the capacity override as a
  server-side gate that returns the numbers the warning has to show
- `cancel_booking_as_coach`: no deadline, and it is what creates the D-06
  re-booking block
- Coach roster UI: the attendance list, the add picker, the over-capacity
  confirmation and the removal warning that states the parent cannot undo it

Exit: AC-042, AC-042a to AC-042c, AC-050, AC-142. ✅
`validation_roster.sql` (73 cases), `tests/unit/roster.test.ts` (13 cases) and
the roster section of `integration.mjs` (24 checks over HTTP).

## Phase 7 — notifications ✅

- `notification_event_recipients` and `expand_notification_event`: one delivery
  per guardian, carrying that guardian's own athletes, idempotent on both the
  dispatch marker and the unique constraint
- `claim_notification_deliveries` / `record_notification_delivery`: claim with
  `SKIP LOCKED`, a bounded attempt budget, and reclaim of a delivery whose drain
  died mid-flight
- `EmailProvider` with a single Resend implementation, and a pure Czech message
  composer above it
- `/api/notifications/drain` on a five-minute Vercel Cron schedule, behind a
  constant-time shared-secret check

Exit: AC-061, AC-071 to AC-073, AC-150 to AC-152. ✅
`validation_notifications.sql` (67 cases), `tests/unit/notifications.test.ts`
(26) and `tests/unit/email.test.ts` (9), `tests/e2e/notifications.spec.ts` (4),
and the outbox section of `integration.mjs` (31 checks over HTTP).

Verified end to end that one guardian with two booked children receives exactly
one email naming both: over HTTP in `integration.mjs` (`created === 2` for two
families, one delivery for the family of two, `athlete_names` of length 2) and
on the composed string in the unit suite.

## Phase 8 — QA

- Unit tests for the pure domain functions
- Integration tests: RLS matrix, every domain function, concurrency
- Occupancy reconciliation assert: the projection equals a recount of bookings
- Playwright guardian and coach flows
- Mobile viewport review

Exit: every acceptance criterion maps to a named test.

## Phase 9 — deployment

- Vercel production, Supabase production project
- Resend domain verification for both SMTP and transactional sending
- Secrets, including the cron shared secret
- Backup and point-in-time recovery notes
- Coach-facing incident runbook

## Review checkpoints

Two checkpoints carry nearly all the irreversible risk:

- after Phase 1, when the schema and the authorization model freeze;
- after Phase 5, when booking correctness is established.

## Before Phase 9

The account deletion and anonymisation *workflow* (D-18) must be decided before
production launch. The architectural constraint is already applied and verified:
no domain history depends on an `auth.users` row existing. See
`OPEN_DECISIONS.md`.
