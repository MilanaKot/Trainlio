# Acceptance Criteria

Trainlio — Sports Training Booking Platform

## Authentication
AC-001  
Given a valid email  
When the user requests login  
Then an OTP is sent.

AC-002  
Given a valid OTP  
When the user confirms it  
Then the user is authenticated without a password.

## Athlete profiles
AC-010  
A guardian can create more than one athlete.

AC-011  
Athlete date of birth is stored as a full DATE.

AC-012  
An athlete can have more than one sport profile.

AC-013  
Hockey position can only use configured allowed values.

AC-014  
Hockey stick side supports LEFT, RIGHT, UNKNOWN.

AC-015  
A coach can view but cannot edit the athlete's core profile.

## Booking
AC-020  
Given a session capacity of 10 and 9 confirmed bookings  
When an eligible guardian books one athlete  
Then booking succeeds and occupancy becomes 10/10.

AC-021  
Given a session capacity of 10 and 10 confirmed bookings  
When a guardian attempts booking  
Then the request is rejected.

AC-022  
Given two concurrent requests for the final place  
Then at most one normal booking succeeds  
And the test exercises genuinely parallel database connections, not sequential calls.

AC-022a  
Given concurrent bookings for two different sessions  
Then neither request blocks the other.

AC-023  
The same athlete cannot have two active bookings for the same session.

AC-024  
A guardian with two eligible children can book both into the same session in one action, when at least two places remain.

AC-024a **(D-05)**  
Given capacity 10 and 9 confirmed bookings  
When a guardian selects two children and confirms  
Then neither child is booked  
And the result is `INSUFFICIENT_CAPACITY` reporting 1 available place  
And the confirmed count remains 9.

AC-024b **(D-05)**  
Given the rejection in AC-024a  
When the guardian reduces the selection to one child and retries  
Then that child is booked and occupancy becomes 10/10.

AC-024c **(D-05)**  
Given a guardian selects two children and one of them is ineligible  
Then neither child is booked  
And the result names which child is ineligible and why.

AC-024d **(D-05)**  
Coach manual additions are single-athlete operations and are unaffected by the atomicity rule.

AC-025  
Booking stores the authenticated user who created it.

AC-026  
A guardian attempting to insert or update a row in `bookings` directly through the API is rejected by row level security.

AC-027  
A coach attempting to update a row in `training_sessions` directly through the API is rejected by row level security.

AC-028  
No client role can delete a row from `bookings` or `training_sessions`.

## Eligibility
AC-030  
Given session eligibility 2017–2018  
And athlete DOB 2017-10-23  
Then the athlete is eligible.

AC-031  
Given athlete has no active sport profile matching the session sport  
Then the athlete cannot be booked.

AC-032  
Given eligibility mode ALL  
Then birth year does not restrict booking.

## Cancellation
AC-040  
Given session starts more than 12 hours in the future  
Then guardian can cancel.

AC-041  
Given session starts in less than 12 hours  
Then guardian cannot cancel.

AC-042  
Coach can cancel athlete booking at any time.

AC-042a **(D-06)**  
Given a coach has removed an athlete from a session  
When the guardian attempts to book that athlete into the same session  
Then the request is rejected with `REMOVED_BY_COACH`.

AC-042b **(D-06)**  
Given the situation in AC-042a  
When the coach manually adds the athlete again  
Then the booking succeeds.

AC-042c **(D-06)**  
Given a guardian cancelled their own booking  
And the session is still OPEN, has not started, and has capacity  
Then the guardian may book that athlete again.

AC-043  
Cancelled booking does not count toward occupancy.

## Capacity override
AC-050  
Given session is 10/10  
When coach manually adds athlete and confirms override  
Then booking succeeds and occupancy displays 11/10.

AC-051  
Given session is 8/10  
When coach changes capacity to 6  
Then warning is shown.

AC-052  
When coach confirms the 8/6 change  
Then all eight bookings remain confirmed.

## Session updates
AC-060  
When coach changes session time  
Then session shows Updated marker to booked guardians.

AC-061  
When coach changes session time  
Then email notification event is created for affected guardians.

AC-062  
Changing only changing room does not require email.

## Session cancellation
AC-070  
When coach cancels a session  
Then session status becomes CANCELLED and it remains in My Bookings.

AC-070a  
When a coach cancels a session  
Then existing bookings are not modified  
And the roster of who was booked at the moment of cancellation is preserved.

AC-071  
All active guardians linked to booked athletes are recipients.

AC-072  
A guardian linked to two booked athletes receives one cancellation email.

AC-073  
Cancellation email may list both affected athletes.

## Recurring sessions
AC-080  
Creating a six-week weekly series generates six independent training_session rows.

AC-080a **(timezone)**  
Given a weekly series on Sundays 09:00–10:00 from 4 October to 29 November 2026 in a workspace with timezone `Europe/Prague`  
When the series is created  
Then nine sessions are generated  
And every session starts at 09:00 local time  
Even though Czech daylight saving time ends on 25 October 2026, which is itself an occurrence date.

AC-080b  
Given a series creation that fails partway  
Then no session rows and no series row persist.

AC-080c  
A series records the timezone and pattern under which it was generated, and each generated session references its series.

AC-081  
Cancelling one generated occurrence does not cancel other occurrences.

AC-082  
Editing one occurrence does not change others.

## Privacy
AC-090  
Guardian sees occupancy but not names of other booked athletes.

AC-090a  
Given a guardian is subscribed to a session  
When another family books an athlete into it  
Then the displayed occupancy increases  
And no information identifying the other athlete or booker reaches the client.

AC-090b  
A guardian querying the occupancy projection directly receives a count only.

AC-090c **(D-01)**  
An authenticated user with no athlete in a workspace sees no sessions of that workspace.

AC-090d **(D-01)**  
A guardian never sees a DRAFT session.

AC-091  
Guardian cannot query another family's athlete profile through API/RLS.

AC-092  
Athlete photo cannot be accessed publicly without authorization.

## Multi-sport
AC-100  
One athlete can have HOCKEY and SWIMMING sport profiles simultaneously.

AC-101  
Editing hockey-specific attributes does not modify swimming profile data.

AC-102  
Core athlete data is shared across sport profiles.

## Workspace readiness
AC-110  
One athlete may be active in multiple workspaces.

AC-111  
Workspace membership is not derived from club_name.

## Session lists
AC-120 **(D-04)**  
`Nadcházející` contains sessions whose `end_at` is in the future.

AC-121 **(D-04)**  
`Minulé` contains sessions whose `end_at` is in the past.

AC-122 **(D-04)**  
Cancelled future sessions remain visible in `Nadcházející`.

AC-123 **(D-04)**  
No scheduled job is required for AC-120 to AC-122 to hold.

## Database invariants
AC-130  
A training session cannot reference a facility that belongs to a different location.

AC-131  
A training session cannot reference a location that belongs to a different workspace.

AC-132  
A workspace athlete membership cannot reference a sport profile belonging to a different athlete.

AC-133  
A workspace athlete membership cannot reference a sport profile whose sport differs from the workspace's primary sport.

AC-134  
A booking whose status is CONFIRMED cannot carry cancellation columns, and a cancelled booking cannot omit them.

AC-135  
Deleting an athlete or a session that has bookings is rejected by the database.

## Audit
AC-140  
Every action listed in BR-130 produces exactly one audit entry.

AC-141  
An attempt to update or delete an audit entry is rejected, including for the service role.

AC-142  
A coach capacity override produces an audit entry recording the override.

## Notifications
AC-150  
Notification delivery rows are not readable by any authenticated client role.

AC-151  
Re-running event expansion does not create duplicate delivery rows.

AC-152  
The database contains no provider-specific notification columns.
