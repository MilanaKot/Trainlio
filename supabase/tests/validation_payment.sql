-- Trainlio — payment, the coach's note and the message to the parent, per
-- booking (handoff v3.3, decisions 34–36, migration 43). The database half of
-- AC-295, AC-296, AC-297, AC-298 and AC-299; v3.4 replaced their screens. Run after the
-- migrations and fixtures, on its own freshly created database.
--
-- The fixture training e0001 is led by COACH (Novák) and starts in 30 days,
-- with Ivan (a0001) and Tomáš (a0003) booked by family A. Family B is made
-- Ivan's second guardian, so "every guardian of the athlete" has two people in
-- it. COACH2 (Dvořák) loses the permission to edit every training and is made
-- the training's assistant: a view-only coach on it (coach test 23).
\set QUIET 1
\pset format unaligned
\pset tuples_only on
\set ON_ERROR_STOP 0

create or replace function pg_temp.as_user(p_sub text, p_sql text)
returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claim.sub', p_sub, true);
  perform set_config('role', 'authenticated', true);
  execute p_sql into r;
  perform set_config('role', 'none', true);
  return r;
exception when others then
  perform set_config('role', 'none', true);
  return 'DENIED: ' || sqlerrm;
end $$;

create or replace function pg_temp.check(p_actual text, p_expected text, p_label text)
returns text language plpgsql as $$
begin
  if p_actual is not distinct from p_expected then return 'PASS  ' || p_label;
  else return 'FAIL  ' || p_label || ' (expected ' || coalesce(p_expected,'null') ||
              ', got ' || coalesce(p_actual,'null') || ')'; end if;
end $$;

\set COACH  '''00000000-0000-0000-0000-00000000c0ac'''
\set COACH2 '''00000000-0000-0000-0000-00000000c0ad'''
\set ADMIN  '''00000000-0000-0000-0000-00000000ad11'''
\set FAMA   '''00000000-0000-0000-0000-0000000fa000'''
\set FAMB   '''00000000-0000-0000-0000-0000000fb000'''
\set S1     '''00000000-0000-0000-0000-0000000e0001'''
\set IVAN   '''00000000-0000-0000-0000-0000000a0001'''
\set TOMAS  '''00000000-0000-0000-0000-0000000a0003'''

create or replace function pg_temp.booking(p_athlete uuid) returns uuid language sql stable as
  $$ select id from public.bookings
      where training_session_id = '00000000-0000-0000-0000-0000000e0001'
        and athlete_id = p_athlete and status = 'CONFIRMED' $$;
create or replace function pg_temp.code(p_sub text, p_sql text) returns text language sql as
  $$ select coalesce(pg_temp.as_user(p_sub, 'select (' || p_sql || ') ->> ''code'''), 'OK') $$;

insert into public.guardian_athlete_access (profile_id, athlete_id) values (:FAMB, :IVAN);
update public.workspace_members set can_edit_trainings = false
 where profile_id = :COACH2 and role = 'COACH';
insert into public.training_session_coaches (training_session_id, profile_id, role)
values (:S1, :COACH2, 'ASSISTANT');

\echo ''
\echo '── Paid (decision 34, coach test 19) ───────────────────────────────'
select pg_temp.check(
  pg_temp.code(:COACH, format('public.set_booking_paid(%L::uuid, true)', pg_temp.booking(:IVAN))),
  'OK', 'the main coach marks a booking paid, before the training');
select pg_temp.check(
  (select (paid_by = :COACH and paid_at is not null)::text from public.bookings
    where id = pg_temp.booking(:IVAN)),
  'true', 'with who and when');
select pg_temp.check(
  pg_temp.as_user(:FAMA, format(
    'select (paid_at is not null)::text from public.bookings where id = %L::uuid',
    pg_temp.booking(:IVAN))),
  'true', 'the parent reads that it is paid (G6e)');
select pg_temp.check(
  pg_temp.code(:COACH, format('public.set_booking_paid(%L::uuid, false)', pg_temp.booking(:IVAN))),
  'OK', 'unticking is accepted');
select pg_temp.check(
  (select (paid_at is null and paid_by is null)::text from public.bookings
    where id = pg_temp.booking(:IVAN)),
  'true', 'and clears who and when');
select pg_temp.check(
  (select count(*)::text from public.audit_log where action = 'BOOKING_PAYMENT_MARKED'),
  '2', 'both changes are audited');
select pg_temp.check(
  (select count(*)::text from public.notification_events),
  '0', 'and nobody is e-mailed (EMAILS.md §4)');

\echo ''
\echo '── Who may (decision 33, coach test 23) ────────────────────────────'
select pg_temp.check(
  pg_temp.code(:COACH2, format('public.set_booking_paid(%L::uuid, true)', pg_temp.booking(:IVAN))),
  'FORBIDDEN_EDIT', 'a view-only assistant may not mark paid');
select pg_temp.check(
  pg_temp.code(:COACH2, format('public.mark_session_paid(%L::uuid)', :S1)),
  'FORBIDDEN_EDIT', 'nor mark everyone paid');
select pg_temp.check(
  pg_temp.code(:COACH2, format('public.set_booking_coach_note(%L::uuid, %L)', pg_temp.booking(:IVAN), 'x')),
  'FORBIDDEN_EDIT', 'nor write the note');
select pg_temp.check(
  pg_temp.code(:COACH2, format('public.send_parent_message(%L::uuid, %L)', pg_temp.booking(:IVAN), 'x')),
  'FORBIDDEN_EDIT', 'nor message the parent');
select pg_temp.check(
  pg_temp.code(:FAMA, format('public.set_booking_paid(%L::uuid, true)', pg_temp.booking(:IVAN))),
  'NOT_AUTHORIZED', 'a parent may not mark their own booking paid');
select pg_temp.check(
  pg_temp.code(:FAMA, format('public.send_parent_message(%L::uuid, %L)', pg_temp.booking(:IVAN), 'x')),
  'NOT_AUTHORIZED', 'nor send themselves a message');

\echo ''
\echo '── Everyone paid (K2c, coach test 20) ──────────────────────────────'
select pg_temp.check(
  pg_temp.code(:ADMIN, format('public.set_booking_paid(%L::uuid, true)', pg_temp.booking(:TOMAS))),
  'OK', 'the administrator marks Tomáš paid');
select pg_temp.check(
  pg_temp.as_user(:COACH, format(
    'select (public.mark_session_paid(%L::uuid) -> ''data'' ->> ''marked'')', :S1)),
  '1', '`Zaplatili všichni` marks the one booking still unpaid');
select pg_temp.check(
  (select paid_by::text from public.bookings where id = pg_temp.booking(:TOMAS)),
  :ADMIN, 'and leaves the one already paid with its own who');
select pg_temp.check(
  (select paid_by::text from public.bookings where id = pg_temp.booking(:IVAN)),
  :COACH, 'the other is marked by whoever pressed it');
select pg_temp.check(
  pg_temp.as_user(:COACH, format(
    'select (public.mark_session_paid(%L::uuid) -> ''data'' ->> ''marked'')', :S1)),
  '0', 'pressing it again marks nothing');

\echo ''
\echo '── The coach note (decision 35, coach test 21) ─────────────────────'
select pg_temp.check(
  pg_temp.code(:COACH, format('public.set_booking_coach_note(%L::uuid, %L)',
    pg_temp.booking(:IVAN), '  Dnes skvělý, dořešit bruslení vzad.  ')),
  'OK', 'the coach writes a note for this training');
select pg_temp.check(
  (select note from public.booking_coach_notes where booking_id = pg_temp.booking(:IVAN)),
  'Dnes skvělý, dořešit bruslení vzad.', 'stored trimmed');
select pg_temp.check(
  pg_temp.as_user(:FAMA, 'select count(*)::text from public.booking_coach_notes'),
  '0', 'the parent reads no note at all');
select pg_temp.check(
  pg_temp.as_user(:FAMA, format('select count(*)::text from public.session_roster(%L::uuid)', :S1)),
  '0', 'nor through the roster');
select pg_temp.check(
  pg_temp.as_user(:COACH2, format(
    'select coach_note from public.session_roster(%L::uuid) where athlete_id = %L::uuid', :S1, :IVAN)),
  'Dnes skvělý, dořešit bruslení vzad.', 'a view-only coach reads it (coach test 18)');
select pg_temp.check(
  pg_temp.code(:COACH, format('public.set_booking_coach_note(%L::uuid, %L)',
    pg_temp.booking(:IVAN), repeat('x', 201))),
  'NOTE_TOO_LONG', 'over 200 characters is refused');
select pg_temp.check(
  (select after::text from public.audit_log where action = 'BOOKING_NOTE_CHANGED'),
  '{"has_note": true}', 'the change is audited, its words are not');
select pg_temp.check(
  pg_temp.code(:COACH, format('public.set_booking_coach_note(%L::uuid, %L)', pg_temp.booking(:IVAN), '  ')),
  'OK', 'a blank note clears it');
select pg_temp.check(
  (select count(*)::text from public.booking_coach_notes),
  '0', 'and the row is gone');
select pg_temp.check(
  (select count(*)::text from information_schema.role_table_grants
    where table_name = 'booking_coach_notes' and grantee = 'authenticated'
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE')),
  '0', 'nobody writes the table except through the function');

\echo ''
\echo '── The message to the parent (decision 36, coach test 22) ──────────'
select pg_temp.check(
  pg_temp.code(:COACH, format('public.send_parent_message(%L::uuid, %L)', pg_temp.booking(:IVAN), '   ')),
  'MESSAGE_EMPTY', 'an empty message is not sent');
select pg_temp.check(
  pg_temp.code(:COACH, format('public.send_parent_message(%L::uuid, %L)',
    pg_temp.booking(:IVAN), repeat('x', 501))),
  'MESSAGE_TOO_LONG', 'nor one over 500 characters');
select pg_temp.check(
  pg_temp.code(:COACH, format('public.send_parent_message(%L::uuid, %L)',
    pg_temp.booking(:IVAN), 'Ivan dnes výborně bruslil.')),
  'OK', 'the coach sends a message');
select pg_temp.check(
  pg_temp.as_user(:FAMA, format(
    'select parent_message || ''|'' || (parent_message_sent_by = %L::uuid)::text from public.bookings where id = %L::uuid',
    :COACH, pg_temp.booking(:IVAN))),
  'Ivan dnes výborně bruslil.|true', 'the parent reads it, and who sent it (G6e)');
select pg_temp.check(
  (select count(*)::text from public.notification_events
    where event_type = 'COACH_MESSAGE_TO_GUARDIAN'
      and payload ->> 'message' = 'Ivan dnes výborně bruslil.'),
  '1', 'an E09 event is raised with the text');
select pg_temp.check(
  (select string_agg(r.recipient_profile_id::text, ',' order by r.recipient_profile_id)
     from public.notification_events e,
          lateral public.notification_event_recipients(e.id) r
    where e.event_type = 'COACH_MESSAGE_TO_GUARDIAN'),
  :FAMA || ',' || :FAMB, 'addressed to every guardian of Ivan, and only his');
select pg_temp.check(
  pg_temp.code(:COACH, format('public.send_parent_message(%L::uuid, %L)',
    pg_temp.booking(:IVAN), 'Oprava: zítra přineste helmu.')),
  'OK', '`Upravit a poslat znovu`');
select pg_temp.check(
  (select parent_message from public.bookings where id = pg_temp.booking(:IVAN)),
  'Oprava: zítra přineste helmu.', 'replaces the text');
select pg_temp.check(
  (select string_agg(payload ->> 'message', ' / ' order by created_at)
     from public.notification_events where event_type = 'COACH_MESSAGE_TO_GUARDIAN'),
  'Ivan dnes výborně bruslil. / Oprava: zítra přineste helmu.',
  'and sends again, each e-mail with the text it was sent with');
select pg_temp.check(
  (select string_agg(after ->> 'resent', ',' order by created_at) from public.audit_log
    where action = 'BOOKING_MESSAGE_SENT'),
  'false,true', 'both sends are audited');

\echo ''
\echo '── After the training, and what cannot be marked ───────────────────'
update public.training_sessions
   set start_at = now() - interval '2 hours', end_at = now() - interval '1 hour'
 where id = :S1;
select pg_temp.check(
  pg_temp.code(:COACH, format('public.set_booking_paid(%L::uuid, false)', pg_temp.booking(:IVAN))),
  'OK', 'a finished training stays open for payment');
select pg_temp.check(
  pg_temp.code(:COACH, format('public.send_parent_message(%L::uuid, %L)',
    pg_temp.booking(:IVAN), 'Díky za dnešek.')),
  'OK', 'and for a message about how it went');
update public.bookings
   set status = 'CANCELLED_BY_USER', cancelled_at = now(), cancelled_by = :FAMA
 where id = pg_temp.booking(:TOMAS);
select pg_temp.check(
  pg_temp.code(:COACH, format('public.set_booking_paid(%L::uuid, true)',
    (select id from public.bookings where athlete_id = :TOMAS and training_session_id = :S1))),
  'BOOKING_NOT_CONFIRMED', 'a cancelled booking cannot be marked');
update public.training_sessions
   set status = 'CANCELLED', cancelled_at = now(), cancelled_by = :COACH
 where id = :S1;
select pg_temp.check(
  pg_temp.code(:COACH, format('public.mark_session_paid(%L::uuid)', :S1)),
  'SESSION_CANCELLED', 'nor anything on a cancelled training');
select pg_temp.check(
  pg_temp.code(:COACH, format('public.set_booking_paid(%L::uuid, true)',
    '00000000-0000-0000-0000-000000000000')),
  'NOT_AUTHORIZED', 'a booking that does not exist looks like one that is not yours');
