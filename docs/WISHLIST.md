# Wish list

Things we want after the MVP ships. Not commitments, and not a plan: an entry
here has been asked for and thought about far enough to know roughly what it
would cost, so that when it comes up again the thinking is not started over.

Nothing here is in scope now. `docs/PRD.md` §2 "Non-goals for MVP" is the
binding list; this file says what we would do about some of those non-goals
later, and why.

An entry names what it touches, what already exists that it would build on, and
what would have to be decided before anybody writes code. Add to it freely.

---

## 1. Calendar integration

**What.** A training a parent has booked should appear in the calendar they
already use, without them typing it in.

Three increasingly ambitious versions, and they are not alternatives — each one
is worth having on its own:

- **Add to calendar.** A button on the booking detail (G6) that downloads an
  `.ics` file for that one session. Works with every calendar application there
  is, needs no account anywhere, and is a day's work.
- **A subscribed feed.** One `webcal:` URL per guardian which their calendar
  re-reads on its own, so a session the coach moves moves in their calendar
  too, and a cancelled one disappears. This is the version that is actually
  useful for a family with two children and four trainings a week.
- **The coach's own calendar.** The coach's week as a feed as well, so the
  trainings they lead sit beside everything else in their day.

**What exists already.** Every session carries `start_at`, `end_at`, the
facility and the location, and `training_sessions.significant_change` records
exactly which of those a coach moved (migration 28). The outbox already decides
who has to be told about a change; the same event is what a feed would be
regenerated from.

**What it would take.** An `.ics` writer, which is a small and unpleasant
format — folding at 75 octets, `DTSTAMP` in UTC while the session is wall-clock
Europe/Prague, `SEQUENCE` bumped on every change, `METHOD:CANCEL` for a
cancellation, and a `UID` that stays the same for the life of the session or the
update silently becomes a second event in the parent's calendar.

**What has to be decided first.** A subscribed feed is a URL a calendar
application fetches with no session and no cookie, which makes the URL itself
the credential — an unguessable token per guardian, revocable, and never a
guessable id. It carries a child's name and where they will be on Thursday, so
it is the first thing in the product that would be readable by anyone holding a
link. That is a privacy decision (D-19, §19 of the PRD), not a technical one,
and it needs the parent's explicit consent and a way to revoke.

---

## 2. Notifications

**What.** Reaching a parent when something changes, beyond the e-mail we send
today.

- **Push.** A cancelled training an hour before it starts is the case e-mail
  serves worst: it arrives in an inbox nobody is looking at. Web push (the app
  installed to the home screen) reaches the phone.
- **A notification centre in the app.** What has changed since the parent last
  looked, in one list, rather than each screen carrying its own badge.
- **SMS.** The fallback for a parent who reads neither. Costs money per message
  and is worth it only for a cancellation.
- **The coach's side.** A parent cancelling inside the deadline window, or a
  training filling up, is something the coach currently learns by opening the
  screen.

**What exists already.** Most of it, in the part that is hardest to retrofit.
The outbox is a notification system with e-mail as its only channel today:
`notification_events` records what happened, `notification_deliveries` records
who must be told and whether they were, and the drain claims and sends them
(migration 17). A second channel is a second delivery row and a second sender —
not a second architecture. The audit log is separate from it on purpose and
stays that way.

**What it would take.** A `channel` on the delivery, per-recipient preferences
(which channel for which event type), and for push specifically: a service
worker, a subscription store, VAPID keys, and the parts of installability the
application does not have yet. The quiet-hours question is real — a session
cancelled at 23:40 should still wake somebody for a 06:00 training, and should
not for one next week.

**What has to be decided first.** Which events are worth interrupting somebody
for. The current rule is that only a cancellation and a significant change send
an e-mail at all, and push makes that rule matter much more: a product that
buzzes for every booking gets its notifications turned off, and then the
cancellation does not arrive either.

---

## 3. The coach's own words in a cancellation e-mail

**What.** When a coach cancels a training, the e-mail the families get should
be able to say why, in the coach's words — "led je po poruše rolby", "trenér
je nemocný, náhradní termín v sobotu" — and the other coaches of that training
should hear about it too. Asked for by the club in October 2026, after the
first real cancellations.

Two parts, worth doing in this order:

- **A message to the parents.** An optional text field in the cancel dialog
  (§K6), shown in the e-mail as the coach's note. The rest of the e-mail stays
  the template it is now: what was cancelled, when, where, and the button.
- **Telling the staff.** The assistants and the main coach of the cancelled
  training, when somebody else cancelled it. Today nobody on the staff side is
  told anything.

Editing the whole e-mail (subject, body, layout) is deliberately not on the
list: the template is what makes every cancellation read the same and carry
the facts, and a free-form e-mail is how a parent ends up without the date.

**What exists already.** Most of the first part, unused.
`cancel_training_session` takes `p_reason` (migration 13) and stores it in the
event payload; `cancelSession(sessionId, reason)` passes it through; and
`composeNotificationEmail` already renders `session.reason` as a message block
in both the text and the HTML version. The dialog in
`src/components/session/session-controls.tsx` calls `cancelSession(session.id,
'')`, so the field is the missing piece. `TextareaWithCounter` (field.tsx) is
the control the rest of the forms use for notes.

The second part has nothing yet. `notification_event_recipients` (migration 17)
expands an event to guardians only (BR-072).

**What it would take.** For the message: the textarea in the dialog, a length
limit agreed with the SQL side, and an e-mail test that the note arrives
escaped. Small. For the staff: a staff branch in recipient expansion, a
template that addresses a colleague rather than a parent, and a rule that the
coach who cancelled is not told about their own action.

**What has to be decided first.** Whether the note is also shown in the app on
the cancelled training (§G6 for the parent, §K6b for the coach) or lives only
in the e-mail; whether a series-wide cancellation, if it ever exists, takes one
note for all of them; and whether staff are told about every cancellation or
only about ones somebody else made.
