-- Trainlio — Půjde / Nepůjde (handoff v3.7, decisions 52–55, migration 49).
-- Run after the migrations and fixtures, on its own freshly created database.
-- Guardian tests 11–13, coach tests 30–33 (AC-041, AC-315–AC-319).
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
\set ANNA   '''00000000-0000-0000-0000-0000000a0002'''
\set TOMAS  '''00000000-0000-0000-0000-0000000a0003'''

create or replace function pg_temp.booking(p_session uuid, p_athlete uuid) returns uuid
language sql stable as $$
  select id from public.bookings
   where training_session_id = p_session and athlete_id = p_athlete
   order by created_at desc limit 1 $$;
create or replace function pg_temp.respond(p_sub text, p_booking uuid) returns text
language sql as $$
  select pg_temp.as_user(p_sub, format(
    $q$select public.confirm_attendance_as_guardian(%L::uuid) ->> 'code'$q$, p_booking)) $$;
create or replace function pg_temp.withdraw(p_sub text, p_booking uuid, p_reason text) returns text
language sql as $$
  select pg_temp.as_user(p_sub, format(
    $q$select coalesce(public.cancel_booking_as_guardian(%L::uuid, %L) ->> 'code', 'ok')$q$,
    p_booking, p_reason)) $$;

-- S2 in six hours, inside the twelve-hour deadline, with no main coach (K2e).
-- S3 started ten minutes ago. S4 ended yesterday.
insert into public.training_sessions(id,workspace_id,sport_id,location_id,facility_id,main_coach_profile_id,
  start_at,end_at,capacity,status,created_by,eligibility_mode)
select v.id::uuid, w.id, w.primary_sport_id, l.id, f.id, v.coach::uuid,
       now() + v.at, now() + v.at + interval '1 hour', 10, 'OPEN', :COACH::uuid, 'ALL'
  from (values
    ('00000000-0000-0000-0000-0000000f6002', null,   interval '6 hours'),
    ('00000000-0000-0000-0000-0000000f6003', :COACH, interval '-10 minutes'),
    ('00000000-0000-0000-0000-0000000f6004', :COACH, interval '-1 day')) v(id, coach, at)
  cross join public.workspaces w
  join public.locations l on l.workspace_id = w.id
  join public.facilities f on f.location_id = l.id and f.code = 'MH';
insert into public.training_session_coaches(training_session_id,profile_id,role) values
  ('00000000-0000-0000-0000-0000000f6003', :COACH, 'MAIN'),
  ('00000000-0000-0000-0000-0000000f6004', :COACH, 'MAIN');
insert into public.bookings(training_session_id, athlete_id, created_by, created_by_role) values
  ('00000000-0000-0000-0000-0000000f6003', :IVAN, :FAMA, 'USER');

\echo ''
\echo '── Půjde (G6f, guardian test 11) ──────────────────────────────────'
select pg_temp.check(
  (select coalesce(guardian_response, 'null') from public.bookings where id = pg_temp.booking(:S1, :IVAN)),
  'null', 'a booking starts as Nepotvrzeno');
select pg_temp.check(pg_temp.respond(:FAMA, pg_temp.booking(:S1, :IVAN)), null,
  'its guardian answers Půjde');
select pg_temp.check(
  (select guardian_response || '|' || (responded_by = :FAMA::uuid)::text
     from public.bookings where id = pg_temp.booking(:S1, :IVAN)),
  'GOING|true', 'stored with who answered');
select pg_temp.check(pg_temp.respond(:FAMA, pg_temp.booking(:S1, :IVAN)), null,
  'answering again is harmless');
select pg_temp.check(
  (select count(*)::text from public.audit_log where action = 'BOOKING_GUARDIAN_CONFIRMED'),
  '1', 'and audited once');
select pg_temp.check(pg_temp.respond(:FAMB, pg_temp.booking(:S1, :IVAN)), 'NOT_AUTHORIZED_FOR_ATHLETE',
  'another family cannot answer for him');
select pg_temp.check(
  (select count(*)::text from public.notification_events where event_type <> 'GUARDIAN_ABSENCE_TO_COACH'
      and training_session_id = :S1),
  '0', 'Půjde e-mails nobody (EMAILS.md §4)');
select pg_temp.check(pg_temp.respond(:FAMA, pg_temp.booking('00000000-0000-0000-0000-0000000f6003', :IVAN)),
  'SESSION_STARTED', 'not once the training has started (guardian test 13)');

\echo ''
\echo '── Nepůjde (G6g, guardian test 12, AC-041) ────────────────────────'
select pg_temp.check(
  (select count(*)::text from pg_proc where proname = 'cancel_booking_as_guardian' and pronargs = 1),
  '0', 'there is no way to withdraw without a reason left');
select pg_temp.check(pg_temp.withdraw(:FAMA, pg_temp.booking(:S1, :TOMAS), ''), 'VALIDATION',
  'an empty reason is refused');
select pg_temp.check(pg_temp.withdraw(:FAMA, pg_temp.booking(:S1, :TOMAS), '    '), 'VALIDATION',
  'and one of spaces only');
select pg_temp.check(pg_temp.withdraw(:FAMA, pg_temp.booking(:S1, :TOMAS), repeat('x', 201)), 'VALIDATION',
  'and one of 201 characters');
select pg_temp.check(pg_temp.withdraw(:FAMB, pg_temp.booking(:S1, :TOMAS), 'Nemoc'), 'NOT_AUTHORIZED_FOR_ATHLETE',
  'another family cannot withdraw him');
select pg_temp.check(
  (select confirmed_count::text from public.training_session_occupancy where training_session_id = :S1),
  '2', 'none of that touched the place');
select pg_temp.check(pg_temp.withdraw(:FAMA, pg_temp.booking(:S1, :TOMAS), '  Nemoc – teplota  '), 'ok',
  'a reason of up to 200 characters withdraws him');
select pg_temp.check(
  (select status || '|' || cancellation_reason || '|' || cancel_late::text
     from public.bookings where id = pg_temp.booking(:S1, :TOMAS)),
  'CANCELLED_BY_USER|Nemoc – teplota|false', 'trimmed, and in good time');
select pg_temp.check(
  (select confirmed_count::text from public.training_session_occupancy where training_session_id = :S1),
  '1', 'the place is freed');
select pg_temp.check(pg_temp.withdraw(:FAMA, pg_temp.booking(:S1, :TOMAS), 'Nemoc'), 'BOOKING_NOT_CONFIRMED',
  'and it cannot be withdrawn twice');

\echo ''
\echo '── E10 (coach test 30) ────────────────────────────────────────────'
select pg_temp.check(
  (select string_agg(r.recipient_profile_id::text || ':' || array_to_string(r.athlete_names, ','), ', ')
     from public.notification_events e
     cross join lateral public.notification_event_recipients(e.id) r
    where e.event_type = 'GUARDIAN_ABSENCE_TO_COACH' and e.training_session_id = :S1),
  '00000000-0000-0000-0000-00000000c0ac:Tomáš Svoboda', 'the main coach is told, about that child');
select pg_temp.check(
  (select (payload ->> 'reason') || '|' || (payload ->> 'booked') || '/' || (payload ->> 'capacity')
     from public.notification_events
    where event_type = 'GUARDIAN_ABSENCE_TO_COACH' and training_session_id = :S1),
  'Nemoc – teplota|1/3', 'with the reason and how full the training is now');

\echo ''
\echo '── Who reads the reason (coach test 33) ───────────────────────────'
select pg_temp.check(
  pg_temp.as_user(:FAMA, format($$select cancellation_reason from public.bookings where id = %L$$,
    pg_temp.booking(:S1, :TOMAS))),
  'Nemoc – teplota', 'the family that wrote it');
select pg_temp.check(
  pg_temp.as_user(:FAMB, format($$select count(*)::text from public.bookings where id = %L$$,
    pg_temp.booking(:S1, :TOMAS))),
  '0', 'never another family');
select pg_temp.check(
  pg_temp.as_user(:COACH2, format($$select cancellation_reason from public.session_roster(%L::uuid)
    where athlete_id = %L::uuid and status = 'CANCELLED_BY_USER'$$, :S1, :TOMAS)),
  'Nemoc – teplota', 'every coach of the club, a view-only one too (K2b)');
select pg_temp.check(
  pg_temp.as_user(:FAMA, format($$select responded_by_name from public.guardian_booking_actors(array[%L::uuid])$$,
    pg_temp.booking(:S1, :IVAN))),
  'Rodina A', 'the family reads who answered (G6h)');
select pg_temp.check(
  pg_temp.as_user(:FAMB, format($$select count(*)::text from public.guardian_booking_actors(array[%L::uuid])$$,
    pg_temp.booking(:S1, :IVAN))),
  '0', 'another family reads nothing of it');

\echo ''
\echo '── Booking again (G6i) ────────────────────────────────────────────'
select pg_temp.check(
  pg_temp.as_user(:FAMA, format($$select public.book_athletes_as_guardian(%L::uuid, array[%L::uuid]) -> 'data' ->> 'booked_count'$$,
    :S1, :TOMAS)),
  '1', 'a withdrawn child can be booked again while there is a place');
select pg_temp.check(
  (select coalesce(guardian_response, 'null') from public.bookings where id = pg_temp.booking(:S1, :TOMAS)),
  'null', 'as a new booking, Nepotvrzeno');

\echo ''
\echo '── Late, and no main coach (coach test 31) ────────────────────────'
select pg_temp.check(
  pg_temp.as_user(:FAMB, format($$select public.book_athletes_as_guardian(%L::uuid, array[%L::uuid]) -> 'data' ->> 'booked_count'$$,
    '00000000-0000-0000-0000-0000000f6002', :ANNA)),
  '1', 'booked six hours before the start');
select pg_temp.check(
  pg_temp.withdraw(:FAMB, pg_temp.booking('00000000-0000-0000-0000-0000000f6002', :ANNA), 'Škola – výlet'), 'ok',
  'and withdrawn past the deadline (decision 53)');
select pg_temp.check(
  (select cancel_late::text from public.bookings
    where id = pg_temp.booking('00000000-0000-0000-0000-0000000f6002', :ANNA)),
  'true', 'which is stored as late — Pozdě');
select pg_temp.check(
  (select string_agg(r.recipient_profile_id::text, ',')
     from public.notification_events e
     cross join lateral public.notification_event_recipients(e.id) r
    where e.event_type = 'GUARDIAN_ABSENCE_TO_COACH'
      and e.training_session_id = '00000000-0000-0000-0000-0000000f6002'),
  '00000000-0000-0000-0000-00000000ad11', 'a training with no main coach tells the administrators');
select pg_temp.check(
  pg_temp.withdraw(:FAMA, pg_temp.booking('00000000-0000-0000-0000-0000000f6003', :IVAN), 'Nemoc'),
  'SESSION_STARTED', 'after the start nothing can be withdrawn (guardian test 13)');

\echo ''
\echo '── Attendance (decision 54, coach test 32) ────────────────────────'
-- S4 ended yesterday: Ivan Byl; Anna withdrew (Nebyl); Tomáš withdrew twice
-- and was booked again, Byl — his withdrawals count for nothing.
insert into public.bookings(training_session_id, athlete_id, created_by, created_by_role, status,
  cancelled_at, cancelled_by, cancellation_reason, attendance, attendance_at, attendance_by, created_at)
values
  ('00000000-0000-0000-0000-0000000f6004', :IVAN,  :FAMA, 'USER', 'CONFIRMED', null, null, null, 'PRESENT', now(), :COACH, now() - interval '3 days'),
  ('00000000-0000-0000-0000-0000000f6004', :ANNA,  :FAMB, 'USER', 'CANCELLED_BY_USER', now() - interval '2 days', :FAMB, 'Nemoc', null, null, null, now() - interval '3 days'),
  ('00000000-0000-0000-0000-0000000f6004', :TOMAS, :FAMA, 'USER', 'CANCELLED_BY_USER', now() - interval '2 days', :FAMA, 'Škola', null, null, null, now() - interval '3 days'),
  ('00000000-0000-0000-0000-0000000f6004', :TOMAS, :FAMA, 'USER', 'CANCELLED_BY_USER', now() - interval '36 hours', :FAMA, 'Škola', null, null, null, now() - interval '40 hours'),
  ('00000000-0000-0000-0000-0000000f6004', :TOMAS, :FAMA, 'USER', 'CONFIRMED', null, null, null, 'PRESENT', now(), :COACH, now() - interval '30 hours');
select pg_temp.check(
  pg_temp.as_user(:ADMIN, format($$select (d ->> 'present') || '/' || (d ->> 'marked') || ' · ' || (d ->> 'booked')
      || ' · ' || (d ->> 'paid') || '/' || (d ->> 'bookings')
    from (select public.workspace_statistics(%L::uuid, now() - interval '3 days', now()) -> 'data' as d) x$$,
    (select id from public.workspaces limit 1))),
  '2/3 · 2 · 0/2', 'Byl / (Byl + Nebyl + Nepůjde); occupancy and payment over confirmed bookings only');
