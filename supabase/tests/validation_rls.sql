-- Trainlio — authorization validation
-- Run after 01..09 and fixtures.sql, on a database where validation.sql has NOT run
-- (that suite cancels the session and severs a login on purpose).
\set QUIET 1
\pset format unaligned
\pset tuples_only on
\set ON_ERROR_STOP 0

-- An OPEN session with a guardian booking, so there is something to be private about.
insert into public.training_sessions(id,workspace_id,sport_id,location_id,facility_id,main_coach_profile_id,
  start_at,end_at,capacity,status,created_by,eligibility_mode,changing_room,public_notes)
 select '00000000-0000-0000-0000-0000000e0002',w.id,w.primary_sport_id,l.id,f.id,'00000000-0000-0000-0000-00000000c0ac',
 now()+interval '30 days',now()+interval '30 days 1 hour',3,'OPEN','00000000-0000-0000-0000-00000000c0ac','ALL','Šatna 4','Vezměte si chrániče.'
 from public.workspaces w join public.locations l on l.workspace_id=w.id
  join public.facilities f on f.location_id=l.id and f.code='MH' where w.name like 'Příbram%';
insert into public.training_session_coaches values ('00000000-0000-0000-0000-0000000e0002','00000000-0000-0000-0000-00000000c0ac','MAIN');
insert into public.training_session_internal_notes(training_session_id,notes)
 values ('00000000-0000-0000-0000-0000000e0002','Interní: rodič dluží platbu.');
-- A DRAFT session, which no guardian may see.
insert into public.training_sessions(id,workspace_id,sport_id,location_id,facility_id,main_coach_profile_id,
  start_at,end_at,capacity,status,created_by,eligibility_mode)
 select '00000000-0000-0000-0000-0000000e0003',w.id,w.primary_sport_id,l.id,f.id,'00000000-0000-0000-0000-00000000c0ac',
 now()+interval '40 days',now()+interval '40 days 1 hour',3,'DRAFT','00000000-0000-0000-0000-00000000c0ac','ALL'
 from public.workspaces w join public.locations l on l.workspace_id=w.id
  join public.facilities f on f.location_id=l.id and f.code='VH' where w.name like 'Příbram%';
insert into public.training_session_coaches values ('00000000-0000-0000-0000-0000000e0003','00000000-0000-0000-0000-00000000c0ac','MAIN');

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
  else return 'FAIL  ' || p_label || ' (expected ' || coalesce(p_expected,'null') || ', got ' || coalesce(p_actual,'null') || ')'; end if;
end $$;

\set A '''00000000-0000-0000-0000-0000000fa000'''
\set B '''00000000-0000-0000-0000-0000000fb000'''
\set STRANGER '''00000000-0000-0000-0000-0000005f4a46'''
\set COACH '''00000000-0000-0000-0000-00000000c0ac'''
\set WSADMIN '''00000000-0000-0000-0000-00000000ad11'''
\set PLATFORM '''00000000-0000-0000-0000-00000000a170'''

\echo '── Family isolation (AC-091) ───────────────────────────────────────'
select pg_temp.check(pg_temp.as_user(:B, $$select coalesce(string_agg(first_name,','),'') from public.athletes$$),
  'Anna', 'family B sees only its own athlete');
select pg_temp.check(pg_temp.as_user(:B, $$select count(*)::text from public.bookings$$),
  '0', 'family B sees no bookings of family A');
select pg_temp.check(pg_temp.as_user(:B, $$select count(*)::text from public.app_profiles where display_name='Rodina A'$$),
  '0', 'family B cannot read another guardian profile');

\echo ''
\echo '── Occupancy is the one cross-family aggregate (AC-090) ────────────'
select pg_temp.check(pg_temp.as_user(:B, $$select confirmed_count::text from public.training_session_occupancy where training_session_id='00000000-0000-0000-0000-0000000e0002'$$),
  '0', 'family B can read the occupancy count (AC-090b)');
select pg_temp.check(pg_temp.as_user(:A, $$select count(*)::text from public.training_session_occupancy$$),
  '2', 'guardian sees occupancy only for sessions they can see (DRAFT excluded)');

\echo ''
\echo '── D-01 visibility ─────────────────────────────────────────────────'
select pg_temp.check(pg_temp.as_user(:STRANGER, $$select count(*)::text from public.training_sessions$$), '0', 'stranger sees no sessions (AC-090c)');
select pg_temp.check(pg_temp.as_user(:STRANGER, $$select count(*)::text from public.athletes$$), '0', 'stranger sees no athletes');
select pg_temp.check(pg_temp.as_user(:A, $$select count(*)::text from public.training_sessions where status='DRAFT'$$), '0', 'guardian sees no DRAFT session (AC-090d)');
select pg_temp.check(pg_temp.as_user(:COACH, $$select count(*)::text from public.training_sessions where status='DRAFT'$$), '1', 'coach does see the DRAFT session');

\echo ''
\echo '── D-12 / D-13 notes and changing room ─────────────────────────────'
select pg_temp.check(pg_temp.as_user(:A, $$select changing_room from public.training_sessions where id='00000000-0000-0000-0000-0000000e0002'$$),
  'Šatna 4', 'changing room is guardian-visible (AC-203)');
select pg_temp.check(pg_temp.as_user(:A, $$select public_notes from public.training_sessions where id='00000000-0000-0000-0000-0000000e0002'$$),
  'Vezměte si chrániče.', 'public_notes are guardian-visible (AC-200)');
select pg_temp.check(pg_temp.as_user(:A, $$select count(*)::text from public.training_session_internal_notes$$),
  '0', 'internal notes return no rows to a guardian (AC-201)');
select pg_temp.check(pg_temp.as_user(:COACH, $$select count(*)::text from public.training_session_internal_notes$$),
  '2', 'internal notes are readable by the coach (AC-202)');

\echo ''
\echo '── D-11 coach identity is visible, email is not ────────────────────'
select pg_temp.check(pg_temp.as_user(:A, $$select p.display_name from public.training_sessions s join public.app_profiles p on p.id=s.main_coach_profile_id where s.id='00000000-0000-0000-0000-0000000e0002'$$),
  'Trenér Novák', 'guardian can see the main coach name');

\echo ''
\echo '── D-17 role isolation ─────────────────────────────────────────────'
select pg_temp.check(pg_temp.as_user(:WSADMIN, $$select public.is_workspace_admin((select id from public.workspaces where name like 'Příbram%'))::text$$),
  'true', 'workspace admin is a workspace admin');
select pg_temp.check(pg_temp.as_user(:WSADMIN, $$select public.is_platform_admin()::text$$),
  'false', 'workspace admin is NOT a platform admin');
select pg_temp.check(pg_temp.as_user(:WSADMIN, $$select count(*)::text from public.platform_admins$$),
  'DENIED', 'workspace admin cannot read platform_admins (AC-211)');
select pg_temp.check(pg_temp.as_user(:PLATFORM, $$select public.is_platform_admin()::text$$),
  'true', 'platform admin is a platform admin');
select pg_temp.check(pg_temp.as_user(:PLATFORM, $$select public.is_workspace_coach((select id from public.workspaces where name like 'Příbram%'))::text$$),
  'false', 'platform admin gains no workspace coach rights (AC-212)');
select pg_temp.check(pg_temp.as_user(:PLATFORM, $$select count(*)::text from public.athletes$$),
  '0', 'platform admin reads no athlete data through RLS (AC-212)');
select pg_temp.check(pg_temp.as_user(:A, $$select public.is_workspace_member((select id from public.workspaces where name like 'Příbram%'))::text$$),
  'false', 'a guardian is never workspace staff (AC-213)');
select pg_temp.check(pg_temp.as_user(:A, $$select public.guardian_can_see_workspace((select id from public.workspaces where name like 'Příbram%'))::text$$),
  'true', 'guardian authorization runs through athlete membership instead (AC-213)');

\echo ''
\echo '── RPC-only mutations (AC-026..028) ────────────────────────────────'
select pg_temp.check(pg_temp.as_user(:A, $$insert into public.bookings(training_session_id,athlete_id,created_by,created_by_role) values ('00000000-0000-0000-0000-0000000e0002','00000000-0000-0000-0000-0000000a0001','00000000-0000-0000-0000-0000000fa000','USER') returning '1'$$),
  'DENIED', 'guardian cannot insert a booking directly');
select pg_temp.check(pg_temp.as_user(:COACH, $$update public.training_sessions set capacity=99 where id='00000000-0000-0000-0000-0000000e0002' returning '1'$$),
  'DENIED', 'coach cannot update a session directly');
select pg_temp.check(pg_temp.as_user(:A, $$delete from public.bookings returning '1'$$), 'DENIED', 'no client role can delete a booking (AC-028)');
select pg_temp.check(pg_temp.as_user(:A, $$select count(*)::text from public.audit_log$$), 'DENIED', 'guardian cannot read the audit log');
select pg_temp.check(pg_temp.as_user(:COACH, $$select count(*)::text from public.audit_log$$), 'DENIED', 'coach cannot read the audit log');
select pg_temp.check(pg_temp.as_user(:A, $$select count(*)::text from public.notification_deliveries$$), 'DENIED', 'guardian cannot read guardian email addresses');

drop function pg_temp.as_user(text,text);
drop function pg_temp.check(text,text,text);
