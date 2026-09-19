# Open Decisions

Trainlio — Sports Training Booking Platform

Every item below materially affects the schema, an RPC signature, the privacy
model, the tenancy model, or user-visible behaviour, and none has been explicitly
decided. Each carries a provisional choice so the documents and the proposed
schema are complete and reviewable — the provisional choice is marked in the
source it appears in, and none is silently baked in.

**Nine items need a decision.** D-18 was deferred by the approver; the other eight
are new asks.

---

## Needs a decision before Phase 1 (schema)

### D-17 — Platform administration
**Question.** `PRD §3` defines ADMIN as a technical/business administrator, separate
from COACH. `DATA_MODEL` originally sketched a `user_roles` table with a nullable
workspace id; the original schema had only `workspace_members`, leaving nowhere to
store a platform-level administrator.

**Provisional.** Two separate things: `workspace_members.role` is a `workspace_role`
enum of COACH and ADMIN (workspace-scoped), and a separate `platform_admins` table
holds platform staff. The `app_role` enum, which included USER, is dropped — being
a guardian is an athlete relationship, not a workspace membership.

**Impact if changed.** Schema, and the shape of every role predicate.

### D-11 — Which changes are "significant"
**Question.** `BR-062` requires a `ZMĚNĚNO` marker on changed future sessions.
Which field changes set it, and does it ever clear?

**Provisional.** Stored as `last_significant_change_at timestamptz`, replacing the
former boolean, so the badge can be shown only to guardians who booked before the
change, and the "when does it clear" question disappears. Set by date, start, end,
facility, changing room and notes; not set by capacity-only or coach-roster-only
changes.

**Impact if changed.** Column type, and which guardians see a badge.

### D-13 — Are session notes guardian-visible?
**Question.** Undefined in all source documents.

**Provisional.** Coach-internal. Guardians do not see `notes`.

**Impact if changed.** If parents should see them, this needs a second column — one
field must not be dual-purpose, or a coach's private remark eventually reaches a
parent.

---

## Needs a decision before Phase 3 (coach session management)

### D-07 — Coach additions to a cancelled session
**Question.** `PRD §11` says a coach may remove an athlete at any time, but says
nothing about adding one to a cancelled session.

**Provisional.** Rejected when the session is CANCELLED; allowed for DRAFT, OPEN,
CLOSED and COMPLETED, the last for late roster correction.

**Impact if changed.** Coach RPC precondition.

### D-08 — Narrowing eligibility with existing bookings
**Question.** A coach changes a session from 2017–2018 to 2018 only, and a 2017
athlete already holds a confirmed booking. `BR-052` covers the capacity case but
not this one.

**Provisional.** Existing bookings are preserved. The coach sees a warning and must
confirm, exactly as for a capacity reduction. Nothing is auto-cancelled.

**Impact if changed.** `update_training_session` signature gains or loses a
confirmation flag, and booked athletes may or may not lose their place.

### D-12 — Is the changing room guardian-visible?
**Question.** `UI_SPEC` shows `Šatna 4` on the coach card only; the guardian card
shows `Příbram · MH`. Parents plausibly need it on the day.

**Provisional.** Visible to a guardian who holds a confirmed booking on that
session, and not otherwise.

**Impact if changed.** A guardian-facing field, and one helper predicate.

---

## Needs a decision before Phase 5 (booking engine)

### D-02 — The cancellation boundary
**Question.** `BR-040` says "at least 12 hours away"; `AC-040` says "more than 12
hours". At exactly 12:00:00 these disagree.

**Provisional.** `start_at - now() >= interval` — cancellation is permitted at
exactly the deadline, matching `BR-040`.

**Impact if changed.** One comparison operator, and one acceptance criterion. Low
stakes, but the two source documents cannot both stand.

### D-09 — Deactivating an athlete
**Question.** `athletes.is_active` exists with no stated behaviour.

**Provisional.** Blocks new bookings; existing confirmed bookings are untouched;
no cascade.

**Impact if changed.** Eligibility predicate, and whether a deactivation silently
removes a child from sessions their guardian expects them to attend.

---

## Deferred by the approver

### D-18 — Account deletion and anonymisation
Explicitly deferred: "Define an explicit account deletion/anonymisation strategy
separately."

Recorded here because it is a launch blocker, not a nice-to-have: the subjects are
minors in the EU, and the approved deletion policy means an erasure request cannot
be satisfied by `DELETE`. The proposed direction is anonymisation — blank the
names, drop the photo, retain booking and session rows keyed by id — performed by
an administrative operation and recorded in the audit log. Who is controller (the
coach) and who is processor (the platform) also needs settling before launch.

Due before Phase 9.

---

## Resolved by the approved decisions, recorded for traceability

| # | Question | Resolution |
|---|---|---|
| D-03 | Is the 12-hour deadline a constant? | `workspaces.cancellation_deadline_hours`, default 12. Carried by the approval of S-17 alongside the workspace timezone. |
| D-10 | Who creates the workspace athlete membership? | The transactional athlete creation operation, which the approver specified as covering athlete, guardian access, sport profile and membership. Privacy consequence: creating a hockey profile makes the child visible to that workspace's coaches. That is what makes booking possible, and the UI should say so. |
| D-14 | `created_by_role` when a coach books their own child | Fixed by the entry point, never inferred. The guardian function always records USER; the coach function always records COACH. |
| D-19 | Signed URL lifetime for athlete photos | 60 minutes, issued server-side. The client never receives a public or long-lived URL. |
| D-20 | Next.js router | App Router, Server Components, Server Actions calling the domain functions. |
