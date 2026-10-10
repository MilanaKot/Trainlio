-- Trainlio — a coach leaves, and their trainings go somewhere (DR-15, D-25)
-- Run after the migrations and fixtures, on its own freshly created database.
--
-- Until now deactivating a coach who still led trainings only warned about it
-- and left their name on them (D-11). The answer the product gave is a
-- question with two answers: the administrator doing the deactivation takes
-- the trainings over, or nothing moves. These cases are about what each answer
-- does, and about what never moves either way.
--
-- Its own database rather than a section of validation_staff.sql: that suite
-- deactivates the administrator halfway through to prove the club keeps one
-- (AC-250), and a handover needs an administrator who is still there.
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

\echo ''
\echo '── Leaving the trainings where they are (AC-293) ────────────────────'
-- The count still comes from the server, and nothing moves until it is
-- answered: the question is which of the two answers was given, not whether
-- one was.
select pg_temp.check(
  pg_temp.as_user(:ADMIN, $$select public.set_member_active(pg_temp.ws(),
    '00000000-0000-0000-0000-00000000c0ac'::uuid, false) ->> 'code'$$),
  'LEADS_FUTURE_SESSIONS', 'the question is asked before anything happens (AC-251)');
select pg_temp.check(
  pg_temp.as_user(:ADMIN, $$select public.set_member_active(pg_temp.ws(),
    '00000000-0000-0000-0000-00000000c0ac'::uuid, false) -> 'details' ->> 'future_sessions'$$),
  '1', 'and it counts only the trainings that are still to come (AC-293)');
select pg_temp.check(
  pg_temp.as_user(:ADMIN, $$select (public.set_member_active(pg_temp.ws(),
    '00000000-0000-0000-0000-00000000c0ac'::uuid, false, true, false)) ->> 'reassigned_sessions'$$),
  '0', 'answering "no" moves nothing (AC-293, D-11)');
select pg_temp.check(
  (select main_coach_profile_id::text from public.training_sessions
    where id = '00000000-0000-0000-0000-0000000e0001'),
  '00000000-0000-0000-0000-00000000c0ac',
  'the training keeps the coach a parent already read there (AC-293, D-11)');
select pg_temp.check(
  (select (significant_changed_at is null)::text from public.training_sessions
    where id = '00000000-0000-0000-0000-0000000e0001'),
  'true', 'and nobody is told a change happened, because none did (AC-293)');
select pg_temp.check(
  (select count(*)::text from public.audit_log
    where action = 'SESSION_MAIN_COACH_CHANGED'),
  '0', 'nothing to audit either (AC-293)');
select pg_temp.check(
  (select is_active::text from public.workspace_members
    where profile_id = '00000000-0000-0000-0000-00000000c0ac'),
  'false', 'the coach is deactivated all the same (AC-293)');

\echo ''
\echo '── Taking them over (AC-293) ────────────────────────────────────────'
select pg_temp.check(
  pg_temp.as_user(:ADMIN, $$select public.set_member_active(pg_temp.ws(),
    '00000000-0000-0000-0000-00000000c0ac'::uuid, true) ->> 'ok'$$),
  'true', 'the coach is brought back, to leave again differently (AC-293)');
select pg_temp.check(
  pg_temp.as_user(:ADMIN, $$select (public.set_member_active(pg_temp.ws(),
    '00000000-0000-0000-0000-00000000c0ac'::uuid, false, true, true)) ->> 'reassigned_sessions'$$),
  '1', 'answering "yes" moves the trainings that are still to come (AC-293)');
select pg_temp.check(
  (select main_coach_profile_id::text from public.training_sessions
    where id = '00000000-0000-0000-0000-0000000e0001'),
  '00000000-0000-0000-0000-00000000ad11',
  'to whoever did the deactivating — there is no other head coach (AC-293)');
select pg_temp.check(
  (select profile_id::text from public.training_session_coaches
    where training_session_id = '00000000-0000-0000-0000-0000000e0001' and role = 'MAIN'),
  '00000000-0000-0000-0000-00000000ad11',
  'the association table is the one that moved, not only the mirror (AC-293)');

-- Everything else about the training is untouched. This is the half that an
-- UPDATE over the table would have got right and a careless call to the domain
-- function would not: the internal note is passed back in, or it is deleted.
select pg_temp.check(
  (select notes from public.training_session_internal_notes
    where training_session_id = '00000000-0000-0000-0000-0000000e0001'),
  'Interní: rodič dluží platbu.', 'the internal note survives the handover (AC-293, D-13)');
select pg_temp.check(
  (select capacity || ' · ' || changing_room || ' · ' || public_notes || ' · ' ||
          birth_year_from || '–' || birth_year_to
     from public.training_sessions where id = '00000000-0000-0000-0000-0000000e0001'),
  '3 · Šatna 4 · Vezměte si chrániče. · 2016–2018',
  'and so does everything else on it (AC-293)');

\echo ''
\echo '── What the families are told (AC-293, D-11) ────────────────────────'
select pg_temp.check(
  (select (significant_changed_at is not null)::text from public.training_sessions
    where id = '00000000-0000-0000-0000-0000000e0001'),
  'true', 'a new main coach is a significant change, as it is anywhere else (D-11)');
select pg_temp.check(
  (select significant_change -> 'previous' ->> 'main_coach_name' from public.training_sessions
    where id = '00000000-0000-0000-0000-0000000e0001'),
  'Trenér Novák', 'the e-mail can say who it used to be (AC-293)');
select pg_temp.check(
  (select count(*)::text from public.notification_events
    where training_session_id = '00000000-0000-0000-0000-0000000e0001'
      and event_type = 'SESSION_MAIN_COACH_CHANGED'),
  '1', 'one event for the training, not one per booked family (AC-293)');
select pg_temp.check(
  (select count(*)::text from public.audit_log
    where action = 'SESSION_MAIN_COACH_CHANGED'
      and entity_id = '00000000-0000-0000-0000-0000000e0001'),
  '1', 'and the change to the training is audited (AC-293)');
select pg_temp.check(
  (select after ->> 'reassigned_sessions' from public.audit_log
    where action = 'MEMBER_DEACTIVATED' order by id desc limit 1),
  '1', 'the departure records how many went with it (AC-293)');

\echo ''
\echo '── What never moves (AC-293) ────────────────────────────────────────'
select pg_temp.check(
  (select main_coach_profile_id::text from public.training_sessions
    where id = '00000000-0000-0000-0000-0000000e0901'),
  '00000000-0000-0000-0000-00000000c0ac',
  'a training that has happened keeps the coach who took it (AC-293)');
select pg_temp.check(
  (select main_coach_profile_id::text from public.training_sessions
    where id = '00000000-0000-0000-0000-0000000e0902'),
  '00000000-0000-0000-0000-00000000c0ac',
  'and so does one that was called off (AC-293)');

\echo ''
\echo '── Who may do it (AC-293) ───────────────────────────────────────────'
select pg_temp.check(
  pg_temp.as_user(:ADMIN, $$select public.set_member_active(pg_temp.ws(),
    '00000000-0000-0000-0000-00000000c0ac'::uuid, true) ->> 'ok'$$),
  'true', 'the coach comes back for the last two cases (AC-293)');
select pg_temp.check(
  pg_temp.as_user(:COACH, $$select public.set_member_active(pg_temp.ws(),
    '00000000-0000-0000-0000-00000000c0ad'::uuid, false, true, true) ->> 'code'$$),
  'NOT_AUTHORIZED',
  'a coach cannot hand a colleague''s trainings to themselves (AC-293)');
select pg_temp.check(
  pg_temp.as_user(:A, $$select public.set_member_active(pg_temp.ws(),
    '00000000-0000-0000-0000-00000000c0ac'::uuid, false, true, true) ->> 'code'$$),
  'NOT_AUTHORIZED', 'and a parent is not staff at all (AC-293)');
select pg_temp.check(
  (select main_coach_profile_id::text from public.training_sessions
    where id = '00000000-0000-0000-0000-0000000e0001'),
  '00000000-0000-0000-0000-00000000ad11',
  'neither refusal moved anything (AC-293)');
