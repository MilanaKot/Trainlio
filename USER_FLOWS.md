# User Flows

## 1. Registration
1. User receives app link from coach.
2. Opens app.
3. Enters email.
4. Receives OTP.
5. Enters OTP.
6. Account is created/authenticated.
7. User creates first athlete profile.
8. User creates hockey sport profile for athlete.
9. Athlete becomes available for booking in current workspace.

## 2. Add another child
1. Guardian opens `Moji sportovci`.
2. Taps `Přidat sportovce`.
3. Enters core athlete data.
4. Adds sport profile.
5. Saves.
6. New athlete appears in account.

## 3. Book a training
1. Guardian opens `Tréninky`.
2. Sees future OPEN sessions.
3. Session card shows date, time, facility, birth-year range, occupancy.
4. Guardian taps `Přihlásit`.
5. System lists only eligible athletes.
6. Guardian may select one or multiple eligible athletes.
7. Booking transaction runs.
8. Successful athletes become confirmed.
9. Occupancy updates in real time.

## 4. Full session
1. Session occupancy reaches capacity.
2. User sees full state.
3. Booking CTA is disabled.
4. Coach can still manually add an athlete using override.

## 5. Guardian cancellation
1. Guardian opens My Bookings.
2. Selects athlete/session.
3. If >=12 hours before start, `Odhlásit` is enabled.
4. User confirms.
5. Booking status becomes CANCELLED_BY_USER.
6. Occupancy updates.

## 6. Cancellation inside 12 hours
1. Guardian opens booking.
2. `Odhlásit` is disabled.
3. UI displays `Odhlášení již není možné. Kontaktujte trenéra.`

## 7. Coach manually adds athlete
1. Coach opens session detail.
2. Taps `Přidat sportovce`.
3. Selects athlete.
4. If capacity would be exceeded, explicit override warning is shown.
5. Coach confirms.
6. Booking created with creator = coach.
7. Roster updates.

## 8. Coach removes athlete
1. Coach opens session roster.
2. Selects athlete.
3. Confirms removal.
4. Booking status becomes CANCELLED_BY_COACH.
5. Booking remains in history.

## 9. Coach edits session
1. Coach opens session.
2. Taps `Upravit trénink`.
3. Changes fields.
4. If new capacity is below confirmed count, warning appears.
5. Coach confirms.
6. Session is updated.
7. In-app Updated marker is set.
8. If significant fields changed, email notification is queued.

## 10. Coach cancels session
1. Coach opens session.
2. Taps `Zrušit trénink`.
3. Confirmation displayed.
4. Session status becomes CANCELLED.
5. Session remains in bookings/history.
6. All active guardians of booked athletes are collected.
7. Recipient emails are deduplicated.
8. One email per guardian is sent.
9. My Bookings shows cancelled status.

## 11. Create recurring series
1. Coach selects `Série tréninků`.
2. Enters recurrence pattern and common session data.
3. UI previews occurrence dates.
4. Coach confirms.
5. Separate session records are created.
6. Coach may later edit any occurrence independently.

## 12. Duplicate session
1. Coach opens existing session.
2. Taps `Duplikovat`.
3. Form opens prefilled.
4. Coach changes date/time or other fields.
5. New independent session is created.

## 13. Future second guardian invitation
1. Existing guardian opens athlete access settings.
2. Taps `Pozvat další osobu`.
3. Enters recipient email.
4. Selects athletes to share.
5. Recipient receives invite.
6. Recipient authenticates via OTP.
7. Recipient gains guardian access to existing athlete records.
