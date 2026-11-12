-- Trainlio — attendance and the payment undo (handoff v3.4, decisions 39–42,
-- migration 44). Run after the migrations and fixtures, on its own freshly
-- created database.
--
-- The fixture training e0001 is led by COACH (Novák), with Ivan (a0001) and
-- Tomáš (a0003) booked by family A. It starts in 30 days and is moved into
-- the past as the cases need. COACH2 (Dvořák) is a view-only assistant on it.
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
\echo '── Not before the start (decision 40, coach test 21) ───────────────'
select pg_temp.check(
  pg_temp.code(:COACH, format('public.set_booking_attendance(%L::uuid, ''PRESENT'')', pg_temp.booking(:IVAN))),
  'SESSION_NOT_STARTED', 'nobody has come to a training that has not begun');
select pg_temp.check(
  pg_temp.code(:COACH, format('public.mark_session_present(%L::uuid)', :S1)),
  'SESSION_NOT_STARTED', 'nor can everyone be marked as there');

-- The training starts an hour ago.
update public.training_sessions
   set start_at = now() - interval '1 hour', end_at = now() + interval '30 minutes'
 where id = :S1;

\echo ''
\echo '── Byl / Nebyl (decision 40, coach test 21) ────────────────────────'
select pg_temp.check(
  pg_temp.code(:COACH, format('public.set_booking_attendance(%L::uuid, ''PRESENT'')', pg_temp.booking(:IVAN))),
  'OK', 'the main coach marks Ivan as there once it has begun');
select pg_temp.check(
  (select attendance::text || ' · ' || (attendance_by = :COACH)::text || ' · ' || (attendance_at is not null)::text
     from public.bookings where id = pg_temp.booking(:IVAN)),
  'PRESENT · true · true', 'with who and when');
select pg_temp.check(
  pg_temp.code(:COACH, format('public.set_booking_attendance(%L::uuid, ''ABSENT'')', pg_temp.booking(:IVAN))),
  'OK', 'the toggle moves on to Nebyl');
select pg_temp.check(
  pg_temp.code(:COACH, format('public.set_booking_attendance(%L::uuid, null)', pg_temp.booking(:IVAN))),
  'VALIDATION', 'and never back to unmarked');
select pg_temp.check(
  (select count(*)::text from public.audit_log where action = 'BOOKING_ATTENDANCE_MARKED'),
  '2', 'both marks are audited');
select pg_temp.check(
  (select count(*)::text from public.notification_events),
  '0', 'and nobody is e-mailed (EMAILS.md §4)');

\echo ''
\echo '── Ostatní byli (decision 42, coach test 22) ───────────────────────'
select pg_temp.check(
  pg_temp.as_user(:COACH, format(
    'select public.mark_session_present(%L::uuid) -> ''data'' ->> ''marked''', :S1)),
  '1', 'marks the one booking nobody marked');
select pg_temp.check(
  (select attendance::text from public.bookings where id = pg_temp.booking(:IVAN)),
  'ABSENT', 'and leaves Nebyl as it was');
select pg_temp.check(
  (select attendance::text from public.bookings where id = pg_temp.booking(:TOMAS)),
  'PRESENT', 'Tomáš is marked as there');

\echo ''
\echo '── Payment and attendance are independent (decision 41, test 23) ──'
select pg_temp.check(
  (select count(*)::text from public.bookings
    where training_session_id = :S1 and paid_at is not null),
  '0', 'marking attendance paid nobody');
select pg_temp.check(
  pg_temp.code(:COACH, format('public.set_booking_paid(%L::uuid, true)', pg_temp.booking(:IVAN))),
  'OK', 'paying for Ivan');
select pg_temp.check(
  (select attendance::text from public.bookings where id = pg_temp.booking(:IVAN)),
  'ABSENT', 'does not say he came');

\echo ''
\echo '── Who may (decision 33, coach test 26) ────────────────────────────'
select pg_temp.check(
  pg_temp.code(:COACH2, format('public.set_booking_attendance(%L::uuid, ''PRESENT'')', pg_temp.booking(:IVAN))),
  'FORBIDDEN_EDIT', 'a view-only assistant may not mark attendance');
select pg_temp.check(
  pg_temp.code(:COACH2, format('public.mark_session_present(%L::uuid)', :S1)),
  'FORBIDDEN_EDIT', 'nor mark everyone present');
select pg_temp.check(
  pg_temp.code(:FAMA, format('public.set_booking_attendance(%L::uuid, ''PRESENT'')', pg_temp.booking(:IVAN))),
  'NOT_AUTHORIZED', 'nor may a parent');
select pg_temp.check(
  pg_temp.as_user(:FAMA, format(
    'update public.bookings set attendance = ''PRESENT'' where id = %L::uuid returning 1', pg_temp.booking(:IVAN))),
  'DENIED: permission denied for table bookings', 'not even by writing the row');
select pg_temp.check(
  (select attendance::text from public.bookings where id = pg_temp.booking(:IVAN)),
  'ABSENT', 'which changed nothing');
select pg_temp.check(
  pg_temp.as_user(:FAMA, format(
    'select attendance::text from public.bookings where id = %L::uuid', pg_temp.booking(:IVAN))),
  'ABSENT', 'the parent reads their child''s attendance (G8b)');
select pg_temp.check(
  pg_temp.as_user(:FAMB, format(
    'select attendance::text from public.bookings where id = %L::uuid', pg_temp.booking(:TOMAS))),
  null, 'and not another family''s (AC-091)');

\echo ''
\echo '── Editable any time later (decision 40, coach test 21) ────────────'
update public.training_sessions
   set start_at = now() - interval '92 days', end_at = now() - interval '92 days' + interval '1 hour'
 where id = :S1;
select pg_temp.check(
  pg_temp.code(:COACH, format('public.set_booking_attendance(%L::uuid, ''PRESENT'')', pg_temp.booking(:IVAN))),
  'OK', 'a three-month-old training takes a correction');
select pg_temp.check(
  pg_temp.code(:COACH, format('public.update_training_session(%L::uuid, current_date, time ''10:00'', time ''11:00'', %L::uuid, 10, ''ALL'')',
    :S1, (select facility_id from public.training_sessions where id = :S1))),
  'SESSION_FINISHED', 'while the training itself stays as it was (BR-025d)');

\echo ''
\echo '── Vrátit (DS §6.16, decision 39, coach test 20) ───────────────────'
select pg_temp.check(
  (select paid_by::text from public.bookings where id = pg_temp.booking(:IVAN)),
  :COACH, 'Ivan was marked paid by the main coach');
select pg_temp.check(
  pg_temp.code(:ADMIN, format('public.set_booking_paid(%L::uuid, false)', pg_temp.booking(:IVAN))),
  'OK', 'the administrator unticks it');
select pg_temp.check(
  pg_temp.code(:COACH, format('public.undo_booking_unpaid(%L::uuid)', pg_temp.booking(:IVAN))),
  'UNDO_EXPIRED', 'only whoever unticked it may take that back');
select pg_temp.check(
  pg_temp.code(:ADMIN, format('public.undo_booking_unpaid(%L::uuid)', pg_temp.booking(:IVAN))),
  'OK', '`Vrátit` is accepted');
select pg_temp.check(
  (select paid_by::text from public.bookings where id = pg_temp.booking(:IVAN)),
  :COACH, 'and puts back who marked it, not who pressed `Vrátit`');
select pg_temp.check(
  (select (paid_at = (select (before ->> 'paid_at')::timestamptz from public.audit_log
                       where entity_id = pg_temp.booking(:IVAN) and before ? 'paid_at'
                       order by id desc limit 1))::text
     from public.bookings where id = pg_temp.booking(:IVAN)),
  'true', 'and when');
select pg_temp.check(
  pg_temp.code(:ADMIN, format('public.undo_booking_unpaid(%L::uuid)', pg_temp.booking(:IVAN))),
  'UNDO_EXPIRED', 'a second `Vrátit` has nothing to undo');
select pg_temp.check(
  pg_temp.code(:COACH2, format('public.undo_booking_unpaid(%L::uuid)', pg_temp.booking(:IVAN))),
  'FORBIDDEN_EDIT', 'and a view-only assistant may not try');

\echo ''
\echo '── K13 · the player card (decision 43, coach test 24) ──────────────'
select pg_temp.check(
  pg_temp.code(:COACH, format('public.set_booking_coach_note(%L::uuid, %L)', pg_temp.booking(:IVAN), 'Hlídat levou nohu.')),
  'OK', 'a note for one training');
select pg_temp.check(
  pg_temp.as_user(:COACH2, format(
    'select coach_note || '' · '' || attendance || '' · '' || (paid_at is not null)::text
       from public.coach_athlete_sessions(%L::uuid, %L::uuid) where booking_id = %L::uuid',
    (select workspace_id from public.training_sessions where id = :S1), :IVAN, pg_temp.booking(:IVAN))),
  'Hlídat levou nohu. · PRESENT · true', 'K13 reads note, attendance and payment per training, even view-only');
select pg_temp.check(
  pg_temp.as_user(:FAMA, format(
    'select count(*)::text from public.coach_athlete_sessions(%L::uuid, %L::uuid)',
    (select workspace_id from public.training_sessions where id = :S1), :IVAN)),
  '0', 'a parent reads none of it, the note least of all (coach test 24)');
select pg_temp.check(
  pg_temp.as_user(:COACH, format(
    'select string_agg(coalesce(email, ''-'') || '' '' || books::text, '', '' order by email)
       from public.athlete_guardians(%L::uuid)', :IVAN)),
  'familyA@example.test true, familyB@example.test false', 'K13r: each guardian''s e-mail, and who books');

\echo ''
\echo '── A cancelled training (BR-175) ───────────────────────────────────'
update public.training_sessions set status = 'CANCELLED', cancelled_at = now(), cancelled_by = :COACH
 where id = :S1;
select pg_temp.check(
  pg_temp.code(:COACH, format('public.set_booking_attendance(%L::uuid, ''ABSENT'')', pg_temp.booking(:TOMAS))),
  'SESSION_CANCELLED', 'takes no attendance');
select pg_temp.check(
  pg_temp.code(:COACH, format('public.mark_session_present(%L::uuid)', :S1)),
  'SESSION_CANCELLED', 'not even all at once');
