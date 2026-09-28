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
  $$ select id from public.workspaces where name like '%Příbram%' $$;
create or replace function pg_temp.fac(p_code text) returns uuid language sql stable as
  $$ select f.id from public.facilities f join public.locations l on l.id=f.location_id
     join public.workspaces w on w.id=l.workspace_id where f.code=p_code and w.name like '%Příbram%' $$;

create temp table t_ids (k text primary key, v uuid);

\echo '── Occurrence dates are local calendar dates ───────────────────────'
select pg_temp.check(
  (select count(*)::text from public.weekly_occurrence_dates(date '2026-10-04', date '2026-11-29', array[7])),
  '9', 'the PRD example generates nine Sundays');
select pg_temp.check(
  (select string_agg(to_char(d,'Dy'), ',') from public.weekly_occurrence_dates(date '2026-10-04', date '2026-11-29', array[7]) d),
  'Sun,Sun,Sun,Sun,Sun,Sun,Sun,Sun,Sun', 'every one falls on the requested weekday');
select pg_temp.check(
  (select min(d)::text from public.weekly_occurrence_dates(date '2026-10-01', date '2026-10-31', array[7]) d),
  '2026-10-04', 'generation starts at the first matching weekday on or after the start');
select pg_temp.check(
  (select count(*)::text from public.weekly_occurrence_dates(date '2026-10-05', date '2026-10-09', array[7])),
  '0', 'a range containing no matching weekday yields nothing');
select pg_temp.check(
  (select count(*)::text from public.weekly_occurrence_dates(date '2026-11-29', date '2026-10-04', array[7])),
  '0', 'an inverted range yields nothing');

\echo ''
\echo '── Generation (AC-080, AC-080a) ────────────────────────────────────'
insert into t_ids (k, v)
select 's', (pg_temp.as_user(:COACH, format($$select (public.create_session_series(
  %L::uuid, array[7], date '2026-10-04', date '2026-11-29', time '09:00', time '10:00', %L::uuid,
  null, 10, 'BIRTH_YEAR_RANGE', 2017, 2018, 'Šatna 4', 'Vezměte si chrániče.', 'Interní.')
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
  -- The window has to be computed before it can be aggregated; doing it in one
  -- step raises, and a raising case asserts nothing at all.
  (select count(distinct gap)::text from (
     select extract(epoch from (start_at - lag(start_at) over (order by start_at))) as gap
     from public.training_sessions where series_id = pg_temp.s()) x
   where gap is not null),
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
  (select by_weekdays::text || ' ' || local_start_time::text || ' ' || local_date_from::text
   from public.session_series where id = pg_temp.s()),
  '{7} 09:00:00 2026-10-04', 'and the pattern as local wall clock');
select pg_temp.check(
  (select excluded_dates::text from public.session_series where id = pg_temp.s()),
  '{}', 'a series created without exclusions records none');
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
    %L::uuid, array[7], date '2026-10-04', date '2026-10-11', time '09:00', time '10:00', %L::uuid) ->> 'code')$$,
    pg_temp.ws(), pg_temp.fac('MH'))),
  'NOT_AUTHORIZED', 'a guardian cannot create a series');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.create_session_series(
    %L::uuid, array[7], date '2026-10-05', date '2026-10-09', time '09:00', time '10:00', %L::uuid) ->> 'code')$$,
    pg_temp.ws(), pg_temp.fac('MH'))),
  'SERIES_EMPTY', 'a pattern matching no date is refused');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.create_session_series(
    %L::uuid, array[9], date '2026-10-04', date '2026-10-11', time '09:00', time '10:00', %L::uuid) ->> 'code')$$,
    pg_temp.ws(), pg_temp.fac('MH'))),
  'INVALID_WEEKDAY', 'an out-of-range weekday is refused');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.create_session_series(
    %L::uuid, array[7], date '2026-11-29', date '2026-10-04', time '09:00', time '10:00', %L::uuid) ->> 'code')$$,
    pg_temp.ws(), pg_temp.fac('MH'))),
  'INVALID_DATE_RANGE', 'an inverted date range is refused');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.create_session_series(
    %L::uuid, array[7], date '2026-10-04', date '2026-10-11', time '10:00', time '09:00', %L::uuid) ->> 'code')$$,
    pg_temp.ws(), pg_temp.fac('MH'))),
  'INVALID_TIME_RANGE', 'an end before the start is refused');

\echo ''
\echo '── Nothing persists when creation fails (AC-080b) ──────────────────'
-- A coach who is not staff of the workspace fails on the first occurrence's
-- MAIN coach row, after the series row and that session are already inserted.
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.create_session_series(
    %L::uuid, array[7], date '2027-01-03', date '2027-02-07', time '09:00', time '10:00', %L::uuid,
    null, 10, 'ALL', null, null, null, null, null, %L::uuid) ->> 'code')$$,
    pg_temp.ws(), pg_temp.fac('MH'), '00000000-0000-0000-0000-0000000fa000')),
  'COACH_NOT_WORKSPACE_STAFF', 'a coach who is not workspace staff is refused');
select pg_temp.check(
  (select count(*)::text from public.session_series where local_date_from = date '2027-01-03'),
  '0', 'and no series row is left behind');
select pg_temp.check(
  (select count(*)::text from public.training_sessions where start_at >= timestamptz '2027-01-01'),
  '0', 'nor any occurrence');

\echo ''
\echo '── Several weekdays in one pattern (coach/SPEC.md §K4b, §K11) ──────'
select pg_temp.check(
  (select string_agg(to_char(d,'Dy DD'), ', ' order by d)
   from public.weekly_occurrence_dates(date '2026-10-05', date '2026-10-18', array[1,3]) d),
  'Mon 05, Wed 07, Mon 12, Wed 14', 'a two-weekday pattern interleaves both weekdays in date order (AC-263)');
select pg_temp.check(
  (select count(*)::text from public.weekly_occurrence_dates(date '2026-10-05', date '2026-10-18', array[1,2,3,4,5,6,7])),
  '14', 'all seven weekdays give every day in the range');
select pg_temp.check(
  (select string_agg(to_char(d,'Dy'), ',' order by d)
   from public.weekly_occurrence_dates(date '2026-10-05', date '2026-10-18', array[3,1,1]) d),
  'Mon,Wed,Mon,Wed', 'a duplicated, unsorted weekday set means what it says');
select pg_temp.check(
  (select count(*)::text from public.weekly_occurrence_dates(date '2026-10-05', date '2026-10-18', array[]::integer[])),
  '0', 'an empty weekday set yields nothing');

insert into t_ids (k, v)
select 'm', (pg_temp.as_user(:COACH, format($$select (public.create_session_series(
  %L::uuid, array[3,1,1], date '2026-10-05', date '2026-10-18', time '17:00', time '18:00', %L::uuid)
  -> 'data' ->> 'session_series_id')$$, pg_temp.ws(), pg_temp.fac('VH'))))::uuid;

create or replace function pg_temp.m() returns uuid language sql stable as
  $$ select v from t_ids where k = 'm' $$;

select pg_temp.check(
  (select count(*)::text from public.training_sessions where series_id = pg_temp.m()),
  '4', 'the series creates one session per matching date');
select pg_temp.check(
  (select string_agg(to_char(start_at at time zone 'Europe/Prague', 'Dy DD'), ', ' order by start_at)
   from public.training_sessions where series_id = pg_temp.m()),
  'Mon 05, Wed 07, Mon 12, Wed 14', 'on the dates the pattern names');
select pg_temp.check(
  (select by_weekdays::text from public.session_series where id = pg_temp.m()),
  '{1,3}', 'and the stored pattern is canonical: sorted and de-duplicated (AC-263)');

\echo ''
\echo '── Per-date opt-out (coach/SPEC.md §K4b checklist) ─────────────────'
select pg_temp.check(
  (select string_agg(to_char(d,'DD'), ',' order by d)
   from public.weekly_occurrence_dates(date '2026-10-05', date '2026-10-18', array[1,3],
     array[date '2026-10-07', date '2026-10-12']) d),
  '05,14', 'excluded dates are subtracted from the pattern (AC-263)');
select pg_temp.check(
  (select count(*)::text from public.weekly_occurrence_dates(date '2026-10-05', date '2026-10-18', array[1,3],
     array[date '2026-10-06', date '2026-12-25'])),
  '4', 'an exclusion naming a date the pattern never produced changes nothing (AC-263)');
-- Regression: `x = any (array[..., null])` is null for a non-match, so a bare
-- coalesce would negate to null and suppress every date instead of none.
select pg_temp.check(
  (select count(*)::text from public.weekly_occurrence_dates(date '2026-10-05', date '2026-10-18', array[1,3],
     array[null, date '2026-10-07']::date[])),
  '3', 'a null element in the exclusion list suppresses nothing by itself');

insert into t_ids (k, v)
select 'x', (pg_temp.as_user(:COACH, format($$select (public.create_session_series(
  %L::uuid, array[1,3], date '2026-10-05', date '2026-10-18', time '19:00', time '20:00', %L::uuid,
  array[date '2026-10-07', date '2026-10-12', date '2026-10-06'])
  -> 'data' ->> 'session_series_id')$$, pg_temp.ws(), pg_temp.fac('VH'))))::uuid;

create or replace function pg_temp.x() returns uuid language sql stable as
  $$ select v from t_ids where k = 'x' $$;

select pg_temp.check(
  (select count(*)::text from public.training_sessions where series_id = pg_temp.x()),
  '2', 'only the dates the coach left checked are created (AC-263)');
select pg_temp.check(
  (select string_agg(to_char(start_at at time zone 'Europe/Prague', 'DD'), ',' order by start_at)
   from public.training_sessions where series_id = pg_temp.x()),
  '05,14', 'and they are the right ones');
-- Provenance, not input: the row records what was actually suppressed, so the
-- gaps in the generated sessions need not be re-derived by a reader.
select pg_temp.check(
  (select excluded_dates::text from public.session_series where id = pg_temp.x()),
  '{2026-10-07,2026-10-12}', 'the series records the suppressed pattern dates, and only those (AC-263)');
select pg_temp.check(
  (select generated_count::text from public.session_series where id = pg_temp.x()),
  '2', 'generated_count counts what was created, not what the pattern produced (AC-263)');
select pg_temp.check(
  (select (after ->> 'excluded_dates') from public.audit_log
   where action='SESSION_SERIES_CREATED' and entity_id = pg_temp.x()),
  '["2026-10-07", "2026-10-12"]', 'and the audit entry carries them too');
select pg_temp.check(
  (select (after ->> 'by_weekdays') from public.audit_log
   where action='SESSION_SERIES_CREATED' and entity_id = pg_temp.x()),
  '[1, 3]', 'together with the weekday set');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.create_session_series(
    %L::uuid, array[1,3], date '2026-10-05', date '2026-10-18', time '19:00', time '20:00', %L::uuid,
    array[date '2026-10-05', date '2026-10-07', date '2026-10-12', date '2026-10-14']) ->> 'code')$$,
    pg_temp.ws(), pg_temp.fac('VH'))),
  'SERIES_EMPTY', 'unchecking every date is refused rather than creating an empty series (AC-263)');

\echo ''
\echo '── The 52-occurrence ceiling (coach/SPEC.md §K4b) ──────────────────'
-- 2026-10-05 is a Monday; + 364 days is 2027-10-04, also a Monday, so the range
-- holds 53 Mondays while staying inside the 366-day span guard.
select pg_temp.check(
  (select count(*)::text from public.weekly_occurrence_dates(date '2026-10-05', date '2027-10-04', array[1])),
  '53', 'the range under test really does produce 53 occurrences');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.create_session_series(
    %L::uuid, array[1], date '2026-10-05', date '2027-10-04', time '06:00', time '07:00', %L::uuid) ->> 'code')$$,
    pg_temp.ws(), pg_temp.fac('MH'))),
  'SERIES_TOO_LONG', '53 occurrences are refused (AC-264)');
select pg_temp.check(
  (select count(*)::text from public.training_sessions
   where start_at >= timestamptz '2027-01-01' and series_id is not null),
  '0', 'and nothing is created when the ceiling is hit (AC-264)');
-- The ceiling counts what gets created, which is what the coach's footer says
-- ("Vytvořit {n} tréninků", n = checked), so unchecking one date makes it fit.
insert into t_ids (k, v)
select 'c', (pg_temp.as_user(:COACH, format($$select (public.create_session_series(
  %L::uuid, array[1], date '2026-10-05', date '2027-10-04', time '06:00', time '07:00', %L::uuid,
  array[date '2027-10-04']) -> 'data' ->> 'session_series_id')$$, pg_temp.ws(), pg_temp.fac('MH'))))::uuid;
select pg_temp.check(
  (select count(*)::text from public.training_sessions
   where series_id = (select v from t_ids where k='c')),
  '52', 'unchecking one date brings the same range down to the 52 that are allowed (AC-264)');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.create_session_series(
    %L::uuid, array[1,2,3,4,5,6,7], date '2026-10-05', date '2026-12-31', time '06:00', time '07:00', %L::uuid) ->> 'code')$$,
    pg_temp.ws(), pg_temp.fac('MH'))),
  'SERIES_TOO_LONG', 'seven weekdays over three months exceed the ceiling too (AC-264)');
-- Refused before generating, so an absurd range is never expanded. No series
-- the ceiling allows can reach this bound: 52 weekly occurrences span 357 days.
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.create_session_series(
    %L::uuid, array[1], date '2026-10-05', date '2030-10-05', time '06:00', time '07:00', %L::uuid) ->> 'code')$$,
    pg_temp.ws(), pg_temp.fac('MH'))),
  'SERIES_TOO_LONG', 'a range longer than a year is refused outright (AC-264)');

\echo ''
\echo '── Weekday sets that have no honest reading ────────────────────────'
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.create_session_series(
    %L::uuid, array[]::integer[], date '2026-10-05', date '2026-10-18', time '09:00', time '10:00', %L::uuid) ->> 'code')$$,
    pg_temp.ws(), pg_temp.fac('MH'))),
  'INVALID_WEEKDAY', 'an empty weekday set is refused (AC-263)');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.create_session_series(
    %L::uuid, null::integer[], date '2026-10-05', date '2026-10-18', time '09:00', time '10:00', %L::uuid) ->> 'code')$$,
    pg_temp.ws(), pg_temp.fac('MH'))),
  'INVALID_WEEKDAY', 'a null weekday set is refused');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.create_session_series(
    %L::uuid, array[0,3], date '2026-10-05', date '2026-10-18', time '09:00', time '10:00', %L::uuid) ->> 'code')$$,
    pg_temp.ws(), pg_temp.fac('MH'))),
  'INVALID_WEEKDAY', 'a set containing an out-of-range weekday is refused whole (AC-263)');
-- Dropping the null and creating a shorter series than the coach asked for
-- would be worse than refusing.
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.create_session_series(
    %L::uuid, array[3,null]::integer[], date '2026-10-05', date '2026-10-18', time '09:00', time '10:00', %L::uuid) ->> 'code')$$,
    pg_temp.ws(), pg_temp.fac('MH'))),
  'INVALID_WEEKDAY', 'a set containing a null element is refused, not silently narrowed (AC-263)');

\echo ''
\echo '── The stored pattern cannot be corrupted directly (BR-081) ────────'
select pg_temp.check(
  (select public.canonical_weekdays(array[7,1,1,3,null])::text),
  '{1,3,7}', 'canonical_weekdays sorts, de-duplicates and drops nulls');
select pg_temp.check(
  (select public.canonical_weekdays(null)::text),
  '{}', 'and maps null to the empty set');

\echo ''
\echo '── The client can decline an occurrence, never conjure one (AC-265) ─'
-- Structural, because this is the invariant the whole contract rests on: the
-- function takes a PATTERN and a list of dates to SKIP. There is no parameter
-- through which a client could name the dates to create, so no stale or edited
-- client can decide what exists.
select pg_temp.check(
  (select count(*)::text
   from pg_proc p, unnest(p.proargnames) n
   where p.proname = 'create_session_series'
     and p.pronamespace = 'public'::regnamespace
     and n in ('p_by_weekdays', 'p_excluded_dates')),
  '2', 'create_session_series takes the weekday set and the exclusions (AC-265)');
select pg_temp.check(
  (select (array_to_string(p.proargnames, ',')) from pg_proc p
   where p.proname = 'create_session_series' and p.pronamespace = 'public'::regnamespace),
  'p_workspace_id,p_by_weekdays,p_local_date_from,p_local_date_to,p_local_start_time,p_local_end_time,p_facility_id,p_excluded_dates,p_capacity,p_eligibility_mode,p_birth_year_from,p_birth_year_to,p_changing_room,p_public_notes,p_internal_notes,p_main_coach_profile_id,p_status',
  'and nothing that could name the dates to create (AC-265)');
-- The behavioural half of the same claim: an exclusion for a date outside the
-- pattern adds nothing, and the range still decides the outer bounds.
select pg_temp.check(
  (select count(*)::text from public.weekly_occurrence_dates(date '2026-10-05', date '2026-10-11', array[1],
     array[date '2026-10-19'])),
  '1', 'an exclusion cannot extend the series past its range (AC-265)');
select pg_temp.check(
  (select max(d)::text from public.weekly_occurrence_dates(date '2026-10-05', date '2026-10-11', array[1],
     array[date '2026-10-19']) d),
  '2026-10-05', 'and the only date produced is the one inside it (AC-265)');

drop function pg_temp.as_user(text,text);
drop function pg_temp.check(text,text,text);
