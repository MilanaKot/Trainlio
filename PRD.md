# Product Requirements Document

## 1. Product summary

A mobile-first booking application for sports training sessions.

The MVP serves one hockey coach in Příbram. Parents/guardians create an account, manage one or more athlete profiles, and book eligible athletes into available training sessions. Coaches manage sessions, rosters, capacity, schedule changes, and cancellations.

The system must be architected for later expansion into a commercial multi-sport, multi-workspace platform.

## 2. Product goals

### MVP goals
- Make booking a training session fast and obvious.
- Give coaches a reliable real-time roster and capacity view.
- Support multiple children under one guardian account.
- Allow one athlete to participate in multiple sports.
- Preserve privacy between families.
- Prevent accidental overbooking by normal users.
- Allow intentional coach override.
- Support recurring session creation.
- Support future multiple coaches and assistant coaches.
- Provide an architecture suitable for later SaaS commercialization.

### Non-goals for MVP
- Payments
- Waiting list
- Attendance / no-show tracking
- Athlete performance history
- Chat
- SMS
- WhatsApp
- Push notifications
- Add-to-calendar
- Calendar UI
- Advanced athlete search/filtering
- Packages/subscriptions
- Analytics

## 3. User roles

### USER / Guardian
A registered user who manages one or more athletes and can book/cancel for athletes they are authorized to access.

### COACH
Can create and manage training sessions, view athlete profiles, manually add/remove athletes from sessions, change capacity, close booking, and cancel sessions.

### ADMIN
Technical/business administrator. Can manage system data and configuration. ADMIN is separate from COACH; one account may have both roles.

## 4. Core domain model

### User
Authenticated account.

### Athlete
Sport-independent child/athlete identity.
Core athlete data must not contain sport-specific attributes.

### Guardian access
Many-to-many relationship between users and athletes.

### Sport
Examples:
- HOCKEY
- FOOTBALL
- SWIMMING
- TENNIS

### Athlete sport profile
One athlete may have multiple sport profiles.
Examples:
- Hockey profile
- Swimming profile

### Workspace
Logical tenant/business context.
Current MVP: one hockey coach/workspace in Příbram.
Future: each independent coach, academy, club, or organization may have its own workspace.

### Workspace athlete membership
Links an athlete and relevant sport profile to a workspace.

### Location
Physical training venue or complex.

### Facility
Bookable/training sub-location inside a location.

Current hockey MVP:
- Location: Příbram
- Facility MH = Malá hala
- Facility VH = Velká hala

Future examples:
- football pitch
- tennis court
- swimming lane
- gym hall

### Training session
One scheduled training occurrence.

### Booking
Links athlete to a training session.

## 5. Athlete profile

### Core athlete data
Required:
- First name
- Last name
- Full date of birth

Optional:
- Profile photo
- Active/inactive

### Hockey sport profile
Required:
- Position
- Stick side

Optional:
- Club
- Team/category
- Jersey number

#### Hockey position values
- GOALIE — Brankář
- DEFENSE — Obránce
- CENTER — Centr
- LEFT_WING — Levé křídlo
- RIGHT_WING — Pravé křídlo
- UTILITY — Univerzál

#### Stick side values
- LEFT — Levé
- RIGHT — Pravé
- UNKNOWN — Nevím

Sport-specific attributes must not be stored as columns on the core `athletes` table.

## 6. Guardian model

One account may manage multiple athletes.

One athlete may later be linked to multiple guardians.

Initial MVP may launch with one primary guardian per athlete from the UI, but the database must support multiple guardians from day one.

Recommended later flow:
1. Existing guardian opens athlete access settings.
2. Invites another guardian by email.
3. Invitation may cover one or more athletes.
4. Recipient authenticates by email OTP.
5. Recipient gains access to the existing athlete profile instead of creating a duplicate.

Do not allow users to find children by name + date of birth.

## 7. Registration and authentication

MVP:
- Registration available to users who receive the application link from the coach.
- Authentication: email + one-time password/code (OTP).
- No password required.

The system should be ready for invitation-based access later.

## 8. Training session fields

Required:
- Workspace
- Sport
- Main coach
- Date
- Start time
- End time
- Location
- Facility
- Capacity
- Eligibility rule
- Status

Optional:
- Assistant coaches
- Changing room
- Notes

Current default:
- Capacity = 10

Changing room may be blank at creation and added later.

## 9. Session eligibility

Coach chooses:
- All athletes
OR
- Birth year from
- Birth year to

Eligibility is based on the athlete's full date of birth.

Example:
2017-10-23 -> birth year 2017.

Only athletes with a matching sport profile and workspace membership may be booked into the session.

## 10. Booking behavior

Normal user booking is allowed when:
- session status is OPEN;
- current time is before session start;
- athlete is eligible;
- athlete has not already been booked;
- current confirmed booking count is below capacity.

Coach manual booking:
- may add eligible managed athletes;
- may intentionally exceed capacity;
- must be recorded as coach-created booking.

When one guardian books multiple children into the same session, each athlete receives a separate booking record.

## 11. Cancellation behavior

Guardian/user:
- may cancel until 12 hours before session start;
- inside 12 hours cancellation is unavailable;
- UI displays: "Odhlášení již není možné. Kontaktujte trenéra."

Coach:
- may cancel/remove an athlete at any time.

Bookings are not hard-deleted.

## 12. Session status model

- DRAFT
- OPEN
- CLOSED
- COMPLETED
- CANCELLED

`CLOSED` means new user bookings are not accepted even if places remain.

## 13. Capacity rules

Default capacity = 10.

Coach may edit capacity per session.

If current bookings = 8 and coach changes capacity from 10 to 6:
- allow the change;
- show explicit warning before save;
- preserve all existing bookings;
- display 8 / 6;
- block further normal user bookings;
- coach may still manually add more athletes.

Normal user booking must never exceed capacity due to race conditions.

Coach override may exceed capacity.

## 14. Updating a published session

Coach may change:
- date
- start time
- end time
- facility (MH/VH)
- changing room
- capacity
- coaches
- notes

User-facing marker:
- show `Změněno` for changed future sessions.

Email notification required for:
- session cancellation;
- date change;
- start/end time change;
- facility MH/VH change.

Changing room updates may show in-app marker without mandatory email in MVP.

Capacity-only change does not require email if existing booking remains valid.

## 15. Session cancellation

Cancelled session:
- remains visible in My Bookings;
- status shown as `Cancelled by coach` / Czech UI equivalent;
- all booking history remains stored;
- email sent to all active guardians of each booked athlete;
- deduplicate recipients so one guardian receives one email per cancelled session even when multiple linked children are booked.

## 16. Recurring sessions

Coach may create a series.

Example:
- every Sunday
- 09:00–10:00
- MH
- birth years 2017–2018
- capacity 10
- from 4 Oct to 29 Nov

The system must create separate training_session rows for each occurrence.

After creation each occurrence is independently editable/cancellable.

Also provide Duplicate Session.

## 17. Parent navigation

Primary mobile navigation:
- Tréninky
- Moje tréninky
- Moji sportovci
- Účet

My Bookings sections:
- Upcoming
- Past

Cancelled future sessions remain visible.

## 18. Coach navigation

Primary coach areas:
- Tréninky
- Vytvořit trénink
- Série tréninků
- Sportovci
- Session detail / roster

Session detail actions:
- Add athlete
- Remove athlete
- Edit session
- Duplicate
- Close booking
- Cancel session

## 19. Privacy

Other guardians must not see:
- names of athletes booked into a session;
- who booked another athlete;
- other athlete profile details.

Guardian session list shows only occupancy such as `3 / 10`.

Coach may see:
- athlete identity;
- relevant athlete sport profile;
- who created the booking;
- booking timestamp.

## 20. Data minimization

Store only data required for the application.

MVP intentionally avoids:
- medical data
- residential address
- unnecessary identity data

Profile photos are optional and stored in private storage.

## 21. Localization

MVP UI: Czech.

Architecture must support later English localization.

Do not store translated UI labels as business data when stable internal codes are sufficient.
