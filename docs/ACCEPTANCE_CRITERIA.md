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

AC-040 **(D-02)**  
Given the session starts more than the workspace cancellation deadline away  
Then the guardian can cancel.

AC-040a **(D-02)**  
Given the session starts in exactly 12 hours and 1 second  
Then the guardian can cancel.

AC-040b **(D-02)**  
Given the session starts in exactly 12 hours  
Then the guardian can cancel.

AC-040c **(D-02)**  
Given the session starts in 11 hours, 59 minutes and 59 seconds  
Then the guardian cannot cancel.

AC-040d **(D-02)**  
The boundary is evaluated on server/database time, never on client device time.

AC-041  
Given the session starts inside the cancellation deadline  
Then the guardian cannot cancel.

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

## Session terminality (D-07)

AC-160  
Given a CANCELLED session  
When anyone attempts to set its status back to OPEN  
Then the change is rejected.

AC-161  
Given a CANCELLED session  
When a guardian attempts to book  
Then the request is rejected.

AC-162  
Given a CANCELLED session  
When a coach attempts to add an athlete manually  
Then the request is rejected.

AC-163  
Given a CANCELLED session  
Then its existing bookings are unchanged and remain as historical evidence.

AC-164  
Given a session cancelled by mistake  
Then the coach creates a replacement with Duplicate Session rather than reopening.

## Eligibility narrowing (D-08)

AC-170  
Given a session with eligibility 2016–2018 and a confirmed athlete born in 2016  
When the coach narrows eligibility to 2017–2018  
Then a warning identifies that one confirmed booking would fall outside the new range.

AC-171  
When the coach confirms the narrowing  
Then the change is applied  
And no existing booking is cancelled.

AC-172  
After the narrowing  
Then a new booking attempt for the 2016 athlete is rejected as out of range.

AC-173  
After the narrowing  
Then only the affected bookings are marked as changed, not every booking on the session.

AC-174  
After the narrowing  
Then only the active guardians of the affected athletes are emailed.

AC-175  
After the narrowing  
Then a significant-change audit entry exists.

## Athlete deactivation (D-09)

AC-180  
Given an inactive athlete with a confirmed future booking  
Then the booking is preserved and remains visible in My Bookings and on the coach roster.

AC-181  
Given an inactive athlete  
Then a new booking attempt is rejected as inactive.

AC-182  
Given an inactive athlete with a confirmed booking  
Then the guardian may still cancel it when the normal cancellation rule allows.

AC-183  
Given an inactive athlete  
Then their sport profiles and workspace memberships are not deleted.

AC-184  
When the athlete is reactivated  
Then they are eligible for future bookings again.

## Significant changes (D-11)

AC-190  
Changing date, start time, end time, location, facility or main coach sets `significant_changed_at` and queues guardian email.

AC-191  
Changing the changing room, capacity, assistant coaches, public notes or internal notes does not set `significant_changed_at` and queues no email.

AC-192  
Given a guardian booked after a significant change  
Then that booking does not show the `Změněno` marker.

AC-193  
Given a guardian booked before a significant change  
Then that booking shows the `Změněno` marker.

AC-194  
When the main coach changes  
Then guardians of confirmed athletes are emailed, `significant_changed_at` is set, and an audit entry is created.

## Session notes and changing room (D-12, D-13)

AC-200  
A guardian can read `public_notes`.

AC-201  
A guardian querying internal notes receives no rows.

AC-202  
A coach can read internal notes for sessions in their workspace.

AC-203  
A guardian can read the changing room, displayed as `Příbram · MH · Šatna 4`.

AC-204  
A changing-room-only update appears immediately in the app without an email.

## Roles (D-17)

AC-210  
A WORKSPACE_ADMIN may run coach domain operations in their own workspace.

AC-211  
A WORKSPACE_ADMIN is not a platform admin and cannot read `platform_admins`.

AC-212  
A PLATFORM_ADMIN gains no workspace coach rights and no athlete data through row level security.

AC-213  
A guardian is never a workspace member; their authorization comes from athlete access and workspace athlete membership.

AC-214  
A user may hold both COACH and WORKSPACE_ADMIN in the same workspace.

## Account data separability (D-18)

AC-220  
Deleting an authentication record severs the login link but preserves the actor's bookings and their attribution.

AC-221  
Deleting an authentication record preserves guardian access links.

AC-222  
No operational table stores an email address except the notification delivery audit, which is service-role only and scrubbable.

AC-223  
Audit entries remain attributable after an authentication record is removed.

## Account anonymisation workflow (D-18)

These were added with the workflow itself, in Phase 9. AC-220 to AC-223 above
remain the architectural constraint they are built on.

AC-224  
Anonymisation is service-role only. No guardian, coach or workspace admin can run it, or read the dormancy list, through the API.

AC-225  
Given a profile  
When an operator previews its anonymisation  
Then they are told how much history stays attributed, and which athletes would be left with no active guardian.

AC-226  
An anonymisation clears the display name, stamps `anonymized_at`, deletes the authentication record, scrubs that recipient's addresses from the delivery audit, and revokes their active guardian access.

AC-227  
An anonymisation deletes no booking, session, audit entry or delivery row, and rewrites no actor reference. The trainings and rosters the person took part in remain.

AC-228  
An athlete is only anonymised on explicit request, and only when the profile being erased was their last active guardian. Their name is cleared, they are deactivated, and the photograph reference is removed.

AC-229  
An anonymisation appends one audit entry per workspace the person was active in, recording who they were and the state of their history at the time.

AC-230  
Recipient addresses in the delivery audit are cleared once they are older than the workspace's retention setting, for settled deliveries only. The delivery record itself is kept.

AC-231  
Dormancy is a list for review, never an automatic erasure: listing a profile changes nothing about it.

## Operational repair

AC-232  
Occupancy drift has a supported repair that recomputes from the bookings, reports what it changed, and appends an audit entry. It is service-role only, and it does not create a missing projection row.

## Coaching staff (D-11, DESIGN_BRIEF §34)

The coach is the product: a guardian must be able to see who leads a session.
Until these, the schema could not deliver that — the only name column was
writable by its owner alone, so a coach who never opened Účet was permanently
"—" to every parent, and no administrator could correct it.

AC-240  
Given a workspace administrator  
When they set a staff member's given name and surname  
Then guardians see that name as the session's main coach, and the roster the screen reads comes back with each member's roles and whether they have ever signed in.

AC-241  
A coach who is not an administrator sees the same staff list and can change none of it. A guardian reaches neither the screen nor the list.

AC-242  
An administrator can name the staff of the workspace they administer and nobody else — not a guardian, and not another workspace's staff. A member who has left may still be corrected, because they are still on last season's rosters.

AC-243  
A staff name requires both halves. A blank given name or surname is refused, and a refused call writes nothing.

AC-244  
`display_name` is composed by the database from the two name columns. No client role may write it, and a one-word name composes to itself without a trailing space.

AC-245  
Naming a member appends one audit entry per successful call, recording who changed it, which profile, and from what to what.

AC-246  
A person may set their own given name and surname, which is trimmed before it is composed and needs no audit entry. A surname with no given name is refused.

AC-247  
Anonymisation clears both name columns wherever the stamp comes from, and an erased profile cannot be given a name again.

AC-248  
Given a coach who has never signed in  
When an administrator adds them by name  
Then a profile with no login is created, is active staff from that moment, can lead a session, and is read by guardians like any other coach. The addition is audited.

AC-249  
A coach who leaves is deactivated, never deleted: the profile and its history are kept, the deactivation is audited, it can be reversed, and repeating it changes nothing and records nothing. Inactive members stay on the staff list, or nobody could bring them back.

AC-250  
A workspace always keeps at least one active administrator. The last one cannot deactivate themselves until another exists.

AC-251  
Deactivating a coach who still leads future trainings is refused until it is confirmed, and the refusal carries the number of trainings so the warning quotes the server rather than a count the client worked out.

## The guardian's telephone number (DESIGN_BRIEF decision 18)

The first personal contact detail the schema stores. The email never was one —
it lives in `auth.users` and is read server-side only — so these criteria are
mostly about the half that is not "a coach can ring the family".

AC-252  
A guardian may record an optional telephone number on their own profile, in the national form they would write it down or with a country code. A number starting with `+` is held to E.164; anything else is plain national digits of a plausible length. Separators are stripped, and clearing the field leaves null rather than an empty string.

AC-253  
No policy exposes the number. A coach cannot read a guardian's profile row at all, another family cannot either, the roster does not carry it, and `anon` holds no read on the column.

AC-254  
A coach or administrator of the workspace running a session can read the number of the guardians of an athlete booked into it, one booking at a time. A guardian reading their own booking gets nothing from it, another family gets nothing, a stranger gets nothing, and a coach who has left the workspace gets nothing. Every active guardian of the athlete is returned, not whichever one comes first; a revoked guardian is not.

AC-255  
Stamping a profile anonymised clears the telephone number with the name, whatever path set the stamp, and the coach can no longer reach them.

AC-256  
The number is never copied: no audit entry and no notification delivery record contains one, and the column exists in exactly one table.

AC-257  
Deactivating a coach does not take their name off the trainings they lead. A guardian still reads it, a correction to it still reaches them, and this holds for a coach who never had a login. The widening is the narrow one: a former coach who was never named on a training stays invisible, no membership row becomes readable, and no other family does either.

## "Změněno" until the parent has looked (guardian/SPEC.md §G4)

AC-258  
The badge shows when a training moved after this booking was made and this guardian has not opened it since. Opening the booking silences it; opening it again writes nothing; a later change brings it back. A booking whose training never moved records nothing at all.

AC-259  
Only this family may mark their own booking seen, and only through the domain function: another family is refused, so is the coach, an unknown booking says so, and no client role holds an `UPDATE` on any column of `bookings`.

## A coach removes one athlete (guardian/SPEC.md §G4b, §G6d)

AC-260  
Given a coach removes an athlete from a training that still takes place  
Then the place is released at once, that athlete's guardians — and only they — receive an e-mail naming the athlete and carrying the coach's message if one was written, the guardian can read that message on their own booking and another family can read neither, a message longer than the form allows is refused and removes nobody, and the athlete's siblings keep their places. D-06 is unchanged: the guardian still cannot re-book (AC-042a).

## Assistant coaches (coach/SPEC.md §K3b, §K3c, guardian/SPEC.md §G6)

AC-261  
A coach sets the assistants of a session as a whole list: a different list replaces the previous one, an empty list clears it, a repeated id counts once and a null is dropped. The main coach cannot also assist, someone who is not active staff of the workspace cannot, and a guardian can neither be one nor set them.

AC-262  
A coach who is currently an assistant can be made main coach of the same session, and stops being an assistant by doing so. A guardian reads the main coach and the assistants of a published session in that order; someone with no relationship to the club reads nobody. Changing the assistants notifies no guardian and appends one audit entry when something moved, none when nothing did.

## A series over several weekdays (coach/SPEC.md §K4b, §K11)

AC-263  
Given a coach chooses more than one weekday  
Then the series creates one training per matching date, interleaved in date order, and the stored pattern is canonical: sorted, de-duplicated, at most seven days. An empty set, a set containing a value outside 1..7, and a set containing a null are refused whole rather than silently narrowed. The dates the coach unchecked are subtracted before anything is created; an exclusion naming a date the pattern never produced changes nothing and is not recorded; unchecking every date is refused rather than creating an empty series. The series records the exclusions that actually suppressed a date, `generated_count` counts what was created rather than what the pattern produced, and the audit entry carries both the weekday set and the suppressed dates. The pattern and the exclusions survive the round trip over PostgREST as JSON arrays.

AC-264  
A series holds at most 52 trainings. A range producing 53 is refused with `SERIES_TOO_LONG` and creates nothing; unchecking one date brings the same range inside the limit and it is created. Seven weekdays over three months are refused the same way, and a range longer than a year is refused before it is expanded. The ceiling is the server's: the client's copy of it only labels the preview.

AC-265  
The client sends the pattern and the dates to skip, never the dates to create. A submitted exclusion can only remove an occurrence the pattern already produced, so a stale or edited client can decline a training but never conjure one.

## The training list and its booking sheet (guardian/SPEC.md §G1, §G2, §G3)

AC-266  
The list groups trainings by the workspace's own calendar day, ascending, with one heading per day and a `Dnes` chip on today's. The footer of a card is decided by one ordered table: a closed or started training says `Přihlašování uzavřeno` and offers no button; a full one offers a disabled `Obsazeno`; a family with one child booked and another who could be gets a secondary `Přihlásit`; with nobody else to book, a disabled one; and otherwise a primary `Přihlásit`. The reason written beside a disabled button is the reason that applies — a coach's removal is not reported as a birth-year mismatch, and a family with no athletes reads the empty state above the list rather than the same sentence on every card. The names of booked children appear as chips; the count never does anything but count.

AC-267  
The occupancy on a card is live, and one count drives the meter, the `Zbývá {n} míst` hint and the footer together, so they cannot disagree about whether a training is full.

AC-268  
Tapping `Přihlásit` opens the sheet with every athlete of the family listed — the bookable ones first, each other one disabled with its own reason and birth year. A family with exactly one eligible child finds them already selected. Selecting more children than there are places is a state of the sheet, not an error: it explains itself in warning, holds the selection and disables the confirm button, and the same explanation appears when the server refuses. A successful booking closes the sheet, confirms with `Přihlášeno`, and the card behind it updates.

## What changed, not only that something did (guardian/SPEC.md §G4, §G6)

AC-269  
A significant change records what moved and what it used to be, beside the training it describes. It names the local date and the local time separately, the venue, the hall and the main coach, and carries the previous values snapshotted rather than referenced. A change that is not significant records nothing and leaves an earlier record alone; a later significant change replaces the record rather than adding to it. One change that moves several things is one record under one timestamp, including the main coach, whose mirror column moves in a second statement. The record holds nothing a guardian may not read.

AC-270  
Given a coach moves a training a guardian has booked  
Then the card shows `Změněno`, the value that moved is highlighted, and the meta line begins with what it used to be. Opening the booking spells out the field, both values and when it happened, and silences the badge for that booking alone; the training still shows its new time afterwards. The detail screen names the venue, the changing room, the birth years, the main coach, the assistants — the row is there even when there are none — and the occupancy, and carries the coach's own message when the athlete was removed.

## Moje tréninky (guardian/SPEC.md §G4, §G4b, §G5)

AC-271  
One card per booking, not per training, split into `Nadcházející` and `Minulé` by the tab in the URL. A booking's own fate outranks the training's: an athlete the coach removed reads `Odhlášeno trenérem` even if the training was later called off, and a parent's own withdrawal stays theirs. A confirmed upcoming booking offers `Odhlásit` with the deadline beside it, and past the deadline the button is disabled and says to contact the coach. Withdrawing asks first, naming the child and the training, and confirms with `Odhlášeno`. Nothing is deleted: a cancelled or withdrawn booking keeps its place until the training ends.

## The coach's training list (coach/SPEC.md §K1, §K10)

AC-272  
The list is chronological and grouped by the workspace's own calendar day, with a `Dnes` chip on today's heading. A row reads as time, place and count: the hall, the changing room and the birth years on one line, the meter and the figure on the other. At most one status line, and only when there is something to say — a draft, a training the coach filled past its capacity, or closed registration. A cancelled training keeps its place with its time struck through and says `Zrušeno` where the count would be, because there is nothing left to count. The past is a link at the bottom, not a second section.

AC-273  
Creating asks which kind first: one training or a series. A coach with no trainings at all is offered the same thing from the empty state.

## The coach's session detail and roster (coach/SPEC.md §K2, §K5, §K6, §K7)

AC-274  
The detail reads in the order of a coach's attention: when and where, how full, who is running it, what the parents were told, what only the staff know, who is coming, and only then what can be done about it. The internal note panel says whose eyes it is for, so nobody writes a parent's message into it. A roster row names the athlete, their details, and who booked them and when — in the masculine participle for everyone. Opening a row reaches the family: every active guardian of that athlete with their telephone number, which no other role may read, and a call and an SMS link when there is a number. Adding an athlete searches by name, ignoring diacritics, over the list the server decided.

AC-275  
Removing an athlete says what follows before it happens — the place is freed, the parent is e-mailed — and carries the coach's own message if they write one. Closing registration is reversible and its sheet lists what it does, what it does not, and that it can be reopened. Cancelling is terminal and its dialog says so, counts the families who will be e-mailed, and defaults to not doing it. Adding past capacity is asked rather than refused (BR-033), states the total the training will have, and quotes the server's own numbers rather than the client's.

AC-276  
Adding several athletes at once is deliberately not atomic, unlike a guardian's booking (D-05): a coach adding three to a session with two places gets two added and one question asked, and the ones that succeeded stay.

## The club's own mark

AC-277  
A club has an emblem or it has none, and one that has none shows nothing rather than a monogram standing in for it. Only an administrator of that club may set or clear it (D-17); a coach and a parent are refused, and the refusal changes nothing. The stored path names that club's own folder — a path naming another workspace, or no folder at all, is refused — because the storage policy reads the folder as the workspace. Setting the same mark again is not a change and writes no second audit entry; setting or clearing one is, and is recorded. The bucket is public, deliberately and unlike the athlete bucket, because the mark travels in the e-mails a parent receives and a mail client can follow neither a signed URL nor private storage. In the message it is an image whose alternative text is the club's name, and the message reads identically without it.

## The parent says who they are (guardian/SPEC.md §G16)

AC-278  
Given a guardian registering their first athlete, and holding no name of their own  
Then the form asks for it in the words of §G16 — a first name, an optional surname, and an optional telephone number under the sentence that says who reads it and why — before it asks about the child. A second athlete is registered on the same screen without the block. A telephone number that is not a number is refused on its own field, and the athlete is not created. The name reaches the coach's roster as `Přihlásil …` and the number reaches the athlete sheet, which is the reason it is asked at all.

AC-279  
A guardian's own profile is read filtered by their own profile id. Since a guardian can also read the profile of any coach named on a training they can see, an unfiltered read returns several rows, and the failure renders as an empty account form — which would invite a parent to save their own name away.

## The coach's own telephone number (handoff v3, decision 28)

AC-280  
A coach may record a number for the club to pass on, and it is not the column a
parent's number lives in. It is in a table no signed-in client can read — no
grant, no policy — so a parent who may read a coach's name to learn who leads a
training cannot read the staff's numbers along with it. Three doors exist and
nothing else: a coach writes their own, an administrator of that workspace writes
any of the staff's, and the roster function returns a number to an administrator
or to its owner and to nobody else. What is written is held to the same two
shapes as a parent's number, the audit entry records that a number changed
without recording the number, and the D-18 stamp takes it with the name.

AC-281  
Given an athlete the coach removed from a training (D-06)  
Then the parent's card carries no button at all and says that only the coach can
put them back, and the booking screen offers that coach instead of an action:
their name, their number when they gave one, and a `tel:` and an `sms:` link that
really dial. Without a number there are no buttons rather than dead ones, and
without a name the number still stands on its own. The number is readable for
that one booking and only while it is a coach's removal — another family, a
stranger, and any other booking get nothing.

## A photograph from an iPhone (handoff v3, DR-13)

AC-282  
Given a guardian picking a HEIC photograph, the format every iPhone takes by
default  
Then the picker offers it — by type and by extension, because a `.heic` from the
Files app often arrives with no type at all — and the browser converts it to a
JPEG before anything is uploaded, saying `Převádím fotku…` while it does. The
converter is loaded only for a file that needs it. The 5 MB limit applies to the
file the parent picked, so an oversized one is refused before it is decoded
rather than after; a file that cannot be converted says to upload a JPG instead.
What may be stored is unchanged: the server accepts JPEG, PNG and WebP and
refuses HEIC, so nothing undecodable reaches the bucket.

## The e-mails a parent receives (handoff v3, DR-05)

AC-283  
Every message is the one template of `shared/EMAILS.md`: tables and inline
styles with no stylesheet to strip, Arial rather than a web font, a 520 px card,
a button that is a real link and never an image, and a preheader that is the
first sentence. The subject always carries the date. The details are a block,
never a sentence, and a value that changed prints what it replaced struck
through beneath it — so nothing is signalled by colour alone and the message
reads whole with images blocked. One save produces one e-mail: a coach who moves
a training and changes the hall at once sends a single message with both rows
highlighted, under the type the design gives that case, and the previous values
come from the same record the app's own screens draw. What a template cannot
look up, the claim resolves: the coach behind the event, their number for E07,
the workspace's cancellation deadline, and the booking whose screen the button
opens. A guardian with two children in one event still receives one e-mail
naming both, and its subject is unchanged.

AC-284  
Given a coach adding an athlete to a training by hand  
Then that athlete's guardians are e-mailed (E08), told who booked the child and
by when they can undo it, and nobody else on the training hears anything. It is
sent for an over-capacity addition too. A guardian booking their own child raises
no such event: the app said so already.

## The coach's past trainings (handoff v3, DR-02)

AC-285  
The coach's list carries the same `Nadcházející / Minulé` switch a parent has on
their own, with the tab in the URL so the browser's back button lands where it
left. The past is newest first, because what a coach looks back at is the
training that has just finished. A finished row reports how many were booked,
in the Czech the count requires, and nothing else: no meter, because free places
no longer exist, and no other figure, because the MVP tracks no attendance and a
number there would read as who came. A cancelled training keeps its badge in
both tabs. Nothing is created from the past, so the button that creates is not
on that tab.

## The coach's athletes (handoff v3, DR-01)

AC-286  
The `Sportovci` tab is the club's athletes, grouped by birth year and sorted by
surname inside each group, with the deactivated ones in their own group at the
bottom. Each row says what a coach scans for: the position, and how many
trainings that athlete still has — a figure that counts only what is ahead,
never a cancelled training or a booking that has been and gone. The search
ignores diacritics and matches the guardians' names as well as the athlete's,
because a coach who met the family at the rink remembers the parent. No
telephone number is on a row; opening one athlete returns that one family's,
with every active guardian rather than a single "parent". Only the staff of a
club the child trains at may read any of it: a parent reading their own child's
row through the same function gets nothing.

AC-287  
Given a coach writing a note about an athlete  
Then it is readable by the staff of that workspace and by nobody else — a
separate table with a staff-only policy and no write grant at all, so the
guardian of that very child reads no rows rather than a null column, and cannot
write one either (D-13). The 200-character limit is the server's as well as the
form's, clearing it leaves no empty row behind, and the note goes when the child
is forgotten (D-18).

## The series a coach created (handoff v3, DR-03)

AC-288  
Series live under `Více › Série tréninků`, which every coach has — planning is
not an administrator's privilege. The list splits them by whether anything is
still to come rather than by the pattern's end date, since a series whose last
trainings were cancelled is over whatever its range says, and each card carries
the weekdays, the time, the place and how many of its trainings are left.
Opening one shows the trainings it produced, split into upcoming and past with
the counts in the tabs, and a training that has been edited since it was created
says so — it no longer matches the pattern. There is no action anywhere that
edits or cancels a series as a whole, and the screen says why: the occurrences
are independent from the moment they are made.
