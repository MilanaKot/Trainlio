-- Trainlio — statistics (handoff v3.5, decision 48, migration 47). Run after
-- the migrations and fixtures, on its own freshly created database. The
-- numbers are worked out by hand in the comment below (coach test 27,
-- AC-310; the refusals are AC-311).
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
\set ANNA   '''00000000-0000-0000-0000-0000000a0002'''


create or replace function pg_temp.ws() returns uuid language sql stable as
  $$ select id from public.workspaces limit 1 $$;
create or replace function pg_temp.stats(p_sub text, p_args text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform set_config('request.jwt.claim.sub', p_sub, true);
  perform set_config('role', 'authenticated', true);
  execute 'select public.workspace_statistics(' || p_args || ')' into r;
  perform set_config('role', 'none', true);
  return r;
end $$;
-- The window: the last thirty days and the next one.
create or replace function pg_temp.win() returns text language sql stable as
  $$ select format('%L::uuid, %L::timestamptz, %L::timestamptz', pg_temp.ws(),
                   now() - interval '30 days', now() + interval '1 day') $$;

-- S1 ten days ago (COACH, 10 places): Ivan Byl paid, Anna Nebyl unpaid,
-- Tomáš unmarked (ended, so Nebyl) paid.
-- S2 five days ago (COACH2 leads, COACH assists, 4 places): Ivan Byl unpaid,
-- Tomáš Byl paid.
-- S3 three days ago, cancelled: Ivan Byl paid — none of it counts.
-- S4 in two days (COACH): Anna booked — not held yet.
-- S5 yesterday (COACH, 6 places): Ivan Nebyl unpaid.
insert into public.training_sessions(id,workspace_id,sport_id,location_id,facility_id,main_coach_profile_id,
  start_at,end_at,capacity,status,created_by,eligibility_mode)
select v.id::uuid, w.id, w.primary_sport_id, l.id, f.id, v.coach::uuid,
       now() - v.ago, now() - v.ago + interval '1 hour', v.cap, 'OPEN', v.coach::uuid, 'ALL'
  from (values
    ('00000000-0000-0000-0000-0000000f5001', :COACH,  interval '10 days', 10),
    ('00000000-0000-0000-0000-0000000f5002', :COACH2, interval '5 days',  4),
    ('00000000-0000-0000-0000-0000000f5003', :COACH,  interval '3 days',  10),
    ('00000000-0000-0000-0000-0000000f5004', :COACH,  interval '-2 days', 8),
    ('00000000-0000-0000-0000-0000000f5005', :COACH,  interval '1 day',   6)) v(id, coach, ago, cap)
  cross join public.workspaces w
  join public.locations l on l.workspace_id = w.id
  join public.facilities f on f.location_id = l.id and f.code = 'MH';
insert into public.training_session_coaches(training_session_id,profile_id,role) values
  ('00000000-0000-0000-0000-0000000f5001', :COACH,  'MAIN'),
  ('00000000-0000-0000-0000-0000000f5002', :COACH2, 'MAIN'),
  ('00000000-0000-0000-0000-0000000f5002', :COACH,  'ASSISTANT'),
  ('00000000-0000-0000-0000-0000000f5003', :COACH,  'MAIN'),
  ('00000000-0000-0000-0000-0000000f5004', :COACH,  'MAIN'),
  ('00000000-0000-0000-0000-0000000f5005', :COACH,  'MAIN');
insert into public.bookings(training_session_id, athlete_id, created_by, created_by_role,
  attendance, attendance_at, attendance_by, paid_at, paid_by)
select v.s::uuid, v.a::uuid, :COACH, 'COACH',
       v.att::public.attendance_status, case when v.att is not null then now() end,
       case when v.att is not null then :COACH::uuid end,
       case when v.paid then now() end, case when v.paid then :COACH::uuid end
  from (values
    ('00000000-0000-0000-0000-0000000f5001', :IVAN,  'PRESENT', true),
    ('00000000-0000-0000-0000-0000000f5001', :ANNA,  'ABSENT',  false),
    ('00000000-0000-0000-0000-0000000f5001', :TOMAS, null,      true),
    ('00000000-0000-0000-0000-0000000f5002', :IVAN,  'PRESENT', false),
    ('00000000-0000-0000-0000-0000000f5002', :TOMAS, 'PRESENT', true),
    ('00000000-0000-0000-0000-0000000f5003', :IVAN,  'PRESENT', true),
    ('00000000-0000-0000-0000-0000000f5004', :ANNA,  null,      false),
    ('00000000-0000-0000-0000-0000000f5005', :IVAN,  'ABSENT',  false)) v(s, a, att, paid);
update public.training_sessions set status = 'CANCELLED', cancelled_at = now(), cancelled_by = :COACH
 where id = '00000000-0000-0000-0000-0000000f5003';

\echo ''
\echo '── The tiles (K20, coach test 27) ─────────────────────────────────'
select pg_temp.check(
  (select (d ->> 'sessions') || ' · ' || (d ->> 'booked') || '/' || (d ->> 'capacity') || ' · ' ||
          (d ->> 'present') || '/' || (d ->> 'marked') || ' · ' || (d ->> 'paid') || '/' || (d ->> 'bookings')
     from (select pg_temp.stats(:ADMIN, pg_temp.win()) -> 'data' as d) x),
  '3 · 6/20 · 3/6 · 3/6',
  'three held trainings, 6 of 20 places, 3 of 6 came, 3 of 6 paid — cancelled and future left out');
select pg_temp.check(
  (select string_agg((u ->> 'first_name') || ' ' || (u ->> 'count'), ', ' order by ord)
     from jsonb_array_elements(pg_temp.stats(:ADMIN, pg_temp.win()) -> 'data' -> 'unpaid')
          with ordinality as t(u, ord)),
  'Ivan 2, Anna 1', 'Nezaplaceno: by count, only held trainings');
select pg_temp.check(
  (select string_agg((u ->> 'first_name') || ' ' || (u ->> 'present') || '/' || (u ->> 'marked'), ', ')
     from jsonb_array_elements(pg_temp.stats(:ADMIN, pg_temp.win()) -> 'data' -> 'attendance') u),
  'Ivan 2/3', 'Nejnižší docházka: only athletes with at least three trainings');

\echo ''
\echo '── Filters (K20) ──────────────────────────────────────────────────'
select pg_temp.check(
  (select (d ->> 'sessions') || ' · ' || (d ->> 'present') || '/' || (d ->> 'marked') || ' · ' || (d ->> 'paid') || '/' || (d ->> 'bookings')
     from (select pg_temp.stats(:ADMIN, pg_temp.win() || ', 2017') -> 'data' as d) x),
  '3 · 2/3 · 1/3', 'born 2017: Ivan''s bookings and the trainings he was on');
select pg_temp.check(
  (select (d ->> 'sessions') || ' · ' || (d ->> 'booked') || '/' || (d ->> 'capacity')
     from (select pg_temp.stats(:ADMIN, pg_temp.win() || ', 2018') -> 'data' as d) x),
  '1 · 3/10', 'born 2018: one training, whose occupancy stays the whole training''s');
select pg_temp.check(
  (select (d ->> 'sessions') || ' · ' || (d ->> 'sessions_as_main')
     from (select pg_temp.stats(:ADMIN, pg_temp.win() || format(', null, %L::uuid', :COACH)) -> 'data' as d) x),
  '3 · 2', 'a coach''s trainings as main coach and assistant, and how many as main (K20b)');
select pg_temp.check(
  (select d ->> 'sessions'
     from (select pg_temp.stats(:ADMIN, pg_temp.win() || format(', null, %L::uuid, true', :COACH)) -> 'data' as d) x),
  '2', 'Jen hlavní: only those led');
select pg_temp.check(
  (select string_agg(l ->> 'booked' || '/' || (l ->> 'capacity') || ' ' || (l ->> 'present'), ', ')
     from jsonb_array_elements(
       pg_temp.stats(:ADMIN, pg_temp.win() || format(', null, %L::uuid, false, null, true', :COACH)) -> 'data' -> 'led') l),
  '1/6 0, 3/10 1', 'K20b lists the trainings led, newest first, with places and who came');
select pg_temp.check(
  (select sum((b ->> 'marked')::int)::text
     from jsonb_array_elements(
       pg_temp.stats(:ADMIN, pg_temp.win() || format(', null, %L::uuid, false, %L', :COACH, 'week')) -> 'data' -> 'buckets') b),
  '6', 'the weekly chart covers every booking counted');

\echo ''
\echo '── Who may read what (coach test 28) ──────────────────────────────'
select pg_temp.check(
  (select string_agg((c ->> 'name') || ' ' || (c ->> 'sessions') || ' ' || (c ->> 'present') || '/' || (c ->> 'marked'), ', ' order by c ->> 'name')
     from jsonb_array_elements(pg_temp.stats(:ADMIN, pg_temp.win()) -> 'data' -> 'coaches') c),
  'Trenér Dvořák 1 2/2, Trenér Novák 3 3/6', 'Trenéři: an administrator sees every coach');
select pg_temp.check(
  pg_temp.stats(:COACH, pg_temp.win()) -> 'data' ->> 'coaches', null,
  'a coach does not get the Trenéři block');
select pg_temp.check(
  pg_temp.stats(:COACH, pg_temp.win()) ->> 'ok', 'true', 'but does get the club''s numbers (K20)');
select pg_temp.check(
  pg_temp.stats(:COACH, pg_temp.win() || format(', null, %L::uuid, false, null, true', :COACH)) ->> 'ok', 'true',
  'and their own K20b');
select pg_temp.check(
  pg_temp.stats(:COACH, pg_temp.win() || format(', null, %L::uuid, false, null, true', :COACH2)) ->> 'code', 'NOT_AUTHORIZED',
  'and not a colleague''s');
select pg_temp.check(
  pg_temp.stats(:COACH, pg_temp.win() || format(', null, %L::uuid', :COACH2)) -> 'data' ->> 'sessions', '1',
  'though K20 filtered by that colleague is theirs to read');
select pg_temp.check(
  pg_temp.stats(:FAMA, pg_temp.win()) ->> 'code', 'NOT_AUTHORIZED', 'a parent reads no statistics at all');
