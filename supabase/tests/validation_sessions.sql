-- Trainlio — coach session operations validation
-- Run after the migrations and fixtures, on its own freshly created database.
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
  return 'DENIED';
end $$;

create or replace function pg_temp.check(p_actual text, p_expected text, p_label text)
returns text language plpgsql as $$
begin
  if p_actual is not distinct from p_expected then return 'PASS  ' || p_label;
  else return 'FAIL  ' || p_label || ' (expected ' || coalesce(p_expected,'null') ||
              ', got ' || coalesce(p_actual,'null') || ')'; end if;
end $$;

\set COACH '''00000000-0000-0000-0000-00000000c0ac'''
\set COACH2 '''00000000-0000-0000-0000-00000000c0ad'''
\set WSADMIN '''00000000-0000-0000-0000-00000000ad11'''
\set A '''00000000-0000-0000-0000-0000000fa000'''

create or replace function pg_temp.ws() returns uuid language sql stable as
  $$ select id from public.workspaces where name like 'Příbram%' $$;
create or replace function pg_temp.fac(p_code text) returns uuid language sql stable as
  $$ select f.id from public.facilities f join public.locations l on l.id=f.location_id
     join public.workspaces w on w.id=l.workspace_id where f.code=p_code and w.name like 'Příbram%' $$;
create or replace function pg_temp.sid() returns uuid language sql stable as
  $$ select id from public.training_sessions order by created_at desc limit 1 $$;

-- The fixtures already contain sessions, so the suite records the ids of the
-- ones it creates rather than picking by ordering.
create temp table t_ids (k text primary key, v uuid);

\echo '── Creation ────────────────────────────────────────────────────────'
insert into t_ids (k, v)
select 's1', (pg_temp.as_user(:COACH, format($$select (public.create_training_session(
    %L::uuid, date '2026-10-04', time '09:00', time '10:00', %L::uuid,
    10, 'BIRTH_YEAR_RANGE', 2016, 2018, 'Šatna 4', 'Vezměte si chrániče.', 'Interní.')
    -> 'data' ->> 'training_session_id')$$, pg_temp.ws(), pg_temp.fac('MH'))))::uuid;

create or replace function pg_temp.s1() returns uuid language sql stable as
  $$ select v from t_ids where k = 's1' $$;

select pg_temp.check((select (v is not null)::text from t_ids where k='s1'),
  'true', 'a coach can create a session');
select pg_temp.check(
  (select to_char(start_at at time zone 'Europe/Prague', 'YYYY-MM-DD HH24:MI') from public.training_sessions where id=pg_temp.s1()),
  '2026-10-04 09:00', 'local wall-clock time is stored as the right instant');
select pg_temp.check(
  (select count(*)::text from public.training_session_coaches where training_session_id=pg_temp.s1() and role='MAIN'),
  '1', 'the MAIN coach row is created');
select pg_temp.check(
  (select count(*)::text from public.training_session_occupancy where training_session_id=pg_temp.s1()),
  '1', 'the occupancy row is created by trigger');
select pg_temp.check(
  (select count(*)::text from public.audit_log where action='SESSION_CREATED' and entity_id=pg_temp.s1()),
  '1', 'a SESSION_CREATED audit entry is appended');
select pg_temp.check(
  (select notes from public.training_session_internal_notes where training_session_id=pg_temp.s1()),
  'Interní.', 'internal notes are stored separately (D-13)');
select pg_temp.check(
  pg_temp.as_user(:A, format($$select (public.create_training_session(
    %L::uuid, date '2026-10-11', time '09:00', time '10:00', %L::uuid) ->> 'code')$$,
    pg_temp.ws(), pg_temp.fac('MH'))),
  'NOT_AUTHORIZED', 'a guardian cannot create a session');
select pg_temp.check(
  pg_temp.as_user(:WSADMIN, format($$select (public.create_training_session(
    %L::uuid, date '2026-10-11', time '09:00', time '10:00', %L::uuid) ->> 'ok')$$,
    pg_temp.ws(), pg_temp.fac('VH'))),
  'true', 'a workspace admin can (D-17, AC-210)');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.create_training_session(
    %L::uuid, date '2026-10-11', time '10:00', time '09:00', %L::uuid) ->> 'code')$$,
    pg_temp.ws(), pg_temp.fac('MH'))),
  'INVALID_TIME_RANGE', 'an end before the start is refused');

\echo ''
\echo '── Change classification (D-11) ────────────────────────────────────'
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.update_training_session(
    %L::uuid, date '2026-10-04', time '09:00', time '10:00', %L::uuid,
    10, 'BIRTH_YEAR_RANGE', 2016, 2018, 'Šatna 7', 'Jiná poznámka.', 'Jiná interní.')
    -> 'data' ->> 'significant')$$, pg_temp.s1(), pg_temp.fac('MH'))),
  'false', 'changing room and notes are NOT significant (D-12, D-13, AC-191)');
select pg_temp.check(
  (select (significant_changed_at is null)::text from public.training_sessions where id=pg_temp.s1()),
  'true', 'so no marker is set (AC-191, AC-204)');
select pg_temp.check((select count(*)::text from public.notification_events where training_session_id=pg_temp.s1()), '0', 'and no email is queued (AC-062, AC-204)');

select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.update_training_session(
    %L::uuid, date '2026-10-04', time '09:00', time '10:00', %L::uuid, 16, 'BIRTH_YEAR_RANGE', 2016, 2018)
    -> 'data' ->> 'significant')$$, pg_temp.s1(), pg_temp.fac('MH'))),
  'false', 'a capacity-only change is not significant (BR-064)');
select pg_temp.check((select count(*)::text from public.notification_events where training_session_id=pg_temp.s1()), '0', 'and queues no email');
select pg_temp.check(
  (select count(*)::text from public.audit_log where action='SESSION_CAPACITY_CHANGED' and entity_id=pg_temp.s1()),
  '1', 'but it is audited');

select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.update_training_session(
    %L::uuid, date '2026-10-04', time '08:00', time '09:00', %L::uuid, 16, 'BIRTH_YEAR_RANGE', 2016, 2018)
    -> 'data' -> 'events' ->> 0)$$, pg_temp.s1(), pg_temp.fac('MH'))),
  'SESSION_SCHEDULE_CHANGED', 'a time change is significant (AC-190)');
select pg_temp.check(
  (select (significant_changed_at is not null)::text from public.training_sessions where id=pg_temp.s1()),
  'true', 'and sets the marker (AC-190)');

select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.update_training_session(
    %L::uuid, date '2026-10-04', time '08:00', time '09:00', %L::uuid, 16, 'BIRTH_YEAR_RANGE', 2016, 2018)
    -> 'data' -> 'events' ->> 0)$$, pg_temp.s1(), pg_temp.fac('VH'))),
  'SESSION_FACILITY_CHANGED', 'MH to VH is significant (AC-190)');

select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.update_training_session(
    %L::uuid, date '2026-10-04', time '08:00', time '09:00', %L::uuid, 16, 'BIRTH_YEAR_RANGE', 2016, 2018,
    null, null, null, %L::uuid) -> 'data' -> 'events' ->> 0)$$,
    pg_temp.s1(), pg_temp.fac('VH'), '00000000-0000-0000-0000-00000000c0ad')),
  'SESSION_MAIN_COACH_CHANGED', 'a main-coach change is significant (AC-190, AC-194)');
select pg_temp.check(
  (select p.display_name from public.training_sessions s join public.app_profiles p on p.id=s.main_coach_profile_id where s.id=pg_temp.s1()),
  'Trenér Dvořák', 'and the mirror follows the canonical row');
select pg_temp.check(
  (select count(*)::text from public.audit_log where action='SESSION_MAIN_COACH_CHANGED' and entity_id=pg_temp.s1()),
  '1', 'with its own audit entry (AC-194)');

\echo ''
\echo '── Capacity below occupancy (BR-051, AC-051, AC-052) ───────────────'
insert into public.bookings(training_session_id, athlete_id, created_by, created_by_role)
select pg_temp.s1(), a.id, '00000000-0000-0000-0000-0000000fa000', 'USER'
from public.athletes a where a.first_name in ('Ivan','Tomáš');
select pg_temp.check(
  (select confirmed_count::text from public.training_session_occupancy where training_session_id=pg_temp.s1()),
  '2', 'two athletes are booked');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.update_training_session(
    %L::uuid, date '2026-10-04', time '08:00', time '09:00', %L::uuid, 1, 'BIRTH_YEAR_RANGE', 2016, 2018,
    null, null, null, %L::uuid) ->> 'code')$$, pg_temp.s1(), pg_temp.fac('VH'), '00000000-0000-0000-0000-00000000c0ad')),
  'CAPACITY_BELOW_OCCUPANCY', 'reducing capacity below occupancy is refused without confirmation');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.update_training_session(
    %L::uuid, date '2026-10-04', time '08:00', time '09:00', %L::uuid, 1, 'BIRTH_YEAR_RANGE', 2016, 2018,
    null, null, null, %L::uuid) -> 'details' ->> 'confirmed_count')$$, pg_temp.s1(), pg_temp.fac('VH'), '00000000-0000-0000-0000-00000000c0ad')),
  '2', 'and reports how many are already booked');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.update_training_session(
    %L::uuid, date '2026-10-04', time '08:00', time '09:00', %L::uuid, 1, 'BIRTH_YEAR_RANGE', 2016, 2018,
    null, null, null, %L::uuid, true) ->> 'ok')$$, pg_temp.s1(), pg_temp.fac('VH'), '00000000-0000-0000-0000-00000000c0ad')),
  'true', 'with confirmation it is applied');
select pg_temp.check(
  (select confirmed_count::text from public.training_session_occupancy where training_session_id=pg_temp.s1()),
  '2', 'and every existing booking is preserved (AC-052)');

\echo ''
\echo '── Eligibility narrowing (D-08, AC-170..175) ───────────────────────'
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.update_training_session(
    %L::uuid, date '2026-10-04', time '08:00', time '09:00', %L::uuid, 16, 'BIRTH_YEAR_RANGE', 2017, 2018,
    null, null, null, %L::uuid, true) ->> 'code')$$, pg_temp.s1(), pg_temp.fac('VH'), '00000000-0000-0000-0000-00000000c0ad')),
  'BOOKINGS_WOULD_BECOME_INELIGIBLE', 'narrowing past a booked athlete is refused without confirmation');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.update_training_session(
    %L::uuid, date '2026-10-04', time '08:00', time '09:00', %L::uuid, 16, 'BIRTH_YEAR_RANGE', 2017, 2018,
    null, null, null, %L::uuid, true) -> 'details' ->> 'affected_count')$$, pg_temp.s1(), pg_temp.fac('VH'), '00000000-0000-0000-0000-00000000c0ad')),
  '1', 'and names how many would fall outside');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.update_training_session(
    %L::uuid, date '2026-10-04', time '08:00', time '09:00', %L::uuid, 16, 'BIRTH_YEAR_RANGE', 2017, 2018,
    null, null, null, %L::uuid, true, true) ->> 'ok')$$, pg_temp.s1(), pg_temp.fac('VH'), '00000000-0000-0000-0000-00000000c0ad')),
  'true', 'with confirmation it is applied');
select pg_temp.check(
  (select count(*)::text from public.bookings where training_session_id=pg_temp.s1() and status='CONFIRMED'),
  '2', 'nothing is auto-cancelled (AC-171)');
select pg_temp.check(
  (select a.first_name from public.bookings b join public.athletes a on a.id=b.athlete_id
   where b.training_session_id=pg_temp.s1() and b.eligibility_narrowed_at is not null),
  'Tomáš', 'only the affected booking is marked (AC-173)');
select pg_temp.check(
  (select count(*)::text from public.notification_events where event_type='SESSION_ELIGIBILITY_NARROWED' and training_session_id=pg_temp.s1()),
  '1', 'one scoped event is queued (AC-174)');
select pg_temp.check(
  (select jsonb_array_length(payload -> 'affected_athlete_ids')::text from public.notification_events
   where event_type='SESSION_ELIGIBILITY_NARROWED' and training_session_id=pg_temp.s1()),
  '1', 'carrying only the affected athletes');
select pg_temp.check(
  (select count(*)::text from public.audit_log where action='SESSION_ELIGIBILITY_NARROWED' and entity_id=pg_temp.s1()),
  '1', 'and an audit entry (AC-175)');

\echo ''
\echo '── Close and reopen booking (BR-024) ───────────────────────────────'
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.set_session_booking_state(%L::uuid, false) -> 'data' ->> 'status')$$, pg_temp.s1())),
  'CLOSED', 'a coach can close booking');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.set_session_booking_state(%L::uuid, true) -> 'data' ->> 'status')$$, pg_temp.s1())),
  'OPEN', 'and reopen it');
select pg_temp.check(
  (select count(*)::text from public.audit_log where action in ('SESSION_BOOKING_CLOSED','SESSION_BOOKING_REOPENED') and entity_id=pg_temp.s1()),
  '2', 'both are audited');

\echo ''
\echo '── Duplicate ───────────────────────────────────────────────────────'
insert into t_ids (k, v)
select 'dup', (pg_temp.as_user(:COACH, format($$select (public.duplicate_training_session(%L::uuid, date '2026-11-01')
  -> 'data' ->> 'training_session_id')$$, pg_temp.s1())))::uuid;

create or replace function pg_temp.dup() returns uuid language sql stable as
  $$ select v from t_ids where k = 'dup' $$;

select pg_temp.check((select (v is not null)::text from t_ids where k='dup'),
  'true', 'a session can be duplicated');
select pg_temp.check(
  (select to_char(start_at at time zone 'Europe/Prague','YYYY-MM-DD HH24:MI') from public.training_sessions where id=pg_temp.dup()),
  '2026-11-01 08:00', 'onto a new date, keeping the local time across the DST boundary');
select pg_temp.check(
  (select count(*)::text from public.bookings where training_session_id=pg_temp.dup()),
  '0', 'bookings are never copied');
select pg_temp.check(
  (select (significant_changed_at is null)::text from public.training_sessions where id=pg_temp.dup()),
  'true', 'nor the change marker');
select pg_temp.check(
  (select count(*)::text from public.training_session_coaches where training_session_id=pg_temp.dup()),
  '1', 'the coach roster is copied');
select pg_temp.check(
  (select count(*)::text from public.audit_log where action='SESSION_DUPLICATED' and entity_id=pg_temp.dup()),
  '1', 'and it is audited');

\echo ''
\echo '── Cancellation is terminal (D-07, AC-070, AC-160..164) ────────────'
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.cancel_training_session(%L::uuid, 'Nemoc trenéra') -> 'data' ->> 'confirmed_at_cancellation')$$, pg_temp.s1())),
  '2', 'cancelling records how many were booked at that moment');
select pg_temp.check(
  (select status::text from public.training_sessions where id=pg_temp.s1()),
  'CANCELLED', 'the session is CANCELLED');
select pg_temp.check(
  (select count(*)::text from public.bookings where training_session_id=pg_temp.s1() and status='CONFIRMED'),
  '2', 'bookings are untouched, preserving the roster (AC-070a)');
select pg_temp.check(
  (select count(*)::text from public.notification_events where event_type='SESSION_CANCELLED' and training_session_id=pg_temp.s1()),
  '1', 'one cancellation event is queued');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.set_session_booking_state(%L::uuid, true) ->> 'code')$$, pg_temp.s1())),
  'SESSION_CANCELLED', 'it cannot be reopened (AC-160)');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.update_training_session(
    %L::uuid, date '2026-10-04', time '08:00', time '09:00', %L::uuid, 16, 'ALL') ->> 'code')$$, pg_temp.s1(), pg_temp.fac('VH'))),
  'SESSION_CANCELLED', 'nor edited');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.cancel_training_session(%L::uuid) ->> 'code')$$, pg_temp.s1())),
  'SESSION_CANCELLED', 'nor cancelled twice');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.duplicate_training_session(%L::uuid, date '2026-11-08') ->> 'ok')$$, pg_temp.s1())),
  'true', 'but it can be duplicated, which is the recovery path (AC-164)');

drop function pg_temp.as_user(text,text);
drop function pg_temp.check(text,text,text);
