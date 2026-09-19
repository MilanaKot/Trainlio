-- Trainlio — schema validation
-- Run after 01..09 and fixtures.sql. Each case prints PASS or FAIL.
\set QUIET 1
\pset format unaligned
\pset tuples_only on
\set ON_ERROR_STOP 0

create or replace function pg_temp.expect_error(p_sql text, p_label text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return 'FAIL  ' || p_label || ' (was allowed)';
exception when others then
  return 'PASS  ' || p_label;
end $$;

create or replace function pg_temp.expect_eq(p_actual text, p_expected text, p_label text)
returns text language plpgsql as $$
begin
  if p_actual is not distinct from p_expected then return 'PASS  ' || p_label;
  else return 'FAIL  ' || p_label || ' (expected ' || coalesce(p_expected,'null') ||
              ', got ' || coalesce(p_actual,'null') || ')'; end if;
end $$;

-- A second workspace with a different sport, so cross-tenant attempts are
-- possible. This setup is deliberately OUTSIDE expect_error: that helper's
-- exception handler rolls back everything in its block, so setup performed
-- inside a failing case would vanish before the next case ran.
insert into public.sports(code,name) values ('SWIMMING','Plavání');
insert into public.workspaces(name,primary_sport_id) select 'WS2',id from public.sports where code='SWIMMING';
insert into public.locations(workspace_id,name) select id,'Jine mesto' from public.workspaces where name='WS2';
insert into public.workspace_members(workspace_id,profile_id,role)
  select id,'00000000-0000-0000-0000-00000000c0ac','COACH' from public.workspaces where name='WS2';
insert into public.audit_log(workspace_id,actor_profile_id,action,entity_type,entity_id)
  select id,'00000000-0000-0000-0000-00000000c0ac','SESSION_CREATED','TRAINING_SESSION','00000000-0000-0000-0000-0000000e0001'
  from public.workspaces where name like 'Příbram%';

\echo '── Database invariants ─────────────────────────────────────────────'
select pg_temp.expect_error($$insert into public.training_sessions(workspace_id,sport_id,location_id,facility_id,main_coach_profile_id,start_at,end_at,created_by)
   select w.id,w.primary_sport_id,l2.id,f.id,'00000000-0000-0000-0000-00000000c0ac',now()+interval '2 days',now()+interval '3 days','00000000-0000-0000-0000-00000000c0ac'
   from public.workspaces w join public.locations l2 on l2.workspace_id=w.id cross join public.facilities f where w.name='WS2' and f.code='MH'$$,
  'facility must belong to the stated location');
select pg_temp.expect_error($$insert into public.training_sessions(workspace_id,sport_id,location_id,facility_id,main_coach_profile_id,start_at,end_at,created_by)
   select w.id,w.primary_sport_id,l.id,f.id,'00000000-0000-0000-0000-00000000c0ac',now()+interval '2 days',now()+interval '3 days','00000000-0000-0000-0000-00000000c0ac'
   from public.workspaces w cross join public.locations l join public.facilities f on f.location_id=l.id where w.name='WS2' and l.name='Příbram' and f.code='MH'$$,
  'location must belong to the stated workspace');
select pg_temp.expect_error($$insert into public.workspace_athlete_memberships(workspace_id,athlete_id,athlete_sport_profile_id,sport_id)
   select w.id,'00000000-0000-0000-0000-0000000a0002','00000000-0000-0000-0000-0000000b0001',w.primary_sport_id from public.workspaces w where w.name like 'Příbram%'$$,
  'sport profile must belong to the stated athlete');
select pg_temp.expect_error($$insert into public.workspace_athlete_memberships(workspace_id,athlete_id,athlete_sport_profile_id,sport_id)
   select w.id,'00000000-0000-0000-0000-0000000a0001','00000000-0000-0000-0000-0000000b0001',w.primary_sport_id from public.workspaces w where w.name='WS2'$$,
  'membership sport must match the workspace sport');
select pg_temp.expect_error($$insert into public.training_session_coaches(training_session_id,profile_id,role)
   values ('00000000-0000-0000-0000-0000000e0001','00000000-0000-0000-0000-0000000fa000','ASSISTANT')$$,
  'session coach must be staff of that workspace');
select pg_temp.expect_error($$insert into public.athlete_sport_profiles(athlete_id,sport_id,attributes)
   select '00000000-0000-0000-0000-0000000a0002',id,'{"position":"STRIKER","stick_side":"LEFT"}'::jsonb from public.sports where code='HOCKEY'$$,
  'hockey position must be a configured value');
select pg_temp.expect_error($$insert into public.athlete_sport_profiles(athlete_id,sport_id,attributes)
   select '00000000-0000-0000-0000-0000000a0002',id,'{"position":"CENTER","stick_side":"LEFT","salary":"1"}'::jsonb from public.sports where code='HOCKEY'$$,
  'unknown sport attribute keys rejected');
select pg_temp.expect_error($$update public.workspaces set timezone='Europe/Praha' where name like 'Příbram%'$$,
  'workspace timezone must be a real IANA zone');
select pg_temp.expect_error($$insert into public.bookings(training_session_id,athlete_id,created_by,created_by_role)
   values ('00000000-0000-0000-0000-0000000e0001','00000000-0000-0000-0000-0000000a0001','00000000-0000-0000-0000-0000000fa000','USER')$$,
  'one CONFIRMED booking per athlete per session');
select pg_temp.expect_error($$update public.bookings set cancelled_at=now() where athlete_id='00000000-0000-0000-0000-0000000a0001'$$,
  'CONFIRMED booking cannot carry cancellation columns');
select pg_temp.expect_error($$insert into public.bookings(training_session_id,athlete_id,created_by,created_by_role,coach_capacity_override)
   values ('00000000-0000-0000-0000-0000000e0001','00000000-0000-0000-0000-0000000a0002','00000000-0000-0000-0000-0000000fa000','USER',true)$$,
  'capacity override requires a staff creator');
select pg_temp.expect_error($$delete from public.athletes where id='00000000-0000-0000-0000-0000000a0001'$$,
  'athlete with history cannot be deleted');
select pg_temp.expect_error($$delete from public.training_sessions where id='00000000-0000-0000-0000-0000000e0001'$$,
  'session with bookings cannot be deleted');
select pg_temp.expect_eq((select count(*)::text from public.audit_log), '1', 'audit row exists for the next two cases');
select pg_temp.expect_error($$update public.audit_log set action='SESSION_UPDATED'$$, 'audit_log rejects UPDATE');
select pg_temp.expect_error($$delete from public.audit_log$$, 'audit_log rejects DELETE');

\echo ''
\echo '── D-02  cancellation boundary ─────────────────────────────────────'
select pg_temp.expect_eq(
  (select case when (start_at - interval '12 hours 1 second') <= start_at - make_interval(hours=>12) then 'ALLOWED' else 'BLOCKED' end
   from public.training_sessions where id='00000000-0000-0000-0000-0000000e0001'), 'ALLOWED', '12:00:01 before start → allowed');
select pg_temp.expect_eq(
  (select case when (start_at - interval '12 hours') <= start_at - make_interval(hours=>12) then 'ALLOWED' else 'BLOCKED' end
   from public.training_sessions where id='00000000-0000-0000-0000-0000000e0001'), 'ALLOWED', '12:00:00 before start → allowed');
select pg_temp.expect_eq(
  (select case when (start_at - interval '11 hours 59 minutes 59 seconds') <= start_at - make_interval(hours=>12) then 'ALLOWED' else 'BLOCKED' end
   from public.training_sessions where id='00000000-0000-0000-0000-0000000e0001'), 'BLOCKED', '11:59:59 before start → blocked');

\echo ''
\echo '── D-08  eligibility narrowing with existing bookings ──────────────'
select pg_temp.expect_eq(
  (select count(*)::text from public.bookings_outside_birth_year_range('00000000-0000-0000-0000-0000000e0001',2017,2018)),
  '1', 'affected bookings counted before saving');
update public.training_sessions set birth_year_from=2017 where id='00000000-0000-0000-0000-0000000e0001';
select pg_temp.expect_eq(
  (select count(*)::text from public.bookings where training_session_id='00000000-0000-0000-0000-0000000e0001' and status='CONFIRMED'),
  '2', 'existing bookings are not auto-cancelled');
update public.bookings set eligibility_narrowed_at=now()
 where training_session_id='00000000-0000-0000-0000-0000000e0001' and athlete_id='00000000-0000-0000-0000-0000000a0003';
select pg_temp.expect_eq(
  (select count(*)::text from public.bookings where training_session_id='00000000-0000-0000-0000-0000000e0001' and eligibility_narrowed_at is not null),
  '1', 'only the affected booking is marked, not the session');
select pg_temp.expect_eq(
  public.athlete_eligibility_for_session('00000000-0000-0000-0000-0000000e0001','00000000-0000-0000-0000-0000000a0003'),
  'BIRTH_YEAR_OUT_OF_RANGE', 'new bookings use the narrowed rule');

\echo ''
\echo '── D-09  athlete deactivation ──────────────────────────────────────'
update public.athletes set is_active=false where id='00000000-0000-0000-0000-0000000a0001';
select pg_temp.expect_eq((select count(*)::text from public.bookings where athlete_id='00000000-0000-0000-0000-0000000a0001' and status='CONFIRMED'),'1','existing booking preserved');
select pg_temp.expect_eq((select count(*)::text from public.athlete_sport_profiles where athlete_id='00000000-0000-0000-0000-0000000a0001'),'1','sport profile preserved');
select pg_temp.expect_eq((select count(*)::text from public.workspace_athlete_memberships where athlete_id='00000000-0000-0000-0000-0000000a0001'),'1','workspace membership preserved');
select pg_temp.expect_eq(public.athlete_eligibility_for_session('00000000-0000-0000-0000-0000000e0001','00000000-0000-0000-0000-0000000a0001'),'ATHLETE_INACTIVE','new booking blocked');
update public.bookings set status='CANCELLED_BY_USER',cancelled_at=now(),cancelled_by='00000000-0000-0000-0000-0000000fa000'
 where training_session_id='00000000-0000-0000-0000-0000000e0001' and athlete_id='00000000-0000-0000-0000-0000000a0001';
select pg_temp.expect_eq((select status::text from public.bookings where training_session_id='00000000-0000-0000-0000-0000000e0001' and athlete_id='00000000-0000-0000-0000-0000000a0001'),'CANCELLED_BY_USER','guardian can still cancel');
update public.athletes set is_active=true where id='00000000-0000-0000-0000-0000000a0001';
select pg_temp.expect_eq(public.athlete_eligibility_for_session('00000000-0000-0000-0000-0000000e0001','00000000-0000-0000-0000-0000000a0001'),'ELIGIBLE','reactivation restores eligibility');

\echo ''
\echo '── D-11  significant main-coach change ─────────────────────────────'
update public.training_session_coaches set profile_id='00000000-0000-0000-0000-00000000c0ad'
 where training_session_id='00000000-0000-0000-0000-0000000e0001' and role='MAIN';
select pg_temp.expect_eq((select p.display_name from public.training_sessions s join public.app_profiles p on p.id=s.main_coach_profile_id where s.id='00000000-0000-0000-0000-0000000e0001'),
 'Trenér Dvořák','main coach mirror stays in step');
select pg_temp.expect_eq(
  (select (pg_catalog.pg_get_constraintdef(c.oid) like '%SESSION_MAIN_COACH_CHANGED%')::text
   from pg_catalog.pg_constraint c where c.conname='notification_events_type_known'),
  'true','SESSION_MAIN_COACH_CHANGED is a valid notification event type');
select pg_temp.expect_eq(
  (select (pg_catalog.pg_get_constraintdef(c.oid) like '%SESSION_MAIN_COACH_CHANGED%')::text
   from pg_catalog.pg_constraint c where c.conname='audit_log_action_known'),
  'true','SESSION_MAIN_COACH_CHANGED is a valid audit action');

\echo ''
\echo '── D-07  cancelled session is terminal ─────────────────────────────'
update public.training_sessions set status='CANCELLED',cancelled_at=now(),cancelled_by='00000000-0000-0000-0000-00000000c0ac' where id='00000000-0000-0000-0000-0000000e0001';
select pg_temp.expect_error($$update public.training_sessions set status='OPEN',cancelled_at=null,cancelled_by=null where id='00000000-0000-0000-0000-0000000e0001'$$,'cannot reopen a cancelled session');
select pg_temp.expect_error($$insert into public.bookings(training_session_id,athlete_id,created_by,created_by_role)
   values ('00000000-0000-0000-0000-0000000e0001','00000000-0000-0000-0000-0000000a0002','00000000-0000-0000-0000-0000000fb000','USER')$$,'no guardian booking into a cancelled session');
select pg_temp.expect_error($$insert into public.bookings(training_session_id,athlete_id,created_by,created_by_role)
   values ('00000000-0000-0000-0000-0000000e0001','00000000-0000-0000-0000-0000000a0002','00000000-0000-0000-0000-00000000c0ac','COACH')$$,'no coach booking into a cancelled session');
select pg_temp.expect_eq(public.athlete_eligibility_for_session('00000000-0000-0000-0000-0000000e0001','00000000-0000-0000-0000-0000000a0002'),'SESSION_CANCELLED','eligibility reports the cancellation');
select pg_temp.expect_eq((select count(*)::text from public.bookings where training_session_id='00000000-0000-0000-0000-0000000e0001'),'2','bookings preserved as historical evidence');

\echo ''
\echo '── D-18  history survives auth.users deletion ──────────────────────'
delete from auth.users where id='00000000-0000-0000-0000-0000000fa000';
select pg_temp.expect_eq((select (auth_user_id is null)::text from public.app_profiles where display_name='Rodina A'),'true','login link severed');
select pg_temp.expect_eq((select count(*)::text from public.bookings b join public.app_profiles p on p.id=b.created_by where p.display_name='Rodina A'),'2','bookings still attributed');
select pg_temp.expect_eq((select count(*)::text from public.guardian_athlete_access g join public.app_profiles p on p.id=g.profile_id where p.display_name='Rodina A'),'2','guardian links intact');

drop function pg_temp.expect_error(text,text);
drop function pg_temp.expect_eq(text,text,text);
