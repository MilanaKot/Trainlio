# Business Rules

Trainlio — Sports Training Booking Platform

Rules marked **(amended)** were changed by the approved architecture review.
Rules marked **(new)** were added by it.

## Accounts and athletes

BR-001  
One user account may have access to multiple athletes.

BR-002  
One athlete may be linked to multiple users/guardians.

BR-003  
One athlete may have multiple sport profiles.

BR-004  
An athlete core record must remain sport-independent.

BR-005  
A user may edit an athlete profile only when they have active guardian access.

BR-006  
A coach may view athlete data relevant to their workspace but cannot edit the athlete's core profile.

## Sport profiles

BR-010  
Sport-specific data belongs to `athlete_sport_profiles`.

BR-011  
For hockey, position must be chosen from the configured enum list.

BR-012  
For hockey, stick side must be LEFT, RIGHT, or UNKNOWN.

## Sessions

BR-020  
New sessions default to capacity 10 unless the coach sets another value.

BR-021  
A session may be restricted by birth-year range or open to all athletes.

BR-022  
A session may have one main coach and zero or more assistant coaches.

BR-023  
Changing room may be null.

BR-024  
A coach may close booking manually regardless of remaining capacity.

BR-025  
Session statuses are DRAFT, OPEN, CLOSED, COMPLETED, CANCELLED.

BR-025c **(new — D-07)**  
`CANCELLED` is a terminal session status. Once a session is cancelled it accepts no new guardian booking, no coach manual booking, and cannot be reopened.

Reason: cancellation notifications may already have been sent, and reopening the same record would create ambiguous communication and history. A coach who cancelled by mistake uses Duplicate Session. The cancelled session is preserved as historical evidence.

BR-025a **(new — D-04)**  
`Upcoming` and `Past` are derived from `end_at` relative to the current time, not from the `COMPLETED` status. No scheduled job is required for the user interface to be correct.

BR-025b **(new — D-04)**  
`COMPLETED` remains a valid explicit status for future use. No MVP behaviour depends on anything setting it.

## Booking

BR-030  
A normal user may book while the session is OPEN, the session has not started, the athlete is eligible, and capacity remains.

BR-031  
The same athlete cannot have more than one active booking for the same session.

BR-031a **(new — D-06)**  
When a coach has removed an athlete from a session (`CANCELLED_BY_COACH`), a guardian may not re-book that athlete into the same session. Only a coach may restore the athlete.

BR-031b **(new — D-06)**  
After a guardian cancellation (`CANCELLED_BY_USER`), the athlete may be re-booked while the session is OPEN, has not started, has capacity, and the athlete remains eligible.

BR-031c **(new — D-06)**  
These rules are enforced server-side on the most recent booking record for the athlete and session, not inferred from the partial unique index alone.

BR-032  
Two concurrent normal booking requests must never cause capacity to be exceeded.

BR-033  
A coach may manually book an athlete even when the session is at or over capacity.

BR-034  
Coach override must be explicit and auditable.

BR-035 **(amended — D-05)**  
When a user has several eligible athletes, they may book more than one athlete into the same session in a single action.

BR-035a **(new — D-05)**  
Multi-athlete guardian booking is atomic. Either every selected athlete is booked, or none is.

BR-035b **(new — D-05)**  
If the number of selected athletes exceeds the remaining places at the moment the transaction runs, the request is rejected in full and reports the number of available places. The guardian reduces the selection and retries.

Rationale: one confirmation should never split siblings into booked and not-booked states.

BR-035c **(new — D-05)**  
Coach manual additions remain independent single-athlete operations and may use capacity override.

BR-036  
Booking stores who created it.

## Cancellation

BR-040 **(amended — D-02)**  
A guardian may cancel a booking when:

`current_time <= start_at - cancellation_deadline`

and is blocked when:

`current_time > start_at - cancellation_deadline`

At exactly the deadline, cancellation is still allowed. Examples at a 12-hour deadline: 12:00:01 before start is allowed, 12:00:00 before start is allowed, 11:59:59 before start is blocked.

The deadline is a workspace setting; its MVP value is 12 hours. It is always computed from server/database time, never client device time. A client-supplied indication that cancellation is allowed is never accepted.

BR-041  
Inside the 12-hour window the UI must show that self-cancellation is unavailable and the coach must be contacted.

BR-042  
A coach may cancel/remove a booking at any time.

BR-043  
Cancelled bookings must not count toward occupancy.

BR-044  
Bookings must not be hard-deleted.

## Capacity

BR-050 **(amended — occupancy projection)**  
Confirmed booking count is derived from booking rows. It must not be maintained by application code.

A database-maintained projection of the count is permitted and is the required mechanism: `bookings` remains the sole source of truth, the projection is written only by database logic, and no application code or domain function ever writes it.

BR-050a **(new)**  
The occupancy projection exposes a count only. It must not expose athlete identities, booking identities, or per-booking timestamps.

BR-050b **(new)**  
Guardian realtime subscriptions use the occupancy projection. Booking rows are never published to guardian realtime channels.

BR-051  
Coach may reduce capacity below confirmed booking count after explicit warning.

BR-052  
Existing confirmed bookings remain valid when capacity is reduced below occupancy.

BR-053  
When occupancy is equal to or above capacity, normal user booking is blocked.

BR-053a **(new — D-08)**  
A coach may narrow the birth-year eligibility of a session that already has confirmed bookings, after an explicit warning that identifies how many confirmed bookings would fall outside the new range.

BR-053b **(new — D-08)**  
Narrowing eligibility never auto-cancels a booking. Existing confirmed bookings remain valid. New booking attempts use the new rule.

BR-053c **(new — D-08)**  
When existing confirmed athletes fall outside the new range, the change creates a significant-change audit entry, notifies the active guardians of those athletes by email, and shows `Změněno` on those bookings.

BR-053d **(new — D-08)**  
Guardians of unaffected athletes are not emailed solely because the eligibility rule changed.

BR-054  
Coach may still manually add athletes beyond capacity.

## Session notes

BR-055 **(new — D-13)**  
A session has two separate notes fields. One ambiguous field is not permitted.

BR-056 **(new — D-13)**  
`public_notes` are guardian-visible. Examples: equipment reminders, meeting instructions, special training information.

BR-057 **(new — D-13)**  
`internal_notes` are coach and admin only and must never be exposed to guardians through the API or row level security.

BR-058 **(new — D-13)**  
Both fields are optional.

## Session updates

BR-060  
Coach may edit a future published session.

BR-061  
Date, time, or facility changes require email notification to affected active guardians.

BR-062 **(amended — D-11)**  
A changed future session displays an in-app `Změněno` marker to guardians whose booking predates the change.

The marker is stored as `significant_changed_at`, a timestamp rather than a boolean flag. A booking shows the marker only when:

`significant_changed_at > booking.created_at`

This prevents a guardian who booked after the change from seeing a misleading marker.

BR-062a **(new — D-11)**  
A change is significant when any of these changes:

- session date;
- start time;
- end time;
- location;
- facility;
- main coach.

For the hockey MVP, changing MH ↔ VH therefore qualifies as significant.

BR-062b **(new — D-11)**  
The following are not significant changes by themselves and trigger no email:

- changing room;
- capacity;
- assistant coaches;
- public notes;
- internal notes.

They still update the ordinary `updated_at` timestamp and appear immediately in the app.

BR-062c **(new — D-11)**  
A change of main coach is operationally significant. Trainlio is a system for booking training with a coach, so a main-coach change triggers guardian email, updates `significant_changed_at`, and creates an audit entry. Adding or removing an assistant coach does not require guardian email in MVP.

BR-062d **(new — D-11)**  
The audit log remains the source of truth for exactly what changed. The marker records that something significant changed, not what.

BR-063 **(amended — D-12)**  
Changing room is guardian-visible and is displayed with the venue, for example `Příbram · MH · Šatna 4`. It may be null at creation and added later.

A changing-room-only update appears immediately in the app and updates `updated_at`, but does not set `significant_changed_at` and does not trigger email in MVP.

BR-064  
Capacity-only change does not require email if existing bookings remain valid.

## Session cancellation

BR-070  
Cancelled sessions remain visible in My Bookings.

BR-071  
Cancelled sessions must not be hard-deleted.

BR-072  
All active guardians linked to each booked athlete receive the cancellation notification.

BR-073  
Email recipients must be deduplicated per cancelled session.

BR-074  
If one guardian has two booked children in the cancelled session, that guardian receives one email listing both athletes.

## Recurrence

BR-080  
Series creation generates individual session occurrences.

BR-080a **(new — workspace timezone)**  
Each workspace has an IANA timezone. For the MVP workspace it is `Europe/Prague`.

BR-080b **(new — workspace timezone)**  
Recurring occurrences are generated from local wall-clock dates and times in the workspace timezone, and each occurrence is converted to an absolute timestamp independently. Generating occurrences by adding fixed UTC intervals is prohibited: a series crossing a daylight-saving transition would otherwise shift by an hour.

BR-080c **(new)**  
Series creation is a single transaction. A partially generated series must never be persisted.

BR-080d **(new)**  
A series retains the pattern and the timezone under which it was generated. It is provenance, not a live template: changing a series record never alters already-generated sessions.

BR-081  
Each generated occurrence is independently editable and cancellable.

BR-082  
Duplicate Session creates a new independent session.

## Privacy

BR-090  
Guardians must not see names of other booked athletes.

BR-091  
Guardians see occupancy only, for example 3/10.

BR-092  
Coach may see who created a booking.

BR-093  
Athlete profile photos are private assets.

BR-094 **(new — D-01)**  
A guardian may see a workspace's sessions only while at least one of their athletes holds an active membership of that workspace. DRAFT sessions are never visible to guardians.

BR-095 **(new — D-01)**  
Possession of the application URL is not authorization. An authenticated user with no athlete relationship sees no workspace data.

## Athlete deactivation

BR-140 **(new — D-09)**  
Deactivating an athlete never cancels or deletes an existing booking.

BR-141 **(new — D-09)**  
While an athlete is inactive: all historical data is preserved; existing future confirmed bookings are preserved; the bookings remain visible in My Bookings and on the coach roster; the guardian may still cancel an existing booking when the normal cancellation rule allows; the coach may still remove the athlete from a session.

BR-142 **(new — D-09)**  
An inactive athlete cannot be selected for new bookings and is excluded from active-athlete selectors.

BR-143 **(new — D-09)**  
Reactivation restores eligibility for future bookings, subject to the normal workspace, sport and session rules.

BR-144 **(new — D-09)**  
Deactivation never cascades into deletion of sport profiles or workspace memberships.

## Roles

BR-150 **(new — D-17)**  
Workspace staff roles are `COACH` and `WORKSPACE_ADMIN`. A user may hold both.

BR-151 **(new — D-17)**  
Guardians are not modelled as a workspace staff role. Guardian authorization runs through athlete access and workspace athlete membership.

BR-152 **(new — D-17)**  
Platform administration is a separate, explicitly privileged role. It must never be inferred from workspace membership.

BR-153 **(new — D-17)**  
A technical support person may hold platform administration, or workspace administration where access is intentionally limited to one workspace.

## Account data and history

BR-160 **(new — D-18)**  
The schema must not make future user anonymisation impossible.

BR-161 **(new — D-18)**  
Personally identifiable account data is kept separable from operational history.

BR-162 **(new — D-18)**  
Bookings, audit records and session history must be preservable without retaining unnecessary personal data.

BR-163 **(new — D-18)**  
No domain history may depend on the corresponding authentication record physically existing.

BR-164 **(new — D-18)**  
Actor references are designed so a later anonymisation strategy can preserve audit integrity.

BR-165 **(new — D-18)**  
The exact deletion and anonymisation policy is defined before production launch. It is not implemented in the MVP foundation phases.

## Multi-sport and SaaS readiness

BR-100  
A workspace has a primary sport context.

BR-101  
An athlete may participate in several sports.

BR-102  
An athlete may belong to several workspaces.

BR-103  
Workspace membership and club membership are separate concepts.

BR-104  
Generic database concepts must not be named specifically for hockey when a sport-neutral term exists.

## Enforcement layers

BR-110 **(new)**  
Business invariants are enforced by server-side domain functions. Row level security is defence in depth and does not by itself enforce capacity, deadlines, eligibility, notification or audit behaviour.

BR-111 **(new)**  
Guardians hold no direct insert or update permission on bookings. Coaches hold no direct update permission on sessions. These operations exist only as transactional domain functions, so notification and audit behaviour cannot be bypassed.

BR-112 **(new)**  
Relationships that define tenancy are enforced at database level: a facility belongs to its stated location, a location belongs to its stated workspace, a sport profile belongs to its stated athlete, and a sport profile's sport matches the workspace or session sport where required. Multi-tenant isolation does not depend on application code alone.

## History and deletion

BR-120 **(new)**  
Operational history must not disappear through cascading deletes. Tables carrying history use restrictive delete behaviour.

BR-121 **(new)**  
Domain entities that have historical records are deactivated, not deleted.

BR-122 **(new)**  
Cancelled sessions and cancelled bookings are historical records and are retained.

BR-123 **(new)**  
Cancelling a session does not alter its bookings. The roster of who was booked at the moment of cancellation is preserved, and the session status carries the cancellation.

BR-124 **(new)**  
Account deletion and anonymisation are a separate strategy, to be defined before production launch. They are not satisfied by row deletion.

## Audit

BR-130 **(new)**  
Important domain actions are recorded in an append-only audit log: session created, edited, capacity changed, booking closed or reopened, session cancelled, series created, session duplicated, guardian booking created, coach booking created, capacity overridden, guardian cancellation, coach cancellation or removal.

BR-131 **(new)**  
Each audit entry records the acting user where available, the workspace, the entity type and id, the action, the timestamp, and relevant before/after or structured metadata.

BR-132 **(new)**  
The notification outbox is not an audit log and does not substitute for one.
