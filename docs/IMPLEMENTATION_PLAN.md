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

## Phase 8 — QA ✅

- `scripts/ac-coverage.mjs`: parses the specification, greps the test corpus,
  and fails on an uncovered criterion or on a test citing an identifier the
  specification no longer defines
- `validation_qa.sql`: the criteria no earlier suite reached — the shape of the
  stored data, the roles matrix, the D-18 constraints
- `occupancy_reconciliation()` and `sessions_without_occupancy()`: the
  projection against a recount, with a case that drifts it first so the
  assert's silence means something
- `concurrency.sh` AC-022a: two sessions booked at once, measured against the
  same session serialising, so the lock is shown to be per row
- Playwright guardian and coach flows, signed in through the real OTP form
- Mobile viewport review: no sideways scroll, every target thumb-sized

Exit: every acceptance criterion maps to a named test. ✅
**116 of 116**, checked by `pnpm qa:coverage` in CI.

Four defects were found by the new tests and fixed:

| Found by | Defect |
|---|---|
| Browser flow | An ambiguous PostgREST embed made **every guardian's session list render empty**. `training_sessions` holds three foreign keys into `app_profiles`, so the bare embed was refused — and the refusal was discarded along with the rows. |
| The same | Read paths destructured `{ data }` and dropped `error`, so any query failure looked like "nothing found". Now `rows()`/`maybeRow()` raise, and a lost session redirects to sign-in instead. |
| Mobile review | The coach header links, the eligibility radios and every date input were under the 44px a thumb needs. |
| Full suite | `validation_bookings.sql` paired `current_date` with a Prague-relative time, which lands on the next day late in the evening. |

## Phase 9 — deployment ✅

- The D-18 workflow, which the plan deferred until now (migration 19):
  `anonymize_profile()`, `anonymization_preview()`,
  `scrub_notification_emails()` and `dormant_profiles()`, all service-role only
- `repair_occupancy()` (migration 20): the supported fix for projection drift,
  which writing the runbook showed was missing
- [`DEPLOYMENT.md`](DEPLOYMENT.md): Supabase, Resend, Vercel, the first coach
  grant, the end-to-end verification, backups and point-in-time recovery,
  and the data-protection summary
- [`RUNBOOK.md`](RUNBOOK.md): the coach-facing incident runbook, with the Czech
  a coach would actually send to a parent
- Security headers, `robots.txt`, and `poweredByHeader: false`

Exit: the deployment is reproducible from the documents, and nothing in
`OPEN_DECISIONS.md` is open. ✅
`validation_retention.sql` (61 cases) covers AC-224 to AC-231; AC-232 is in
`validation_qa.sql`. **125 of 125** acceptance criteria map to a named test.

Two defects were found by writing this phase:

| Found by | Defect |
|---|---|
| The retention suite | `scrub_notification_emails()` dated settled deliveries by `updated_at`, which the `set_updated_at` trigger rewrites on every write — including the scrub's own. A failed delivery's address would never have been cleared. Now `sent_at`, then `claimed_at`. |
| Writing the runbook | The repair procedure it first carried did not work. The occupancy trigger fires on `update of status`, not on any write, so an operator's only options were to wait for a parent to book or to fake a status change. `repair_occupancy()` is the answer, and the QA suite now asserts that touching a booking row does *not* recompute. |

### Not done here, and why

Provisioning itself needs the club's own Supabase, Vercel and Resend accounts,
so `DEPLOYMENT.md` is written to be followed rather than executed. Two values in
it are the club's policy to set, with defaults that work: the delivery-address
retention window and the dormancy review window (`OPEN_DECISIONS.md`, D-18).

A Content-Security-Policy is deliberately absent. Next injects inline bootstrap
scripts, so a policy worth having needs per-request nonces threaded through the
proxy; one with `unsafe-inline` would read like protection and not be any. It
belongs after launch, not in the same change as everything else.

## Review checkpoints

Two checkpoints carry nearly all the irreversible risk:

- after Phase 1, when the schema and the authorization model freeze;
- after Phase 5, when booking correctness is established.

## Before Phase 9 — done

The account deletion and anonymisation *workflow* (D-18) was the one thing the
plan required before production launch. It is decided, implemented and verified
in Phase 9; `OPEN_DECISIONS.md` has nothing left open.
