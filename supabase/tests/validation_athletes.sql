-- Trainlio — athlete domain operations validation
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

\set A '''00000000-0000-0000-0000-0000000fa000'''
\set B '''00000000-0000-0000-0000-0000000fb000'''
\set COACH '''00000000-0000-0000-0000-00000000c0ac'''
\set STRANGER '''00000000-0000-0000-0000-0000005f4a46'''

\echo '── A new guardian can find a workspace to register into ────────────'
-- The chicken-and-egg case: a stranger has no athlete, so the row policy shows
-- them no workspace, yet the registration form needs one.
select pg_temp.check(pg_temp.as_user(:STRANGER, $$select count(*)::text from public.workspaces$$),
  '0', 'a guardian with no athlete sees no workspace row');
select pg_temp.check(pg_temp.as_user(:STRANGER, $$select count(*)::text from public.joinable_workspaces()$$),
  '1', 'but joinable_workspaces() offers one to register into');
select pg_temp.check(pg_temp.as_user(:STRANGER, $$select sport_code from public.joinable_workspaces() limit 1$$),
  'HOCKEY', 'and names its sport');

\echo ''
\echo '── Athlete creation is one transaction (AC-010) ─────────────────────'
select pg_temp.check(
  pg_temp.as_user(:STRANGER, $$select (public.create_athlete_with_guardian(
    'Eva','Nováková', date '2018-04-02',
    (select id from public.joinable_workspaces() limit 1),
    'HOCKEY', '{"position":"GOALIE","stick_side":"LEFT"}'::jsonb) ->> 'ok')$$),
  'true', 'a guardian can create an athlete');
select pg_temp.check((select count(*)::text from public.athletes where first_name='Eva'),
  '1', 'the athlete row exists');
select pg_temp.check(
  (select count(*)::text from public.guardian_athlete_access g
   join public.athletes a on a.id=g.athlete_id where a.first_name='Eva' and g.status='ACTIVE'),
  '1', 'guardian access was created in the same call');
select pg_temp.check(
  (select count(*)::text from public.athlete_sport_profiles p
   join public.athletes a on a.id=p.athlete_id where a.first_name='Eva'),
  '1', 'the sport profile was created');
select pg_temp.check(
  (select count(*)::text from public.workspace_athlete_memberships m
   join public.athletes a on a.id=m.athlete_id where a.first_name='Eva'),
  '1', 'the workspace membership was created (D-10)');
select pg_temp.check(pg_temp.as_user(:STRANGER, $$select count(*)::text from public.athletes$$),
  '1', 'and the creator can now see their own athlete');

\echo ''
\echo '── A second athlete for the same guardian (AC-010) ──────────────────'
select pg_temp.check(
  pg_temp.as_user(:STRANGER, $$select (public.create_athlete_with_guardian(
    'Adam','Novák', date '2017-01-09',
    (select id from public.joinable_workspaces() limit 1),
    'HOCKEY', '{"position":"DEFENSE","stick_side":"RIGHT"}'::jsonb) ->> 'ok')$$),
  'true', 'a guardian can create more than one athlete');
select pg_temp.check(pg_temp.as_user(:STRANGER, $$select count(*)::text from public.athletes$$),
  '2', 'both are visible to them');
select pg_temp.check(pg_temp.as_user(:A, $$select count(*)::text from public.athletes where first_name in ('Eva','Adam')$$),
  '0', 'and to nobody else (AC-091)');

\echo ''
\echo '── Nothing is written when the call fails ───────────────────────────'
select pg_temp.check(
  pg_temp.as_user(:STRANGER, $$select (public.create_athlete_with_guardian(
    'Bad','Position', date '2018-01-01',
    (select id from public.joinable_workspaces() limit 1),
    'HOCKEY', '{"position":"STRIKER","stick_side":"LEFT"}'::jsonb) ->> 'code')$$),
  'INVALID_SPORT_ATTRIBUTES', 'an invalid position is rejected (AC-013)');
select pg_temp.check((select count(*)::text from public.athletes where first_name='Bad'),
  '0', 'and no athlete row was stranded');
select pg_temp.check(
  pg_temp.as_user(:STRANGER, $$select (public.create_athlete_with_guardian(
    'Bad','Stick', date '2018-01-01',
    (select id from public.joinable_workspaces() limit 1),
    'HOCKEY', '{"position":"CENTER","stick_side":"SIDEWAYS"}'::jsonb) ->> 'code')$$),
  'INVALID_SPORT_ATTRIBUTES', 'an invalid stick side is rejected (AC-014)');
select pg_temp.check(
  pg_temp.as_user(:STRANGER, $$select (public.create_athlete_with_guardian(
    '  ','Blank', date '2018-01-01',
    (select id from public.joinable_workspaces() limit 1),
    'HOCKEY', '{"position":"CENTER","stick_side":"LEFT"}'::jsonb) ->> 'code')$$),
  'INVALID_NAME', 'a blank first name is rejected');
select pg_temp.check(
  pg_temp.as_user(:STRANGER, $$select (public.create_athlete_with_guardian(
    'Future','Child', current_date + 1,
    (select id from public.joinable_workspaces() limit 1),
    'HOCKEY', '{"position":"CENTER","stick_side":"LEFT"}'::jsonb) ->> 'code')$$),
  'INVALID_DATE_OF_BIRTH', 'a date of birth in the future is rejected');
select pg_temp.check((select count(*)::text from public.athletes where last_name in ('Blank','Child')),
  '0', 'and neither stranded a row');

\echo ''
\echo '── Multi-sport (AC-100, AC-101, AC-102) ─────────────────────────────'
insert into public.sports(code,name) values ('SWIMMING','Plavání');
select pg_temp.check(
  pg_temp.as_user(:STRANGER, $$select (public.upsert_athlete_sport_profile(
    (select id from public.athletes where first_name='Eva'),
    'SWIMMING', '{}'::jsonb, 'Plavecký klub') ->> 'ok')$$),
  'true', 'an athlete can hold a second sport profile');
select pg_temp.check(
  (select count(*)::text from public.athlete_sport_profiles p
   join public.athletes a on a.id=p.athlete_id where a.first_name='Eva'),
  '2', 'HOCKEY and SWIMMING coexist (AC-100)');
select pg_temp.check(
  pg_temp.as_user(:STRANGER, $$select (public.upsert_athlete_sport_profile(
    (select id from public.athletes where first_name='Eva'),
    'HOCKEY', '{"position":"CENTER","stick_side":"RIGHT"}'::jsonb, 'HC Příbram',
    null, '7', (select id from public.joinable_workspaces() limit 1)) ->> 'ok')$$),
  'true', 'the hockey profile can be edited');
select pg_temp.check(
  (select p.club_name from public.athlete_sport_profiles p
   join public.athletes a on a.id=p.athlete_id join public.sports s on s.id=p.sport_id
   where a.first_name='Eva' and s.code='SWIMMING'),
  'Plavecký klub', 'editing hockey did not touch swimming (AC-101)');
select pg_temp.check(
  (select p.attributes ->> 'stick_side' from public.athlete_sport_profiles p
   join public.athletes a on a.id=p.athlete_id join public.sports s on s.id=p.sport_id
   where a.first_name='Eva' and s.code='HOCKEY'),
  'RIGHT', 'and the hockey edit did apply');
select pg_temp.check(
  (select count(*)::text from public.athletes where first_name='Eva'),
  '1', 'core athlete data is one shared record (AC-102)');

\echo ''
\echo '── Workspace membership is not derived from club_name (AC-111) ──────'
select pg_temp.check(
  (select count(*)::text from public.workspace_athlete_memberships m
   join public.athletes a on a.id=m.athlete_id where a.first_name='Eva'),
  '1', 'a swimming profile with a club created no extra membership');
select pg_temp.check(
  pg_temp.as_user(:STRANGER, $$select (public.upsert_athlete_sport_profile(
    (select id from public.athletes where first_name='Eva'),
    'SWIMMING', '{}'::jsonb, null, null, null,
    (select id from public.joinable_workspaces() limit 1)) ->> 'code')$$),
  'SPORT_NOT_IN_WORKSPACE', 'a sport the workspace does not run is refused');

\echo ''
\echo '── Only a guardian may edit; a coach may not (AC-015) ───────────────'
select pg_temp.check(
  pg_temp.as_user(:A, $$select (public.upsert_athlete_sport_profile(
    (select id from public.athletes where first_name='Eva'),
    'HOCKEY', '{"position":"GOALIE","stick_side":"LEFT"}'::jsonb) ->> 'code')$$),
  'NOT_AUTHORIZED_FOR_ATHLETE', 'another family cannot edit the sport profile');
select pg_temp.check(
  pg_temp.as_user(:COACH, $$update public.athletes set first_name='Changed'
    where id=(select id from public.athletes where first_name='Ivan') returning '1'$$),
  null, 'a coach update of an athlete matches no row');
select pg_temp.check((select count(*)::text from public.athletes where first_name='Ivan'),
  '1', 'the athlete core profile is unchanged (AC-015)');
select pg_temp.check(
  pg_temp.as_user(:COACH, $$select count(*)::text from public.athletes where first_name='Ivan'$$),
  '1', 'though the coach can still read it');

\echo ''
\echo '── Athlete deactivation (D-09, AC-180..AC-184) ──────────────────────'
select pg_temp.check(
  pg_temp.as_user(:STRANGER, $$update public.athletes set is_active=false
    where first_name='Eva' returning is_active::text$$),
  'false', 'a guardian can deactivate their own athlete');
select pg_temp.check(
  (select count(*)::text from public.athlete_sport_profiles p
   join public.athletes a on a.id=p.athlete_id where a.first_name='Eva'),
  '2', 'sport profiles are not deleted (AC-183)');
select pg_temp.check(
  (select count(*)::text from public.workspace_athlete_memberships m
   join public.athletes a on a.id=m.athlete_id where a.first_name='Eva'),
  '1', 'workspace membership is not deleted (AC-183)');
select pg_temp.check(
  pg_temp.as_user(:STRANGER, $$select count(*)::text from public.athletes where first_name='Eva'$$),
  '1', 'and the athlete stays visible to their guardian');
select pg_temp.check(
  pg_temp.as_user(:STRANGER, $$update public.athletes set is_active=true
    where first_name='Eva' returning is_active::text$$),
  'true', 'reactivation works (AC-184)');

drop function pg_temp.as_user(text,text);
drop function pg_temp.check(text,text,text);
