-- Trainlio — joining a club by its link, approval, and the second parent
-- (migration 50, D-39 to D-41; AC-321 to AC-325). Run after the migrations and
-- fixtures, on its own freshly created database.
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

create or replace function pg_temp.as_anon(p_sql text)
returns text language plpgsql as $$
declare r text;
begin
  perform set_config('role', 'anon', true);
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

\set COACH    '''00000000-0000-0000-0000-00000000c0ac'''
\set ADMIN    '''00000000-0000-0000-0000-00000000ad11'''
\set FAMA     '''00000000-0000-0000-0000-0000000fa000'''
\set FAMB     '''00000000-0000-0000-0000-0000000fb000'''
\set STRANGER '''00000000-0000-0000-0000-0000005f4a46'''
\set IVAN     '''00000000-0000-0000-0000-0000000a0001'''
\set ANNA     '''00000000-0000-0000-0000-0000000a0002'''
\set TOMAS    '''00000000-0000-0000-0000-0000000a0003'''

create or replace function pg_temp.ws() returns uuid language sql stable as
  $$ select id from public.workspaces limit 1 $$;
create or replace function pg_temp.code() returns text language sql stable as
  $$ select join_code from public.workspaces limit 1 $$;
create or replace function pg_temp.eva() returns uuid language sql stable as
  $$ select id from public.athletes where first_name = 'Eva' and last_name = 'Nová' $$;
create or replace function pg_temp.eva_membership() returns uuid language sql stable as
  $$ select id from public.workspace_athlete_memberships where athlete_id = pg_temp.eva() $$;

\echo ''
\echo '── The link (AC-321) ──────────────────────────────────────────────'
select pg_temp.check(length(pg_temp.code())::text, '8', 'every club has an eight-character code');
select pg_temp.check(
  (pg_temp.as_user(:FAMA, $$select join_code from public.workspaces limit 1$$) like 'DENIED%')::text,
  true::text, 'no client reads the code from the table');
select pg_temp.check(
  pg_temp.as_user(:ADMIN, format($$select public.workspace_join_code(%L) -> 'data' ->> 'code'$$, pg_temp.ws())),
  pg_temp.code(), 'the administrator does, through its function');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select public.workspace_join_code(%L) ->> 'code'$$, pg_temp.ws())),
  'NOT_AUTHORIZED', 'a coach does not');
select pg_temp.check(
  pg_temp.as_anon(format($$select name from public.workspace_join_preview(%L)$$, pg_temp.code())),
  (select name from public.workspaces limit 1), 'the link names the club before anybody signs in');
select pg_temp.check(
  pg_temp.as_anon($$select count(*)::text from public.workspace_join_preview('NOTACODE')$$),
  '0', 'and a wrong code names nothing');

\echo ''
\echo '── A new family (AC-321, AC-322) ──────────────────────────────────'
select pg_temp.check(
  pg_temp.as_user(:STRANGER, format($$select public.create_athlete_with_guardian(
    'Eva','Nová', date '2017-04-02', %L, 'HOCKEY', '{"position":"GOALIE","stick_side":"LEFT"}'::jsonb) ->> 'code'$$, pg_temp.ws())),
  'WORKSPACE_NOT_JOINABLE', 'without the link nobody registers a child');
select pg_temp.check(
  pg_temp.as_user(:STRANGER, format($$select public.join_workspace(%L) ->> 'ok'$$, pg_temp.code())),
  'true', 'the link lets them in');
select pg_temp.check(
  pg_temp.as_user(:STRANGER, format($$select public.create_athlete_with_guardian(
    'Eva','Nová', date '2017-04-02', %L, 'HOCKEY', '{"position":"GOALIE","stick_side":"LEFT"}'::jsonb) -> 'data' ->> 'approval'$$, pg_temp.ws())),
  'PENDING', 'and the child waits for the club');
select pg_temp.check(
  (select approval || '|' || is_active::text from public.workspace_athlete_memberships where athlete_id = pg_temp.eva()),
  'PENDING|false', 'inactive while it waits');
select pg_temp.check(
  pg_temp.as_user(:STRANGER, $$select count(*)::text from public.training_sessions$$),
  '0', 'the family sees no training (D-01)');
select pg_temp.check(
  pg_temp.as_user(:STRANGER, format($$select public.book_athletes_as_guardian(
    '00000000-0000-0000-0000-0000000e0001'::uuid, array[%L::uuid]) ->> 'ok'$$, pg_temp.eva())),
  'false', 'and cannot book');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select count(*)::text from public.athletes where id = %L$$, pg_temp.eva())),
  '0', 'the coaches do not see the child yet');
select pg_temp.check(
  pg_temp.as_user(:STRANGER, format($$select public.upsert_athlete_sport_profile(%L, 'HOCKEY',
    '{"position":"CENTER","stick_side":"LEFT"}'::jsonb, null, null, null, %L) ->> 'ok'$$, pg_temp.eva(), pg_temp.ws())),
  'true', 'the family may still edit the profile');
select pg_temp.check(
  (select approval::text from public.workspace_athlete_memberships where athlete_id = pg_temp.eva()),
  'PENDING', 'which does not let the child in');
select pg_temp.check(
  (select string_agg(r.recipient_profile_id::text, ',')
     from public.notification_events e
     cross join lateral public.notification_event_recipients(e.id) r
    where e.event_type = 'ATHLETE_APPROVAL_REQUESTED'),
  '00000000-0000-0000-0000-00000000ad11', 'the administrators are e-mailed (E11)');

\echo ''
\echo '── The decision (AC-322, AC-323) ──────────────────────────────────'
select pg_temp.check(
  pg_temp.as_user(:ADMIN, format($$select count(*)::text from public.workspace_join_requests(%L)$$, pg_temp.ws())),
  '1', 'the administrator lists the waiting child');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select count(*)::text from public.workspace_join_requests(%L)$$, pg_temp.ws())),
  '0', 'a coach does not');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select public.decide_join_request(%L, true) ->> 'code'$$, pg_temp.eva_membership())),
  'NOT_AUTHORIZED', 'and cannot decide');
select pg_temp.check(
  pg_temp.as_user(:ADMIN, format($$select public.decide_join_request(%L, false) ->> 'ok'$$, pg_temp.eva_membership())),
  'true', 'the administrator rejects');
select pg_temp.check(
  (select string_agg(r.recipient_profile_id::text, ',')
     from public.notification_events e
     cross join lateral public.notification_event_recipients(e.id) r
    where e.event_type = 'ATHLETE_JOIN_DECIDED'),
  '00000000-0000-0000-0000-0000005f4a46', 'the family is e-mailed (E12)');
select pg_temp.check(
  pg_temp.as_user(:FAMA, format($$select public.request_join_again(%L) ->> 'code'$$, pg_temp.eva_membership())),
  'NOT_AUTHORIZED_FOR_ATHLETE', 'another family cannot ask again for them');
select pg_temp.check(
  pg_temp.as_user(:STRANGER, format($$select public.request_join_again(%L) ->> 'ok'$$, pg_temp.eva_membership())),
  'true', 'the family asks again');
select pg_temp.check(
  pg_temp.as_user(:ADMIN, format($$select public.decide_join_request(%L, true) ->> 'ok'$$, pg_temp.eva_membership())),
  'true', 'and the administrator approves');
select pg_temp.check(
  (select approval || '|' || is_active::text from public.workspace_athlete_memberships where athlete_id = pg_temp.eva()),
  'APPROVED|true', 'the child is in the club');
select pg_temp.check(
  pg_temp.as_user(:STRANGER, $$select (count(*) > 0)::text from public.training_sessions$$),
  'true', 'and the family sees the trainings');
select pg_temp.check(
  pg_temp.as_user(:ADMIN, format($$select public.decide_join_request(%L, false) ->> 'code'$$, pg_temp.eva_membership())),
  'ALREADY_DECIDED', 'a decision is not taken twice');
select pg_temp.check(
  pg_temp.as_user(:ADMIN, format($$select public.create_athlete_with_guardian(
    'Petr','Admin', date '2016-01-01', %L, 'HOCKEY',
    '{"position":"CENTER","stick_side":"RIGHT"}'::jsonb) -> 'data' ->> 'approval'$$, pg_temp.ws())),
  'APPROVED', 'an administrator''s own child needs nobody''s approval');

\echo ''
\echo '── A new link (AC-321) ────────────────────────────────────────────'
create temp table old_code as select pg_temp.code() as code;
select pg_temp.check(
  pg_temp.as_user(:ADMIN, format($$select public.rotate_workspace_join_code(%L) ->> 'ok'$$, pg_temp.ws())),
  'true', 'the administrator issues a new link');
select pg_temp.check(
  pg_temp.as_user(:FAMB, format($$select public.join_workspace(%L) ->> 'code'$$, (select code from old_code))),
  'INVALID_JOIN_CODE', 'the old one stops working at once');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select public.rotate_workspace_join_code(%L) ->> 'code'$$, pg_temp.ws())),
  'NOT_AUTHORIZED', 'a coach cannot issue one');

\echo ''
\echo '── The second parent (AC-324, AC-325) ─────────────────────────────'
insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000fc000', 'druhy.rodic@example.test');
select pg_temp.check(
  pg_temp.as_user(:FAMA, format($$select public.invite_guardian('Druhy.Rodic@example.test', array[%L, %L]::uuid[]) ->> 'ok'$$, :IVAN, :TOMAS)),
  'true', 'a parent invites the other to two children');
select pg_temp.check(
  pg_temp.as_user(:FAMA, format($$select public.invite_guardian('nekdo@example.test', array[%L]::uuid[]) ->> 'code'$$, :ANNA)),
  'NOT_AUTHORIZED_FOR_ATHLETE', 'never to a child of another family');
select pg_temp.check(
  pg_temp.as_user(:FAMA, format($$select public.invite_guardian('familyA@example.test', array[%L]::uuid[]) ->> 'code'$$, :IVAN)),
  'INVITING_SELF', 'nor themselves');
select pg_temp.check(
  pg_temp.as_user(:FAMA, format($$select count(*)::text from public.athlete_guardian_invitations(%L)$$, :IVAN)),
  '1', 'the invitation is listed for the child');
select pg_temp.check(
  pg_temp.as_user(:FAMB, format($$select count(*)::text from public.athlete_guardian_invitations(%L)$$, :IVAN)),
  '0', 'not to another family');
select pg_temp.check(
  (pg_temp.as_user(:FAMA, $$select count(*)::text from public.guardian_invitations$$) like 'DENIED%')::text,
  true::text, 'and the table itself is nobody''s to read');
select pg_temp.check(
  pg_temp.as_user('00000000-0000-0000-0000-0000000fc000', $$select public.accept_guardian_invitations() -> 'data' ->> 'added'$$),
  '2', 'signing in with that address takes both children');
select pg_temp.check(
  pg_temp.as_user('00000000-0000-0000-0000-0000000fc000', $$select count(*)::text from public.athletes$$),
  '2', 'whom the second parent now sees, without a duplicate');
select pg_temp.check(
  pg_temp.as_user(:FAMA, format($$select public.invite_guardian('druhy.rodic@example.test', array[%L]::uuid[]) ->> 'code'$$, :IVAN)),
  'ALREADY_GUARDIAN', 'inviting them again says they are already in');
select pg_temp.check(
  pg_temp.as_user(:FAMA, format($$select public.invite_guardian('familyB@example.test', array[%L]::uuid[]) -> 'data' ->> 'email'$$, :IVAN)),
  'familyb@example.test', 'an invitation is to a lower-cased address');
select pg_temp.check(
  pg_temp.as_user(:FAMA, format($$select public.revoke_guardian_invitation(%L) ->> 'ok'$$,
    (select id from public.guardian_invitations where email = 'familyb@example.test'))),
  'true', 'and can be withdrawn');
select pg_temp.check(
  pg_temp.as_user(:FAMB, $$select public.accept_guardian_invitations() -> 'data' ->> 'added'$$),
  '0', 'a withdrawn invitation gives nothing');
