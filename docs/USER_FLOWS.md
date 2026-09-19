# User Flows

Trainlio — Sports Training Booking Platform

## 1. Registration
1. User receives app link from coach. The link is a distribution channel, not
   authorization: an authenticated user with no athlete sees no workspace data.
2. Opens app.
3. Enters email.
4. Receives OTP.
5. Enters OTP.
6. Account is created/authenticated.
7. User creates first athlete profile.
8. User creates hockey sport profile for athlete.
9. Athlete, guardian access, sport profile and workspace membership are created
   in one server-side transaction.
10. Athlete becomes available for booking in the current workspace, and becomes
    visible to that workspace's coaches.

## 2. Add another child
1. Guardian opens `Moji sportovci`.
2. Taps `Přidat sportovce`.
3. Enters core athlete data.
4. Adds sport profile.
5. Saves.
6. New athlete appears in account.

## 3. Book a training
1. Guardian opens `Tréninky`.
2. Sees future non-DRAFT sessions for workspaces where they have an athlete.
3. Session card shows date, time, facility, birth-year range, occupancy.
4. Guardian taps `Přihlásit`.
5. System lists only eligible athletes.
6. Guardian may select one or multiple eligible athletes.
7. The booking transaction runs atomically for the whole selection.
8. Either all selected athletes become confirmed, or none does.
9. Occupancy updates in real time from the occupancy projection.

## 3a. Not enough places for the whole selection (D-05)
1. Guardian selects two children for a session with one place left.
2. Guardian confirms.
3. The transaction books neither child.
4. The application reports how many places remain.
5. UI shows: `Na tento trénink zbývá poslední volné místo. Vyberte prosím pouze jednoho sportovce.`
6. Guardian reduces the selection and retries.
7. The remaining place is booked.

A single confirmation never splits siblings into booked and not-booked states.

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
6. The guardian can no longer re-book that athlete into this session.
7. Only the coach may add the athlete back (flow 7).

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
4. Session status becomes CANCELLED, which is terminal.
5. Existing bookings are left untouched, preserving the roster as it stood.
6. The session cannot be reopened and accepts no further bookings.
7. Session remains in bookings/history as evidence of what was cancelled.
7. All active guardians of booked athletes are collected.
8. Recipient emails are deduplicated to one delivery per guardian.
9. Each delivery lists all of that guardian's affected athletes.
10. My Bookings shows cancelled status.

## 11. Create recurring series
1. Coach selects `Série tréninků`.
2. Enters recurrence pattern and common session data as local dates and times.
3. UI previews the generated local occurrence dates and times.
4. Coach confirms.
5. Each occurrence is converted from workspace-local wall clock to an absolute
   timestamp individually, so a series crossing a daylight-saving change keeps
   the same local start time.
6. Separate session records are created in one transaction.
7. Coach may later edit or cancel any occurrence independently; siblings are
   never affected.

## 11a. Coach narrows eligibility with athletes already booked
1. Coach opens `Upravit trénink`.
2. Changes eligibility from 2016–2018 to 2017–2018.
3. Warning names how many confirmed bookings fall outside the new range.
4. Coach confirms.
5. Existing bookings remain confirmed; nothing is cancelled.
6. Affected bookings show `Změněno`; unaffected ones do not.
7. Only the guardians of affected athletes are emailed.
8. New booking attempts use the new range.

## 11b. Coach cancelled a session by mistake
1. Coach realises the cancellation was wrong.
2. The session cannot be reopened — cancellation emails may already have been sent.
3. Coach opens the cancelled session and taps `Duplikovat`.
4. A new independent session is created with the same configuration.
5. The cancelled session remains in history.

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
