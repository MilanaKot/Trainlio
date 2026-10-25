-- Trainlio — who may edit a training (handoff v3.2, decision 33, migration 42)
-- Run after the migrations and fixtures, on its own freshly created database.
--
--   canEdit(session) = isAdmin || canEditTrainings || session.main coach = me
--   canCreate        = isAdmin || canEditTrainings
--
-- COACH2 (Dvořák) loses the permission. The fixture training e0001 is led by
-- COACH (Novák), with COACH2 added as its assistant; a second training is
-- created for COACH2 to lead. Coach tests 16–18 and admin tests 16–17 of the
-- spec, as far as the database decides them.
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

\set COACH  '''00000000-0000-0000-0000-00000000c0ac'''
\set COACH2 '''00000000-0000-0000-0000-00000000c0ad'''
\set ADMIN  '''00000000-0000-0000-0000-00000000ad11'''
\set S1     '''00000000-0000-0000-0000-0000000e0001'''

create or replace function pg_temp.ws() returns uuid language sql stable as
  $$ select id from public.workspaces limit 1 $$;
create or replace function pg_temp.fac(p_code text) returns uuid language sql stable as
  $$ select f.id from public.facilities f join public.locations l on l.id = f.location_id
     where f.code = p_code and l.workspace_id = pg_temp.ws() $$;
create temp table t_ids (k text primary key, v uuid);
create or replace function pg_temp.own() returns uuid language sql stable as
  $$ select v from t_ids where k = 'own' $$;
create or replace function pg_temp.booking(p_session uuid) returns uuid language sql stable as
  $$ select id from public.bookings where training_session_id = p_session and status = 'CONFIRMED'
     order by created_at limit 1 $$;
create or replace function pg_temp.code(p_sub text, p_sql text) returns text language sql as
  $$ select pg_temp.as_user(p_sub, 'select (' || p_sql || ') ->> ''code''') $$;
create or replace function pg_temp.ok(p_sub text, p_sql text) returns text language sql as
  $$ select pg_temp.as_user(p_sub, 'select (' || p_sql || ') ->> ''ok''') $$;

\echo ''
\echo '── The permission, and who may set it (admin tests 16–17) ──────────'
select pg_temp.check(
  (select can_edit_trainings::text from public.workspace_members
    where profile_id = :COACH2 and role = 'COACH'),
  'true', 'a coach holds the permission by default (A2)');
select pg_temp.check(
  pg_temp.code(:COACH, format('public.set_member_can_edit_trainings(%L::uuid, %L::uuid, false)',
    pg_temp.ws(), :COACH2)),
  'NOT_AUTHORIZED', 'a coach cannot take it from a colleague');
select pg_temp.check(
  pg_temp.ok(:ADMIN, format('public.set_member_can_edit_trainings(%L::uuid, %L::uuid, false)',
    pg_temp.ws(), :COACH2)),
  'true', 'an administrator can');
select pg_temp.check(
  (select count(*)::text from public.audit_log
    where action = 'MEMBER_PERMISSION_CHANGED' and entity_id = :COACH2
      and after ->> 'can_edit_trainings' = 'false'),
  '1', 'and the change is audited');
select pg_temp.check(
  pg_temp.as_user(:ADMIN, format(
    'select can_edit_trainings::text from public.workspace_staff(%L::uuid) where profile_id = %L::uuid',
    pg_temp.ws(), :COACH2)),
  'false', 'the staff list says so (A1 `Jen prohlížení`)');
select pg_temp.check(
  pg_temp.as_user(:COACH2, 'select can_edit_all::text from public.own_staff_state()'),
  'false', 'and so does the coach''s own state');
select pg_temp.check(
  pg_temp.code(:ADMIN, format('public.set_member_can_edit_trainings(%L::uuid, %L::uuid, false)',
    pg_temp.ws(), :ADMIN)),
  'ADMIN_ALWAYS_EDITS', 'an administrator''s own permission cannot be switched off (admin test 17)');
select pg_temp.check(
  pg_temp.as_user(:ADMIN, format('select public.can_edit_all_trainings(%L::uuid)::text', pg_temp.ws())),
  'true', 'an administrator can always edit, coach row or not');

\echo ''
\echo '── An assistant without it: K2b (coach tests 17–18) ────────────────'
select pg_temp.check(
  pg_temp.ok(:COACH, format('public.set_session_assistants(%L::uuid, array[%L::uuid])', :S1, :COACH2)),
  'true', 'COACH2 is an assistant on the training COACH leads');
select pg_temp.check(
  pg_temp.code(:COACH2, format(
    'public.update_training_session(%L::uuid, (select (start_at at time zone ''Europe/Prague'')::date from public.training_sessions where id = %L::uuid), time ''17:00'', time ''18:00'', %L::uuid, 12, ''ALL'')',
    :S1, :S1, pg_temp.fac('MH'))),
  'FORBIDDEN_EDIT', 'the assistant cannot edit it');
select pg_temp.check(
  pg_temp.code(:COACH2, format('public.set_session_booking_state(%L::uuid, false)', :S1)),
  'FORBIDDEN_EDIT', 'nor close its registration');
select pg_temp.check(
  pg_temp.code(:COACH2, format('public.cancel_training_session(%L::uuid)', :S1)),
  'FORBIDDEN_EDIT', 'nor cancel it');
select pg_temp.check(
  pg_temp.code(:COACH2, format('public.book_athlete_as_coach(%L::uuid, %L::uuid)',
    :S1, '00000000-0000-0000-0000-0000000a0002')),
  'FORBIDDEN_EDIT', 'nor add an athlete');
select pg_temp.check(
  pg_temp.code(:COACH2, format('public.cancel_booking_as_coach(%L::uuid, null)', pg_temp.booking(:S1))),
  'FORBIDDEN_EDIT', 'nor remove one');
select pg_temp.check(
  pg_temp.code(:COACH2, format('public.set_session_assistants(%L::uuid, %L::uuid[])', :S1, '{}')),
  'FORBIDDEN_EDIT', 'nor change who assists');
select pg_temp.check(
  pg_temp.code(:COACH2, format('public.duplicate_training_session(%L::uuid, (now() + interval ''40 days'')::date)', :S1)),
  'FORBIDDEN_EDIT', 'nor copy it');
select pg_temp.check(
  (select status::text || ' ' || capacity from public.training_sessions where id = :S1),
  'OPEN 3', 'none of that changed the training');
select pg_temp.check(
  pg_temp.as_user(:COACH2, format(
    'select count(*)::text from public.training_session_internal_notes where training_session_id = %L::uuid', :S1)),
  '1', 'it still reads the internal note (coach test 18)');
select pg_temp.check(
  pg_temp.as_user(:COACH2, format(
    'select (count(*) > 0)::text from public.booking_guardians(%L::uuid)', pg_temp.booking(:S1))),
  'true', 'and the guardians of a booked athlete, to call them (coach test 18)');

\echo ''
\echo '── Creating needs the permission ───────────────────────────────────'
select pg_temp.check(
  pg_temp.code(:COACH2, format(
    'public.create_training_session(%L::uuid, (now() + interval ''20 days'')::date, time ''09:00'', time ''10:00'', %L::uuid, 10, ''ALL'', null, null, null, null, null, %L::uuid)',
    pg_temp.ws(), pg_temp.fac('MH'), :COACH2)),
  'FORBIDDEN_EDIT', 'not even a training they would lead themselves');
select pg_temp.check(
  pg_temp.code(:COACH2, format(
    'public.create_session_series(%L::uuid, array[1], (now() + interval ''20 days'')::date, (now() + interval ''60 days'')::date, time ''09:00'', time ''10:00'', %L::uuid)',
    pg_temp.ws(), pg_temp.fac('MH'))),
  'FORBIDDEN_EDIT', 'nor a series');
select pg_temp.check(
  pg_temp.code(:COACH2, format('public.set_athlete_internal_note(%L::uuid, %L::uuid, ''Poznámka'')',
    pg_temp.ws(), '00000000-0000-0000-0000-0000000a0001')),
  'FORBIDDEN_EDIT', 'nor the athlete''s note (§K13)');

\echo ''
\echo '── Their own training: the full K2, but the main coach stays ───────'
insert into t_ids (k, v)
select 'own', (pg_temp.as_user(:ADMIN, format(
  'select (public.create_training_session(%L::uuid, (now() + interval ''21 days'')::date, time ''09:00'', time ''10:00'', %L::uuid, 10, ''ALL'', null, null, null, null, null, %L::uuid) -> ''data'' ->> ''training_session_id'')',
  pg_temp.ws(), pg_temp.fac('VH'), :COACH2)))::uuid;
select pg_temp.check(
  (select main_coach_profile_id::text from public.training_sessions where id = pg_temp.own()),
  '00000000-0000-0000-0000-00000000c0ad', 'an administrator gave COACH2 a training to lead');
select pg_temp.check(
  pg_temp.ok(:COACH2, format(
    'public.update_training_session(%L::uuid, (now() + interval ''21 days'')::date, time ''09:30'', time ''10:30'', %L::uuid, 12, ''ALL'')',
    pg_temp.own(), pg_temp.fac('VH'))),
  'true', 'they edit it (coach test 17)');
select pg_temp.check(
  pg_temp.code(:COACH2, format(
    'public.update_training_session(%L::uuid, (now() + interval ''21 days'')::date, time ''09:30'', time ''10:30'', %L::uuid, 12, ''ALL'', null, null, null, null, null, %L::uuid)',
    pg_temp.own(), pg_temp.fac('VH'), :COACH)),
  'FORBIDDEN_EDIT', 'but cannot hand it to another main coach');
select pg_temp.check(
  pg_temp.ok(:COACH2, format('public.book_athlete_as_coach(%L::uuid, %L::uuid)',
    pg_temp.own(), '00000000-0000-0000-0000-0000000a0002')),
  'true', 'they add an athlete');
select pg_temp.check(
  pg_temp.ok(:COACH2, format('public.cancel_booking_as_coach(%L::uuid, null)', pg_temp.booking(pg_temp.own()))),
  'true', 'and remove one');
select pg_temp.check(
  pg_temp.ok(:COACH2, format('public.set_session_assistants(%L::uuid, array[%L::uuid])', pg_temp.own(), :COACH)),
  'true', 'they choose their assistants');
select pg_temp.check(
  pg_temp.ok(:COACH2, format('public.set_session_booking_state(%L::uuid, false)', pg_temp.own())),
  'true', 'they close registration');
select pg_temp.check(
  pg_temp.code(:COACH2, format('public.duplicate_training_session(%L::uuid, (now() + interval ''28 days'')::date)', pg_temp.own())),
  'FORBIDDEN_EDIT', 'they cannot copy it: copying creates');
select pg_temp.check(
  pg_temp.ok(:COACH2, format('public.cancel_training_session(%L::uuid)', pg_temp.own())),
  'true', 'and they can cancel it');

\echo ''
\echo '── The administrator role keeps the value underneath ───────────────'
select pg_temp.check(
  pg_temp.ok(:ADMIN, format('public.set_member_role(%L::uuid, %L::uuid, true)', pg_temp.ws(), :COACH2)),
  'true', 'COACH2 is made an administrator');
select pg_temp.check(
  pg_temp.as_user(:COACH2, format('select public.can_edit_all_trainings(%L::uuid)::text', pg_temp.ws())),
  'true', 'and can edit everything while they are one');
select pg_temp.check(
  pg_temp.ok(:ADMIN, format('public.set_member_role(%L::uuid, %L::uuid, false)', pg_temp.ws(), :COACH2)),
  'true', 'the role is taken away again');
select pg_temp.check(
  pg_temp.as_user(:COACH2, format('select public.can_edit_all_trainings(%L::uuid)::text', pg_temp.ws())),
  'false', 'and the earlier value comes back (A3)');

\echo ''
\echo '── A coach with the permission is unaffected ───────────────────────'
select pg_temp.check(
  pg_temp.ok(:COACH, format('public.set_session_booking_state(%L::uuid, false)', :S1)),
  'true', 'COACH edits the training they lead');
select pg_temp.check(
  pg_temp.ok(:COACH, format(
    'public.create_training_session(%L::uuid, (now() + interval ''22 days'')::date, time ''09:00'', time ''10:00'', %L::uuid, 10, ''ALL'', null, null, null, null, null, %L::uuid)',
    pg_temp.ws(), pg_temp.fac('MH'), :COACH2)),
  'true', 'and creates one for somebody else to lead');

drop function pg_temp.as_user(text,text);
drop function pg_temp.check(text,text,text);
