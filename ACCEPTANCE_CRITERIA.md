# Acceptance Criteria

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
Then at most one normal booking succeeds.

AC-023  
The same athlete cannot have two active bookings for the same session.

AC-024  
A guardian with two eligible children can book both into the same session.

AC-025  
Booking stores the authenticated user who created it.

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

AC-071  
All active guardians linked to booked athletes are recipients.

AC-072  
A guardian linked to two booked athletes receives one cancellation email.

AC-073  
Cancellation email may list both affected athletes.

## Recurring sessions
AC-080  
Creating a six-week weekly series generates six independent training_session rows.

AC-081  
Cancelling one generated occurrence does not cancel other occurrences.

AC-082  
Editing one occurrence does not change others.

## Privacy
AC-090  
Guardian sees occupancy but not names of other booked athletes.

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
