# Business Rules

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

## Booking

BR-030  
A normal user may book while the session is OPEN, the session has not started, the athlete is eligible, and capacity remains.

BR-031  
The same athlete cannot have more than one active booking for the same session.

BR-032  
Two concurrent normal booking requests must never cause capacity to be exceeded.

BR-033  
A coach may manually book an athlete even when the session is at or over capacity.

BR-034  
Coach override must be explicit and auditable.

BR-035  
When a user has several eligible athletes, they may book more than one athlete into the same session.

BR-036  
Booking stores who created it.

## Cancellation

BR-040  
A guardian may cancel a booking only when session start is at least 12 hours away.

BR-041  
Inside the 12-hour window the UI must show that self-cancellation is unavailable and the coach must be contacted.

BR-042  
A coach may cancel/remove a booking at any time.

BR-043  
Cancelled bookings must not count toward occupancy.

BR-044  
Bookings must not be hard-deleted.

## Capacity

BR-050  
Confirmed booking count is derived from booking rows; it is not stored as a manually maintained counter.

BR-051  
Coach may reduce capacity below confirmed booking count after explicit warning.

BR-052  
Existing confirmed bookings remain valid when capacity is reduced below occupancy.

BR-053  
When occupancy is equal to or above capacity, normal user booking is blocked.

BR-054  
Coach may still manually add athletes beyond capacity.

## Session updates

BR-060  
Coach may edit a future published session.

BR-061  
Date, time, or facility changes require email notification to affected active guardians.

BR-062  
Changed future session displays an in-app `Updated` marker.

BR-063  
Changing-room-only update does not require email in MVP.

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
