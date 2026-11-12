-- Trainlio — a coach leaves, and their future trainings wait for a new one
-- (A3f, K2e, decision 46). Run after the migrations and fixtures, on its own
-- freshly created database.
--
-- Until v3.4 the administrator either took the trainings over or left the
-- departed coach's name on them (DR-15, D-25). The design settled it the
-- other way: after a warning, the trainings that are still to come are left
-- without a main coach until somebody is assigned, and parents read `Trenér
-- bude upřesněn`. These cases are about what that does, what never moves, and
-- who may edit a training nobody leads.
--
-- Its own database rather than a section of validation_staff.sql: that suite
-- deactivates the administrator halfway through to prove the club keeps one
-- (AC-250), and this needs an administrator who is still there.
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

create or replace function pg_temp.ws() returns uuid language sql stable as
  $$ select id from public.workspaces limit 1 $$;

\set COACH  '''00000000-0000-0000-0000-00000000c0ac'''
\set ADMIN  '''00000000-0000-0000-0000-00000000ad11'''
\set A      '''00000000-0000-0000-0000-0000000fa000'''

-- The fixture training is in thirty days and belongs to Trenér Novák. Two more
-- of his, inserted while he is still staff because a training's main coach has
-- to be: one that has happened, one that was called off. Neither is anybody's
-- to move.
insert into public.training_sessions(id,workspace_id,sport_id,location_id,facility_id,
  main_coach_profile_id,start_at,end_at,capacity,status,created_by,eligibility_mode,changing_room)
 select '00000000-0000-0000-0000-0000000e0901', w.id, w.primary_sport_id, l.id, f.id,
   '00000000-0000-0000-0000-00000000c0ac', now()-interval '2 days', now()-interval '2 days'+interval '1 hour',
   10,'OPEN','00000000-0000-0000-0000-00000000c0ac','ALL','Šatna 9'
 from public.workspaces w join public.locations l on l.workspace_id=w.id
   join public.facilities f on f.location_id=l.id and f.code='MH';
insert into public.training_session_coaches(training_session_id,profile_id,role)
 values ('00000000-0000-0000-0000-0000000e0901','00000000-0000-0000-0000-00000000c0ac','MAIN');

insert into public.training_sessions(id,workspace_id,sport_id,location_id,facility_id,
  main_coach_profile_id,start_at,end_at,capacity,status,created_by,eligibility_mode,changing_room,
  cancelled_at,cancelled_by)
 select '00000000-0000-0000-0000-0000000e0902', w.id, w.primary_sport_id, l.id, f.id,
   '00000000-0000-0000-0000-00000000c0ac', now()+interval '10 days', now()+interval '10 days 1 hour',
   10,'CANCELLED','00000000-0000-0000-0000-00000000c0ac','ALL','Šatna 10',
   now(),'00000000-0000-0000-0000-00000000c0ac'
 from public.workspaces w join public.locations l on l.workspace_id=w.id
   join public.facilities f on f.location_id=l.id and f.code='MH';
insert into public.training_session_coaches(training_session_id,profile_id,role)
 values ('00000000-0000-0000-0000-0000000e0902','00000000-0000-0000-0000-00000000c0ac','MAIN');

-- A future training the administrator leads and Novák assists on: he leaves
-- that one too.
insert into public.training_sessions(id,workspace_id,sport_id,location_id,facility_id,
  main_coach_profile_id,start_at,end_at,capacity,status,created_by,eligibility_mode,changing_room)
 select '00000000-0000-0000-0000-0000000e0903', w.id, w.primary_sport_id, l.id, f.id,
   '00000000-0000-0000-0000-00000000ad11', now()+interval '12 days', now()+interval '12 days 1 hour',
   10,'OPEN','00000000-0000-0000-0000-00000000ad11','ALL','Šatna 3'
 from public.workspaces w join public.locations l on l.workspace_id=w.id
   join public.facilities f on f.location_id=l.id and f.code='MH';
insert into public.training_session_coaches(training_session_id,profile_id,role)
 values ('00000000-0000-0000-0000-0000000e0903','00000000-0000-0000-0000-00000000ad11','MAIN'),
        ('00000000-0000-0000-0000-0000000e0903','00000000-0000-0000-0000-00000000c0ac','ASSISTANT');

-- K3c on a training without a main coach: everything as it is, the coach new.
create or replace function pg_temp.assign_sql(p_session uuid, p_coach uuid)
returns text language sql stable as $f$
  select format(
    'select public.update_training_session(%L::uuid, %L::date, %L::time, %L::time, %L::uuid, %s, %L, %L, %L, %L, %L, null, %L::uuid, true, true)',
    s.id, (s.start_at at time zone 'Europe/Prague')::date,
    (s.start_at at time zone 'Europe/Prague')::time, (s.end_at at time zone 'Europe/Prague')::time,
    s.facility_id, s.capacity, s.eligibility_mode, s.birth_year_from, s.birth_year_to,
    s.changing_room, s.public_notes, p_coach)
  from public.training_sessions s where s.id = p_session
$f$;

\echo ''
\echo '── The warning comes first (A3f, AC-251) ────────────────────────────'
select pg_temp.check(
  pg_temp.as_user(:ADMIN, $$select public.set_member_active(pg_temp.ws(),
    '00000000-0000-0000-0000-00000000c0ac'::uuid, false) ->> 'code'$$),
  'LEADS_FUTURE_SESSIONS', 'the administrator is warned before anything happens (A3f)');
select pg_temp.check(
  pg_temp.as_user(:ADMIN, $$select public.set_member_active(pg_temp.ws(),
    '00000000-0000-0000-0000-00000000c0ac'::uuid, false) -> 'details' ->> 'future_sessions'$$),
  '1', 'it counts only the trainings he leads that are still to come (A3f)');
select pg_temp.check(
  pg_temp.as_user(:ADMIN, $$select public.set_member_active(pg_temp.ws(),
    '00000000-0000-0000-0000-00000000c0ac'::uuid, false) -> 'details' -> 'sessions' -> 0 ->> 'id'$$),
  '00000000-0000-0000-0000-0000000e0001', 'and lists them for the sheet (A3f)');
select pg_temp.check(
  pg_temp.as_user(:ADMIN, $$select public.set_member_active(pg_temp.ws(),
    '00000000-0000-0000-0000-00000000c0ac'::uuid, false) -> 'details' -> 'sessions' -> 0 ->> 'facility_code'$$),
  'MH', 'with the hall the sheet prints (A3f)');
select pg_temp.check(
  (select main_coach_profile_id::text from public.training_sessions
    where id = '00000000-0000-0000-0000-0000000e0001'),
  '00000000-0000-0000-0000-00000000c0ac', 'nothing moved while the warning stood (A3f)');

\echo ''
\echo '── Deactivating leaves them without a main coach (A3f, K2e) ─────────'
select pg_temp.check(
  pg_temp.as_user(:ADMIN, $$select public.set_member_active(pg_temp.ws(),
    '00000000-0000-0000-0000-00000000c0ac'::uuid, false, true) ->> 'vacated_sessions'$$),
  '1', 'confirming leaves the future training without a main coach (A3f)');
select pg_temp.check(
  (select (main_coach_profile_id is null)::text from public.training_sessions
    where id = '00000000-0000-0000-0000-0000000e0001'),
  'true', 'the mirror column is empty (K2e)');
select pg_temp.check(
  (select count(*)::text from public.training_session_coaches
    where training_session_id = '00000000-0000-0000-0000-0000000e0001' and role = 'MAIN'),
  '0', 'and so is the association table (K2e)');
select pg_temp.check(
  (select main_coach_vacated_from::text || ' · ' || (main_coach_vacated_at is not null)::text
     from public.training_sessions where id = '00000000-0000-0000-0000-0000000e0001'),
  '00000000-0000-0000-0000-00000000c0ac · true', 'K2e can say who left and when (K2e)');
select pg_temp.check(
  (select count(*)::text from public.training_session_coaches
    where training_session_id = '00000000-0000-0000-0000-0000000e0903'
      and profile_id = '00000000-0000-0000-0000-00000000c0ac'),
  '0', 'he also stops assisting on future trainings (A3f)');
select pg_temp.check(
  (select (significant_changed_at is null)::text from public.training_sessions
    where id = '00000000-0000-0000-0000-0000000e0001'),
  'true', 'and nobody is told a change happened yet (A3f)');
select pg_temp.check(
  (select count(*)::text from public.notification_events),
  '0', 'no e-mail when it becomes empty (K2e)');
select pg_temp.check(
  (select after ->> 'vacated_sessions' from public.audit_log
    where action = 'MEMBER_DEACTIVATED' order by id desc limit 1),
  '1', 'the departure records how many were left behind (A3f)');
select pg_temp.check(
  pg_temp.as_user(:A, $$select (main_coach_profile_id is null)::text from public.training_sessions
    where id = '00000000-0000-0000-0000-0000000e0001'$$),
  'true', 'a parent reads a training with no main coach — `Trenér bude upřesněn` (G6)');

-- Everything else about the training is untouched.
select pg_temp.check(
  (select notes from public.training_session_internal_notes
    where training_session_id = '00000000-0000-0000-0000-0000000e0001'),
  'Interní: rodič dluží platbu.', 'the internal note stays (A3f, D-13)');
select pg_temp.check(
  (select capacity || ' · ' || changing_room || ' · ' || public_notes || ' · ' ||
          birth_year_from || '–' || birth_year_to
     from public.training_sessions where id = '00000000-0000-0000-0000-0000000e0001'),
  '3 · Šatna 4 · Vezměte si chrániče. · 2016–2018',
  'and so does everything else on it (A3f)');

\echo ''
\echo '── What never moves (A3f) ───────────────────────────────────────────'
select pg_temp.check(
  (select main_coach_profile_id::text from public.training_sessions
    where id = '00000000-0000-0000-0000-0000000e0901'),
  '00000000-0000-0000-0000-00000000c0ac',
  'a training that has happened keeps the coach who took it (A3f)');
select pg_temp.check(
  (select main_coach_profile_id::text from public.training_sessions
    where id = '00000000-0000-0000-0000-0000000e0902'),
  '00000000-0000-0000-0000-00000000c0ac',
  'and so does one that was called off (A3f)');

\echo ''
\echo '── Who may edit a training nobody leads (K2e) ───────────────────────'
update public.workspace_members set can_edit_trainings = false
 where profile_id = '00000000-0000-0000-0000-00000000c0ad';
select pg_temp.check(
  pg_temp.as_user('00000000-0000-0000-0000-00000000c0ad',
    pg_temp.assign_sql('00000000-0000-0000-0000-0000000e0001', '00000000-0000-0000-0000-00000000c0ad')) ::jsonb ->> 'code',
  'FORBIDDEN_EDIT', 'a coach without the permission cannot, nor take it himself (K2e)');
select pg_temp.check(
  pg_temp.as_user('00000000-0000-0000-0000-00000000c0ad', $$select public.can_edit_session(pg_temp.ws(), null)::text$$),
  'false', 'an empty main coach is nobody, not everybody (K2e)');
update public.workspace_members set can_edit_trainings = true
 where profile_id = '00000000-0000-0000-0000-00000000c0ad';
select pg_temp.check(
  pg_temp.as_user('00000000-0000-0000-0000-00000000c0ad', $$select public.can_edit_session(pg_temp.ws(), null)::text$$),
  'true', 'a coach who may edit every training may (K2e)');

\echo ''
\echo '── Assigning a new main coach (K2e → K3c, E05) ──────────────────────'
select pg_temp.check(
  pg_temp.as_user(:ADMIN,
    pg_temp.assign_sql('00000000-0000-0000-0000-0000000e0001', '00000000-0000-0000-0000-00000000c0ad')) ::jsonb ->> 'ok',
  'true', 'the administrator assigns Trenér Dvořák (K2e)');
select pg_temp.check(
  (select main_coach_profile_id::text from public.training_sessions
    where id = '00000000-0000-0000-0000-0000000e0001'),
  '00000000-0000-0000-0000-00000000c0ad', 'the training has a main coach again (K2e)');
select pg_temp.check(
  (select profile_id::text from public.training_session_coaches
    where training_session_id = '00000000-0000-0000-0000-0000000e0001' and role = 'MAIN'),
  '00000000-0000-0000-0000-00000000c0ad', 'in the association table too (K2e)');
select pg_temp.check(
  (select (main_coach_vacated_from is null and main_coach_vacated_at is null)::text
     from public.training_sessions where id = '00000000-0000-0000-0000-0000000e0001'),
  'true', 'and is no longer waiting for one (K2e)');
select pg_temp.check(
  (select count(*)::text from public.notification_events
    where training_session_id = '00000000-0000-0000-0000-0000000e0001'
      and event_type = 'SESSION_MAIN_COACH_CHANGED'),
  '1', 'assigning sends E05, once for the training (K2e)');
select pg_temp.check(
  (select (significant_change -> 'fields')::text from public.training_sessions
    where id = '00000000-0000-0000-0000-0000000e0001'),
  '["MAIN_COACH"]', 'and is a significant change, as anywhere else (D-11)');
select pg_temp.check(
  (select count(*)::text from public.audit_log
    where action = 'SESSION_MAIN_COACH_CHANGED'
      and entity_id = '00000000-0000-0000-0000-0000000e0001'),
  '1', 'and audited (K2e)');

\echo ''
\echo '── Who may deactivate (A3f) ─────────────────────────────────────────'
select pg_temp.check(
  pg_temp.as_user(:COACH, $$select public.set_member_active(pg_temp.ws(),
    '00000000-0000-0000-0000-00000000c0ad'::uuid, false, true) ->> 'code'$$),
  'NOT_AUTHORIZED', 'a deactivated coach cannot deactivate anybody (A3f)');
select pg_temp.check(
  pg_temp.as_user(:A, $$select public.set_member_active(pg_temp.ws(),
    '00000000-0000-0000-0000-00000000c0ad'::uuid, false, true) ->> 'code'$$),
  'NOT_AUTHORIZED', 'and a parent is not staff at all (A3f)');
select pg_temp.check(
  (select main_coach_profile_id::text from public.training_sessions
    where id = '00000000-0000-0000-0000-0000000e0001'),
  '00000000-0000-0000-0000-00000000c0ad', 'neither refusal moved anything (A3f)');
