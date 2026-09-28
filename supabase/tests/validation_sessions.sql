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
  $$ select id from public.workspaces where name like '%Příbram%' $$;
create or replace function pg_temp.fac(p_code text) returns uuid language sql stable as
  $$ select f.id from public.facilities f join public.locations l on l.id=f.location_id
     join public.workspaces w on w.id=l.workspace_id where f.code=p_code and w.name like '%Příbram%' $$;
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
select pg_temp.check(
  (select (significant_change is null)::text from public.training_sessions where id=pg_temp.s1()),
  'true', 'and nothing is recorded for a parent to read (AC-269)');
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
  (select significant_change -> 'fields' ->> 0 from public.training_sessions where id=pg_temp.s1()),
  'TIME', 'the record names the time, not the date, when only the clock moved (AC-269)');
select pg_temp.check(
  (select to_char((significant_change -> 'previous' ->> 'start_at')::timestamptz
                    at time zone 'Europe/Prague', 'YYYY-MM-DD HH24:MI')
     from public.training_sessions where id=pg_temp.s1()),
  '2026-10-04 09:00', 'and carries the wall clock it used to be (AC-269)');
select pg_temp.check(
  (select ((significant_change ->> 'changed_at')::timestamptz = significant_changed_at)::text
     from public.training_sessions where id=pg_temp.s1()),
  'true', 'stamped with the change it describes (AC-269)');

select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.update_training_session(
    %L::uuid, date '2026-10-04', time '08:00', time '09:00', %L::uuid, 16, 'BIRTH_YEAR_RANGE', 2016, 2018)
    -> 'data' -> 'events' ->> 0)$$, pg_temp.s1(), pg_temp.fac('VH'))),
  'SESSION_FACILITY_CHANGED', 'MH to VH is significant (AC-190)');
-- Replaced, not accumulated: only the latest change is drawn, and the earlier
-- one reached the parent by e-mail when it happened.
select pg_temp.check(
  (select significant_change ->> 'fields' from public.training_sessions where id=pg_temp.s1()),
  '["FACILITY"]', 'a later change replaces the record rather than adding to it (AC-269)');
select pg_temp.check(
  (select significant_change -> 'previous' ->> 'facility_code' from public.training_sessions where id=pg_temp.s1()),
  'MH', 'naming the hall it used to be (AC-269)');
select pg_temp.check(
  (select (significant_change -> 'previous' ? 'start_at')::boolean::text from public.training_sessions where id=pg_temp.s1()),
  'false', 'and nothing from the change before it (AC-269)');

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
-- The mirror column moves in a *second* statement, after the row update that
-- stamped the marker. Detection inside the function would compare a mirror
-- that has not moved yet and miss every coach change.
select pg_temp.check(
  (select significant_change ->> 'fields' from public.training_sessions where id=pg_temp.s1()),
  '["MAIN_COACH"]', 'a coach change is recorded although the mirror moves later (AC-269)');
select pg_temp.check(
  (select significant_change -> 'previous' ->> 'main_coach_name' from public.training_sessions where id=pg_temp.s1()),
  'Trenér Novák', 'naming the coach it used to be (AC-269)');

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

\echo ''
\echo '── Assistant coaches (AC-261, AC-262) ───────────────────────────────'
-- The schema has held assistants since the first migration and nothing could
-- write one, so every "Asistenti" row has been empty from the beginning.
-- Its own session: by this point in the suite s1 has been cancelled, and D-07
-- makes that terminal, so every call below would refuse for the wrong reason.
insert into t_ids (k, v)
select 'sa', (pg_temp.as_user(:COACH, format($$select (public.create_training_session(
    %L::uuid, date '2026-11-08', time '09:00', time '10:00', %L::uuid, 10, 'ALL')
    -> 'data' ->> 'training_session_id')$$, pg_temp.ws(), pg_temp.fac('MH'))))::uuid;
create or replace function pg_temp.sa() returns uuid language sql stable as
  $$ select v from t_ids where k = 'sa' $$;

create or replace function pg_temp.assistants(p_session uuid) returns text language sql stable as
  $$ select coalesce(string_agg(p.display_name, ', ' order by p.display_name), '(none)')
       from public.training_session_coaches c
       join public.app_profiles p on p.id = c.profile_id
      where c.training_session_id = p_session and c.role = 'ASSISTANT' $$;

select pg_temp.check(pg_temp.assistants(pg_temp.sa()), '(none)',
  'a new session starts with no assistants (AC-261)');

select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.set_session_assistants(%L::uuid,
    array[%L::uuid]) ->> 'ok')$$, pg_temp.sa(), :COACH2)),
  'true', 'a coach adds an assistant (AC-261)');
select pg_temp.check(pg_temp.assistants(pg_temp.sa()), 'Trenér Dvořák',
  'who is on the session (AC-261)');

-- Replace, not add: the sheet shows a list and Hotovo means "this is the list".
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.set_session_assistants(%L::uuid,
    array[%L::uuid]) ->> 'ok')$$, pg_temp.sa(), :WSADMIN)),
  'true', 'setting a different list replaces it rather than adding to it (AC-261)');
select pg_temp.check(pg_temp.assistants(pg_temp.sa()), 'Workspace Admin',
  'so the previous assistant is gone (AC-261)');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.set_session_assistants(%L::uuid,
    array[]::uuid[]) ->> 'ok')$$, pg_temp.sa())),
  'true', 'and an empty list clears them (AC-261)');
select pg_temp.check(pg_temp.assistants(pg_temp.sa()), '(none)',
  'leaving nobody (AC-261)');

-- §K3b shows the main coach disabled: one person, one role on one training.
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.set_session_assistants(%L::uuid,
    array[%L::uuid]) ->> 'code')$$, pg_temp.sa(), :COACH)),
  'MAIN_COACH_AS_ASSISTANT', 'the main coach cannot also assist (AC-261)');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.set_session_assistants(%L::uuid,
    array[%L::uuid]) ->> 'code')$$, pg_temp.sa(), :A)),
  'COACH_NOT_WORKSPACE_STAFF', 'and a guardian is not an assistant (AC-261)');
select pg_temp.check(
  pg_temp.as_user(:A, format($$select (public.set_session_assistants(%L::uuid,
    array[%L::uuid]) ->> 'code')$$, pg_temp.sa(), :COACH2)),
  'NOT_AUTHORIZED', 'nor may a guardian set them (AC-261)');

-- Duplicates and nulls: the sheet cannot send them, something else can.
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.set_session_assistants(%L::uuid,
    array[%L::uuid, %L::uuid, null]) -> 'data' ->> 'assistant_count')$$,
    pg_temp.sa(), :COACH2, :COACH2)),
  '1', 'a repeated id counts once and a null is dropped (AC-261)');

\echo ''
\echo '── Promoting an assistant to main coach (AC-262) ────────────────────'
-- §K3c: a coach who is currently an assistant may be made main coach. Before
-- this migration the main-coach write collided with the assistant row the same
-- person held, and the whole call failed with an unhandled error — unreachable
-- only because nothing could create an assistant in the first place.
select pg_temp.check(pg_temp.assistants(pg_temp.sa()), 'Trenér Dvořák',
  'the assistant is in place before the promotion (AC-262)');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.update_training_session(
    %L::uuid, date '2026-11-08', time '09:00', time '10:00', %L::uuid,
    10, 'ALL', null, null, null, null, null, %L::uuid) ->> 'ok')$$,
    pg_temp.sa(), pg_temp.fac('MH'), :COACH2)),
  'true', 'promoting them to main coach succeeds (AC-262)');
select pg_temp.check(
  (select display_name from public.app_profiles p
     join public.training_sessions s on s.main_coach_profile_id = p.id
    where s.id = pg_temp.sa()),
  'Trenér Dvořák', 'they lead the session (AC-262)');
select pg_temp.check(pg_temp.assistants(pg_temp.sa()), '(none)',
  'and they are no longer listed among the assistants (AC-262)');

\echo ''
\echo '── Who a parent sees on the session (AC-262) ────────────────────────'
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.set_session_assistants(%L::uuid,
    array[%L::uuid]) ->> 'ok')$$, pg_temp.sa(), :WSADMIN)),
  'true', 'an assistant is set again for the guardian cases (AC-262)');
select pg_temp.check(
  pg_temp.as_user(:A, format($$select string_agg(display_name || ':' || role, ' ' order by role)
    from public.session_coaches(%L::uuid)$$, pg_temp.sa())),
  'Trenér Dvořák:MAIN Workspace Admin:ASSISTANT',
  'a guardian reads the main coach and the assistants, in that order (AC-262, D-11)');
select pg_temp.check(
  pg_temp.as_user('00000000-0000-0000-0000-0000005f4a46',
    format($$select count(*)::text from public.session_coaches(%L::uuid)$$, pg_temp.sa())),
  '0', 'someone with no relationship to the club reads nobody (AC-262)');

-- Not an e-mail: the training is at the same time, in the same hall, with the
-- same main coach (coach/SPEC.md §4). Measured as a difference, so the
-- assertion is about this call and not about everything the suite did before.
create temp table t_counts (k text primary key, n bigint);
insert into t_counts values
  ('events', (select count(*) from public.notification_events where training_session_id = pg_temp.sa())),
  ('audit', (select count(*) from public.audit_log
              where action = 'SESSION_ASSISTANTS_CHANGED' and entity_id = pg_temp.sa()));

-- A change that moves something: one audit entry, no e-mail.
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.set_session_assistants(%L::uuid,
    array[]::uuid[]) ->> 'ok')$$, pg_temp.sa())),
  'true', 'the assistants are cleared (AC-262)');
select pg_temp.check(
  (select (count(*) - (select n from t_counts where k = 'events'))::text
     from public.notification_events where training_session_id = pg_temp.sa()),
  '0', 'changing the assistants notifies nobody (AC-262)');
select pg_temp.check(
  (select (count(*) - (select n from t_counts where k = 'audit'))::text
     from public.audit_log
    where action = 'SESSION_ASSISTANTS_CHANGED' and entity_id = pg_temp.sa()),
  '1', 'but it is on the record (AC-262)');

-- And one that moves nothing: silence, so the log stays readable.
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.set_session_assistants(%L::uuid,
    array[]::uuid[]) ->> 'ok')$$, pg_temp.sa())),
  'true', 'setting the same list again succeeds (AC-262)');
select pg_temp.check(
  (select (count(*) - (select n from t_counts where k = 'audit'))::text
     from public.audit_log
    where action = 'SESSION_ASSISTANTS_CHANGED' and entity_id = pg_temp.sa()),
  '1', 'and writes no second entry, because nothing moved (AC-262)');

\echo ''
\echo '── One change that moves several things (AC-269) ───────────────────'
insert into t_ids (k, v)
select 'sc', (pg_temp.as_user(:COACH, format($$select (public.create_training_session(
  %L::uuid, date '2027-03-07', time '09:00', time '10:00', %L::uuid, 10, 'ALL')
  -> 'data' ->> 'training_session_id')$$, pg_temp.ws(), pg_temp.fac('MH'))))::uuid;

create or replace function pg_temp.sc() returns uuid language sql stable as
  $$ select v from t_ids where k = 'sc' $$;

select pg_temp.check(
  (select (significant_change is null)::text from public.training_sessions where id=pg_temp.sc()),
  'true', 'a session nobody has changed carries no record (AC-269)');

-- Date, time and hall in one call, and the coach with them: four differences,
-- two statements, one change.
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.update_training_session(
    %L::uuid, date '2027-03-14', time '17:30', time '18:30', %L::uuid, 10, 'ALL',
    null, null, null, null, null, %L::uuid) ->> 'ok')$$,
    pg_temp.sc(), pg_temp.fac('VH'), '00000000-0000-0000-0000-00000000c0ad')),
  'true', 'a coach moves the date, the time, the hall and themselves at once');
select pg_temp.check(
  (select significant_change ->> 'fields' from public.training_sessions where id=pg_temp.sc()),
  '["DATE", "FACILITY", "MAIN_COACH", "TIME"]',
  'every field that moved is named once, in one record (AC-269)');
select pg_temp.check(
  (select to_char((significant_change -> 'previous' ->> 'start_at')::timestamptz
                    at time zone 'Europe/Prague', 'YYYY-MM-DD HH24:MI')
     from public.training_sessions where id=pg_temp.sc()),
  '2027-03-07 09:00', 'with the wall clock it used to be (AC-269)');
select pg_temp.check(
  (select to_char((significant_change -> 'previous' ->> 'end_at')::timestamptz
                    at time zone 'Europe/Prague', 'HH24:MI')
     from public.training_sessions where id=pg_temp.sc()),
  '10:00', 'both ends of it (AC-269)');
select pg_temp.check(
  (select significant_change -> 'previous' ->> 'facility_code' from public.training_sessions where id=pg_temp.sc()),
  'MH', 'the hall it used to be (AC-269)');
select pg_temp.check(
  (select significant_change -> 'previous' ->> 'main_coach_name' from public.training_sessions where id=pg_temp.sc()),
  'Trenér Novák', 'and the coach it used to be (AC-269)');
select pg_temp.check(
  (select ((significant_change ->> 'changed_at')::timestamptz = significant_changed_at)::text
     from public.training_sessions where id=pg_temp.sc()),
  'true', 'all under one timestamp, because it was one change (AC-269)');

-- The record is guardian-visible data, so it must never carry anything a
-- parent may not read (D-13).
select pg_temp.check(
  (select (significant_change::text like '%nterní%')::text from public.training_sessions where id=pg_temp.sc()),
  'false', 'and nothing a parent may not read (AC-269, D-13)');

-- A change that is not significant leaves the record where it was, rather than
-- clearing what the parent has not seen yet.
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.update_training_session(
    %L::uuid, date '2027-03-14', time '17:30', time '18:30', %L::uuid, 20, 'ALL',
    null, null, 'Šatna 9', null, null, %L::uuid) -> 'data' ->> 'significant')$$,
    pg_temp.sc(), pg_temp.fac('VH'), '00000000-0000-0000-0000-00000000c0ad')),
  'false', 'a capacity and changing-room change is not significant');
select pg_temp.check(
  (select significant_change ->> 'fields' from public.training_sessions where id=pg_temp.sc()),
  '["DATE", "FACILITY", "MAIN_COACH", "TIME"]',
  'and leaves the record a parent has not read yet alone (AC-269)');

drop function pg_temp.as_user(text,text);
drop function pg_temp.check(text,text,text);
