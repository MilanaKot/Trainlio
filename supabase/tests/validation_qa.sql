-- Trainlio — QA suite
-- Run after the migrations and fixtures, on its own freshly created database.
--
-- Phase 8. The criteria here are ones no earlier suite happened to reach: the
-- shape of the schema itself, the roles matrix, the D-18 constraints, and the
-- reconciliation assert that says the occupancy projection still equals the
-- bookings it summarises.
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

create or replace function pg_temp.expect_error(p_sql text, p_label text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return 'FAIL  ' || p_label || ' (the statement was accepted)';
exception when others then
  return 'PASS  ' || p_label;
end $$;

\set COACH '''00000000-0000-0000-0000-00000000c0ac'''
\set ADMIN '''00000000-0000-0000-0000-00000000ad11'''
\set A '''00000000-0000-0000-0000-0000000fa000'''
\set B '''00000000-0000-0000-0000-0000000fb000'''

create or replace function pg_temp.ath(p_name text) returns uuid language sql stable as
  $$ select id from public.athletes where first_name = p_name $$;
create or replace function pg_temp.ws() returns uuid language sql stable as
  $$ select id from public.workspaces where name like 'Příbram%' $$;
create or replace function pg_temp.fac() returns uuid language sql stable as
  $$ select f.id from public.facilities f join public.locations l on l.id=f.location_id
     join public.workspaces w on w.id=l.workspace_id where f.code='MH' and w.name like 'Příbram%' $$;

\echo '── The shape of the stored data ────────────────────────────────────'
-- AC-011. A birth *year* would have been enough for eligibility, and choosing
-- it would have made the age group unfixable when the rule changes.
select pg_temp.check(
  (select data_type from information_schema.columns
    where table_schema='public' and table_name='athletes' and column_name='date_of_birth'),
  'date', 'athlete date of birth is a full DATE, not a year (AC-011)');
select pg_temp.check(
  (select is_nullable from information_schema.columns
    where table_schema='public' and table_name='athletes' and column_name='date_of_birth'),
  'NO', 'and it is required');
-- AC-222. The one deliberate exception is documented on the column itself.
--
-- Restricted to columns that could actually hold an address: a retention
-- setting in days is named for email and cannot store one. Widening the scan
-- to every matching name would make it noisy, and a noisy check gets an
-- exception list, which is how a real `contact_email text` slips through.
select pg_temp.check(
  (select coalesce(string_agg(table_name || '.' || column_name, ', ' order by table_name), 'none')
     from information_schema.columns
    where table_schema = 'public'
      and data_type in ('text', 'character varying', 'character')
      and (column_name ilike '%email%' or column_name ilike '%e_mail%')),
  'notification_deliveries.recipient_email',
  'no operational table stores an email address (AC-222)');
select pg_temp.check(
  (select is_nullable from information_schema.columns
    where table_schema='public' and table_name='notification_deliveries' and column_name='recipient_email'),
  'YES', 'and the one that does can be scrubbed (AC-222, D-18)');
-- AC-134, the half no earlier suite reached: the constraint is symmetric.
select pg_temp.expect_error($$update public.bookings
   set status='CANCELLED_BY_USER' where training_session_id='00000000-0000-0000-0000-0000000e0001'
   and athlete_id='00000000-0000-0000-0000-0000000a0001'$$,
  'a cancelled booking cannot omit its cancellation columns (AC-134)');
select pg_temp.check(
  (select status::text from public.bookings
    where training_session_id='00000000-0000-0000-0000-0000000e0001'
      and athlete_id='00000000-0000-0000-0000-0000000a0001'),
  'CONFIRMED', 'and the rejected update left the row alone');

\echo ''
\echo '── Nothing a client may delete (AC-028) ────────────────────────────'
select pg_temp.check(
  (select count(*)::text from information_schema.role_table_grants
    where table_schema='public' and privilege_type='DELETE'
      and grantee in ('anon','authenticated')),
  '0', 'no client role holds DELETE on any table (AC-028)');
select pg_temp.check(
  pg_temp.as_user(:A, $$select (count(*))::text from (
    delete from public.bookings where true returning 1) d$$),
  'DENIED', 'a guardian cannot delete a booking (AC-028)');
select pg_temp.check(
  pg_temp.as_user(:COACH, $$select (count(*))::text from (
    delete from public.training_sessions where true returning 1) d$$),
  'DENIED', 'a coach cannot delete a session (AC-028)');
select pg_temp.check(
  (select count(*)::text from public.training_sessions),
  '1', 'and the session is still there');

\echo ''
\echo '── The roles matrix (D-17) ─────────────────────────────────────────'
-- AC-210. Membership alone is not the criterion; running the operation is.
select pg_temp.check(
  pg_temp.as_user(:ADMIN, format($$select (public.create_training_session(
    %L::uuid, (current_date + 20)::date, time '09:00', time '10:00', %L::uuid, 10, 'ALL')
    ->> 'ok')$$, pg_temp.ws(), pg_temp.fac())),
  'true', 'a WORKSPACE_ADMIN may run a coach domain operation (AC-210)');
select pg_temp.check(
  pg_temp.as_user(:ADMIN, format($$select (public.book_athlete_as_coach(
    (select id from public.training_sessions where capacity = 10 and status = 'OPEN'
       order by created_at desc limit 1), %L::uuid) ->> 'ok')$$, pg_temp.ath('Anna'))),
  'true', 'including the roster operations (AC-210)');
-- AC-214. Two rows, not a single role column, which is why this is expressible.
insert into public.workspace_members(workspace_id, profile_id, role)
select pg_temp.ws(), '00000000-0000-0000-0000-00000000c0ac', 'WORKSPACE_ADMIN';
select pg_temp.check(
  (select count(*)::text from public.workspace_members
    where profile_id = '00000000-0000-0000-0000-00000000c0ac' and is_active),
  '2', 'a user may hold COACH and WORKSPACE_ADMIN at once (AC-214)');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select public.is_workspace_coach(%L::uuid)::text$$, pg_temp.ws())),
  'true', 'and the second role takes nothing away from the first (AC-214)');
-- Refused outright rather than filtered to nothing: the table carries no grant
-- for any client role, so the read never reaches a policy.
select pg_temp.check(
  pg_temp.as_user(:COACH, $$select count(*)::text from public.platform_admins$$),
  'DENIED', 'neither role reaches platform administration (AC-211, D-17)');

\echo ''
\echo '── One athlete, several workspaces (AC-110) ────────────────────────'
insert into public.workspaces(name, primary_sport_id, timezone)
select 'Beroun', s.id, 'Europe/Prague' from public.sports s where s.code = 'HOCKEY';
insert into public.workspace_athlete_memberships(workspace_id, athlete_id, athlete_sport_profile_id, sport_id)
select w.id, asp.athlete_id, asp.id, asp.sport_id
from public.workspaces w, public.athlete_sport_profiles asp
where w.name = 'Beroun' and asp.athlete_id = pg_temp.ath('Ivan');
select pg_temp.check(
  (select count(*)::text from public.workspace_athlete_memberships
    where athlete_id = pg_temp.ath('Ivan') and is_active),
  '2', 'one athlete is active in two workspaces (AC-110)');
select pg_temp.check(
  (select count(distinct athlete_id)::text from public.workspace_athlete_memberships
    where athlete_id = pg_temp.ath('Ivan')),
  '1', 'as one athlete record, not a copy per club (AC-110, BR-004)');
select pg_temp.check(
  pg_temp.as_user(:A, $$select count(*)::text from public.workspaces$$),
  '2', 'and their guardian can see both (D-01)');
select pg_temp.check(
  pg_temp.as_user(:B, $$select count(*)::text from public.workspaces$$),
  '1', 'while a family with no athlete there sees only their own (D-01, AC-090c)');

\echo ''
\echo '── The cancellation boundary is database time (AC-040d) ────────────'
-- The guardian path must not be reachable by a client whose clock is wrong, so
-- the comparison is made against the database's own now() and nothing is taken
-- from the caller.
select pg_temp.check(
  (select count(*)::text from pg_proc p
    where p.proname = 'cancel_booking_as_guardian'
      and pg_get_functiondef(p.oid) like '%now()%'),
  '1', 'the guardian cancellation reads the database clock (AC-040d)');
select pg_temp.check(
  (select count(*)::text from pg_proc p
    where p.proname = 'cancel_booking_as_guardian'
      and pg_get_functiondef(p.oid) ilike '%p_now%'),
  '0', 'and takes no time from the caller at all (AC-040d)');
select pg_temp.check(
  (select count(*)::text from pg_proc p
    where p.proname in ('book_athletes_as_guardian', 'book_athlete_as_coach',
                        'cancel_booking_as_coach', 'update_training_session')
      and pg_get_functiondef(p.oid) ilike '%p_now%'),
  '0', 'nor does any other domain function (AC-040d)');

\echo ''
\echo '── The audit trail outlives the login (AC-141, AC-223) ─────────────'
select pg_temp.check(
  (select count(*)::text from public.audit_log where actor_profile_id is not null),
  (select count(*)::text from public.audit_log),
  'every audit entry has an actor to begin with');
-- AC-223. actor_profile_id points at the durable profile, not at auth.users,
-- which is what D-18 required the schema to make possible.
delete from auth.users where id = '00000000-0000-0000-0000-00000000ad11';
select pg_temp.check(
  (select (auth_user_id is null)::text from public.app_profiles
    where display_name = 'Workspace Admin'),
  'true', 'the login link is severed (AC-220)');
select pg_temp.check(
  (select count(*)::text from public.audit_log a
     join public.app_profiles p on p.id = a.actor_profile_id
    where p.display_name = 'Workspace Admin'),
  '2', 'and their audit entries remain attributable by name (AC-223)');
select pg_temp.check(
  (select count(*)::text from public.bookings b
     join public.app_profiles p on p.id = b.created_by
    where p.display_name = 'Workspace Admin'),
  '1', 'as do the bookings they made (AC-220)');
-- AC-141. The suite runs as the owner of audit_log and as a member of
-- service_role, so it is doing this with at least the privilege the drain job
-- has: if the trigger holds here it holds for service_role too.
select pg_temp.check(
  (select (pg_get_userbyid(c.relowner) = current_user)::text
     from pg_class c where c.relname = 'audit_log'),
  'true', 'this suite runs as the owner of the audit table');
select pg_temp.check(
  (select pg_has_role(current_user, 'service_role', 'member')::text),
  'true', 'and with service_role membership (AC-141)');
select pg_temp.expect_error($$update public.audit_log set action = 'SESSION_UPDATED'$$,
  'audit_log rejects UPDATE even so (AC-141)');
select pg_temp.expect_error($$delete from public.audit_log$$,
  'and DELETE (AC-141)');
select pg_temp.check(
  (select count(*)::text from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where c.relname = 'audit_log' and not t.tgisinternal),
  '1', 'enforced by trigger, which no role bypasses (AC-141)');

\echo ''
\echo '── The occupancy projection equals the bookings ────────────────────'
select pg_temp.check(
  (select count(*)::text from public.sessions_without_occupancy()),
  '0', 'every session has a projection row to lock');
select pg_temp.check(
  (select count(*)::text from public.occupancy_reconciliation()),
  '0', 'and the projection agrees with a recount of CONFIRMED bookings');

-- The assert has to be able to see a drift, or its silence proves nothing.
update public.training_session_occupancy set confirmed_count = confirmed_count + 3
 where training_session_id = '00000000-0000-0000-0000-0000000e0001';
select pg_temp.check(
  (select drift::text from public.occupancy_reconciliation()
    where training_session_id = '00000000-0000-0000-0000-0000000e0001'),
  '-3', 'a projection above the truth is reported, with the size of the gap');
update public.training_session_occupancy set confirmed_count = 0
 where training_session_id = '00000000-0000-0000-0000-0000000e0001';
select pg_temp.check(
  (select projected::text || '/' || actual::text from public.occupancy_reconciliation()
    where training_session_id = '00000000-0000-0000-0000-0000000e0001'),
  '0/2', 'and so is one below it, which is the case that turns parents away');
select pg_temp.check(
  (select count(*)::text from public.occupancy_reconciliation()),
  '1', 'only the drifting session is reported');

-- The supported repair (AC-232). It reports what it changed rather than fixing
-- things quietly, because a count that moved without a booking moving is what
-- someone will later need explained.
select pg_temp.check(
  (public.repair_occupancy('00000000-0000-0000-0000-0000000e0001'::uuid)
   -> 'data' -> 'sessions' -> 0 ->> 'was') || '->' ||
  (public.repair_occupancy('00000000-0000-0000-0000-0000000e0001'::uuid)
   -> 'data' ->> 'repaired'),
  '0->0', 'the repair names the count it found, and a second run finds nothing (AC-232)');
select pg_temp.check(
  (select count(*)::text from public.occupancy_reconciliation()),
  '0', 'the drift is gone (AC-232)');
select pg_temp.check(
  (select (after ->> 'confirmed_count') from public.audit_log
    where action = 'OCCUPANCY_REPAIRED'),
  '2', 'and the repair is on the record (AC-232)');

-- Touching a booking row does NOT repair it: the projection trigger fires on a
-- status change, not on any write. The runbook said otherwise until this was
-- run, which is why it is asserted rather than assumed.
update public.training_session_occupancy set confirmed_count = 40
 where training_session_id = '00000000-0000-0000-0000-0000000e0001';
update public.bookings set updated_at = now()
 where training_session_id = '00000000-0000-0000-0000-0000000e0001';
select pg_temp.check(
  (select count(*)::text from public.occupancy_reconciliation()),
  '1', 'a plain write on a booking does not recompute the projection (AC-232)');

-- A booking write does, because the trigger recomputes rather than adding a
-- delta: a recount cannot inherit an earlier mistake.
insert into public.bookings(training_session_id, athlete_id, created_by, created_by_role)
values ('00000000-0000-0000-0000-0000000e0001', pg_temp.ath('Anna'),
        '00000000-0000-0000-0000-0000000fb000', 'USER');
select pg_temp.check(
  (select count(*)::text from public.occupancy_reconciliation()),
  '0', 'the next booking write repairs the drift by recomputing');
select pg_temp.check(
  (select confirmed_count::text from public.training_session_occupancy
    where training_session_id = '00000000-0000-0000-0000-0000000e0001'),
  '3', 'to the true count, not to the wrong one plus a delta');

select pg_temp.check(
  pg_temp.as_user(:COACH, $$select (public.repair_occupancy() ->> 'ok')$$),
  'DENIED', 'the repair is operational, not a client feature (AC-232)');

select pg_temp.check(
  pg_temp.as_user(:COACH, $$select count(*)::text from public.occupancy_reconciliation()$$),
  'DENIED', 'the assert is operational, not a client feature');

\echo ''
\echo '── A full pass over the fixtures leaves no drift ───────────────────'
-- Everything above has booked, cancelled, removed, overridden and deactivated.
-- The projection is the one thing that must still be exactly right.
select pg_temp.as_user(:COACH, format($$select (public.cancel_training_session(%L::uuid) ->> 'ok')$$,
  '00000000-0000-0000-0000-0000000e0001'));
select pg_temp.check(
  (select count(*)::text from public.occupancy_reconciliation()),
  '0', 'after a session cancellation');
select pg_temp.check(
  (select count(*)::text from public.sessions_without_occupancy()),
  '0', 'and every session created along the way got its row');

drop function pg_temp.as_user(text,text);
drop function pg_temp.check(text,text,text);
drop function pg_temp.expect_error(text,text);
