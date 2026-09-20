-- Trainlio — recurring series validation
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
\set A '''00000000-0000-0000-0000-0000000fa000'''

create or replace function pg_temp.ws() returns uuid language sql stable as
  $$ select id from public.workspaces where name like 'Příbram%' $$;
create or replace function pg_temp.fac(p_code text) returns uuid language sql stable as
  $$ select f.id from public.facilities f join public.locations l on l.id=f.location_id
     join public.workspaces w on w.id=l.workspace_id where f.code=p_code and w.name like 'Příbram%' $$;

create temp table t_ids (k text primary key, v uuid);

\echo '── Occurrence dates are local calendar dates ───────────────────────'
select pg_temp.check(
  (select count(*)::text from public.weekly_occurrence_dates(date '2026-10-04', date '2026-11-29', 7)),
  '9', 'the PRD example generates nine Sundays');
select pg_temp.check(
  (select string_agg(to_char(d,'Dy'), ',') from public.weekly_occurrence_dates(date '2026-10-04', date '2026-11-29', 7) d),
  'Sun,Sun,Sun,Sun,Sun,Sun,Sun,Sun,Sun', 'every one falls on the requested weekday');
select pg_temp.check(
  (select min(d)::text from public.weekly_occurrence_dates(date '2026-10-01', date '2026-10-31', 7)),
  '2026-10-04', 'generation starts at the first matching weekday on or after the start');
select pg_temp.check(
  (select count(*)::text from public.weekly_occurrence_dates(date '2026-10-05', date '2026-10-09', 7)),
  '0', 'a range containing no matching weekday yields nothing');
select pg_temp.check(
  (select count(*)::text from public.weekly_occurrence_dates(date '2026-11-29', date '2026-10-04', 7)),
  '0', 'an inverted range yields nothing');

\echo ''
\echo '── Generation (AC-080, AC-080a) ────────────────────────────────────'
insert into t_ids (k, v)
select 's', (pg_temp.as_user(:COACH, format($$select (public.create_session_series(
  %L::uuid, 7, date '2026-10-04', date '2026-11-29', time '09:00', time '10:00', %L::uuid,
  10, 'BIRTH_YEAR_RANGE', 2017, 2018, 'Šatna 4', 'Vezměte si chrániče.', 'Interní.')
  -> 'data' ->> 'session_series_id')$$, pg_temp.ws(), pg_temp.fac('MH'))))::uuid;

create or replace function pg_temp.s() returns uuid language sql stable as
  $$ select v from t_ids where k = 's' $$;

select pg_temp.check((select (v is not null)::text from t_ids where k='s'),
  'true', 'a coach can create a series');
select pg_temp.check(
  (select count(*)::text from public.training_sessions where series_id = pg_temp.s()),
  '9', 'nine independent session rows are created (AC-080)');
select pg_temp.check(
  (select generated_count::text from public.session_series where id = pg_temp.s()),
  '9', 'and the series records how many');

-- The case this whole migration exists for. Czech DST ends 25 October 2026,
-- itself an occurrence date; a fixed seven-day interval would put the last six
-- occurrences at 08:00.
select pg_temp.check(
  (select count(distinct to_char(start_at at time zone 'Europe/Prague', 'HH24:MI'))::text
   from public.training_sessions where series_id = pg_temp.s()),
  '1', 'every occurrence has the same local start time across the DST boundary (AC-080a)');
select pg_temp.check(
  (select distinct to_char(start_at at time zone 'Europe/Prague', 'HH24:MI')
   from public.training_sessions where series_id = pg_temp.s()),
  '09:00', 'and it is the time the coach typed');
select pg_temp.check(
  (select count(distinct extract(epoch from (start_at - lag(start_at) over (order by start_at))))::text
   from (select start_at from public.training_sessions where series_id = pg_temp.s()) x),
  '2', 'the absolute gap between occurrences is NOT uniform, which is the point');
select pg_temp.check(
  (select to_char(start_at at time zone 'Europe/Prague', 'YYYY-MM-DD HH24:MI')
   from public.training_sessions where series_id = pg_temp.s() order by start_at limit 1),
  '2026-10-04 09:00', 'the first occurrence is on the start date');
select pg_temp.check(
  (select to_char(start_at at time zone 'Europe/Prague', 'YYYY-MM-DD HH24:MI')
   from public.training_sessions where series_id = pg_temp.s() order by start_at desc limit 1),
  '2026-11-29 09:00', 'the last is on or before the end date');

\echo ''
\echo '── Provenance (AC-080c) ────────────────────────────────────────────'
select pg_temp.check(
  (select generated_in_timezone from public.session_series where id = pg_temp.s()),
  'Europe/Prague', 'the series records the timezone it was generated under');
select pg_temp.check(
  (select (generated_at is not null)::text from public.session_series where id = pg_temp.s()),
  'true', 'and when');
select pg_temp.check(
  (select by_weekday::text || ' ' || local_start_time::text || ' ' || local_date_from::text
   from public.session_series where id = pg_temp.s()),
  '7 09:00:00 2026-10-04', 'and the pattern as local wall clock');
select pg_temp.check(
  (select count(*)::text from public.training_sessions where series_id = pg_temp.s()),
  '9', 'every generated session references its series');
select pg_temp.check(
  (select count(*)::text from public.audit_log where action='SESSION_SERIES_CREATED' and entity_id = pg_temp.s()),
  '1', 'creation is audited');
select pg_temp.check(
  (select count(*)::text from public.training_session_coaches c
   join public.training_sessions s on s.id = c.training_session_id where s.series_id = pg_temp.s()),
  '9', 'each occurrence gets its MAIN coach row');
select pg_temp.check(
  (select count(*)::text from public.training_session_internal_notes n
   join public.training_sessions s on s.id = n.training_session_id where s.series_id = pg_temp.s()),
  '9', 'and the internal note');
select pg_temp.check(
  (select count(*)::text from public.training_session_occupancy o
   join public.training_sessions s on s.id = o.training_session_id where s.series_id = pg_temp.s()),
  '9', 'and an occupancy row, by trigger');

\echo ''
\echo '── Occurrences are independent (BR-081, AC-081, AC-082) ────────────'
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.cancel_training_session(
    (select id from public.training_sessions where series_id=%L::uuid order by start_at limit 1)) ->> 'ok')$$, pg_temp.s())),
  'true', 'one occurrence can be cancelled');
select pg_temp.check(
  (select count(*)::text from public.training_sessions where series_id = pg_temp.s() and status='CANCELLED'),
  '1', 'and only that one is cancelled (AC-081)');
select pg_temp.check(
  (select count(*)::text from public.training_sessions where series_id = pg_temp.s() and status='OPEN'),
  '8', 'its siblings are untouched');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.update_training_session(
    (select id from public.training_sessions where series_id=%L::uuid and status='OPEN' order by start_at limit 1),
    date '2026-10-11', time '07:30', time '08:30', %L::uuid, 20, 'ALL') ->> 'ok')$$,
    pg_temp.s(), pg_temp.fac('VH'))),
  'true', 'one occurrence can be edited');
select pg_temp.check(
  (select count(*)::text from public.training_sessions where series_id = pg_temp.s() and capacity = 10),
  '8', 'and only that one changes (AC-082)');
select pg_temp.check(
  (select count(distinct capacity)::text from public.training_sessions where series_id = pg_temp.s()),
  '2', 'so the series now holds two capacities');
select pg_temp.check(
  (select generated_count::text from public.session_series where id = pg_temp.s()),
  '9', 'the series record is provenance and does not follow the edits');

\echo ''
\echo '── Refusals ────────────────────────────────────────────────────────'
select pg_temp.check(
  pg_temp.as_user(:A, format($$select (public.create_session_series(
    %L::uuid, 7, date '2026-10-04', date '2026-10-11', time '09:00', time '10:00', %L::uuid) ->> 'code')$$,
    pg_temp.ws(), pg_temp.fac('MH'))),
  'NOT_AUTHORIZED', 'a guardian cannot create a series');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.create_session_series(
    %L::uuid, 7, date '2026-10-05', date '2026-10-09', time '09:00', time '10:00', %L::uuid) ->> 'code')$$,
    pg_temp.ws(), pg_temp.fac('MH'))),
  'SERIES_EMPTY', 'a pattern matching no date is refused');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.create_session_series(
    %L::uuid, 9, date '2026-10-04', date '2026-10-11', time '09:00', time '10:00', %L::uuid) ->> 'code')$$,
    pg_temp.ws(), pg_temp.fac('MH'))),
  'INVALID_WEEKDAY', 'an out-of-range weekday is refused');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.create_session_series(
    %L::uuid, 7, date '2026-11-29', date '2026-10-04', time '09:00', time '10:00', %L::uuid) ->> 'code')$$,
    pg_temp.ws(), pg_temp.fac('MH'))),
  'INVALID_DATE_RANGE', 'an inverted date range is refused');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.create_session_series(
    %L::uuid, 7, date '2026-10-04', date '2026-10-11', time '10:00', time '09:00', %L::uuid) ->> 'code')$$,
    pg_temp.ws(), pg_temp.fac('MH'))),
  'INVALID_TIME_RANGE', 'an end before the start is refused');

\echo ''
\echo '── Nothing persists when creation fails (AC-080b) ──────────────────'
-- A coach who is not staff of the workspace fails on the first occurrence's
-- MAIN coach row, after the series row and that session are already inserted.
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.create_session_series(
    %L::uuid, 7, date '2027-01-03', date '2027-02-07', time '09:00', time '10:00', %L::uuid,
    10, 'ALL', null, null, null, null, null, %L::uuid) ->> 'code')$$,
    pg_temp.ws(), pg_temp.fac('MH'), '00000000-0000-0000-0000-0000000fa000')),
  'COACH_NOT_WORKSPACE_STAFF', 'a coach who is not workspace staff is refused');
select pg_temp.check(
  (select count(*)::text from public.session_series where local_date_from = date '2027-01-03'),
  '0', 'and no series row is left behind');
select pg_temp.check(
  (select count(*)::text from public.training_sessions where start_at >= timestamptz '2027-01-01'),
  '0', 'nor any occurrence');

drop function pg_temp.as_user(text,text);
drop function pg_temp.check(text,text,text);
