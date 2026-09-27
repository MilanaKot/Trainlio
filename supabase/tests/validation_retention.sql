-- Trainlio — account anonymisation and email retention (D-18)
-- Run after the migrations and fixtures, on its own freshly created database.
--
-- The architectural constraint is already proven in validation.sql: deleting an
-- auth.users row leaves history intact and attributed. This is the workflow
-- built on top of it — what an erasure removes, and what it must not.
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
\set B '''00000000-0000-0000-0000-0000000fb000'''

create or replace function pg_temp.ath(p_name text) returns uuid language sql stable as
  $$ select id from public.athletes where first_name = p_name $$;

\echo '── The erasure is administrative, not a feature (AC-224) ───────────'
select pg_temp.check(
  pg_temp.as_user(:A, $$select (public.anonymize_profile(
    '00000000-0000-0000-0000-0000000fa000'::uuid) ->> 'ok')$$),
  'DENIED', 'a guardian cannot erase themselves through the API (AC-224)');
select pg_temp.check(
  pg_temp.as_user(:B, $$select (public.anonymize_profile(
    '00000000-0000-0000-0000-0000000fa000'::uuid) ->> 'ok')$$),
  'DENIED', 'and certainly not another family (AC-224)');
select pg_temp.check(
  pg_temp.as_user(:COACH, $$select (public.anonymize_profile(
    '00000000-0000-0000-0000-0000000fa000'::uuid) ->> 'ok')$$),
  'DENIED', 'nor can a coach, who is the controller but not the operator (AC-224)');
select pg_temp.check(
  pg_temp.as_user(:COACH, $$select count(*)::text from public.dormant_profiles(1)$$),
  'DENIED', 'the dormant list is not client-readable either (AC-224)');
select pg_temp.check(
  (select count(*)::text from information_schema.role_routine_grants
    where routine_schema='public' and routine_name in
      ('anonymize_profile','anonymization_preview','scrub_notification_emails','dormant_profiles')
      and grantee in ('anon','authenticated')),
  '0', 'no client role holds EXECUTE on any of them (AC-224)');

\echo ''
\echo '── The preview, before anything is touched (AC-225) ────────────────'
-- Family A guards Ivan and Tomáš, and has booked both. Family B guards Anna,
-- who has a second guardian in this scenario.
insert into public.guardian_athlete_access(profile_id, athlete_id)
values ('00000000-0000-0000-0000-0000005f4a46', pg_temp.ath('Anna'));

select pg_temp.check(
  (public.anonymization_preview('00000000-0000-0000-0000-0000000fa000'::uuid) ->> 'display_name'),
  'Rodina A', 'the preview names who this is, while the name still exists');
select pg_temp.check(
  (public.anonymization_preview('00000000-0000-0000-0000-0000000fa000'::uuid) ->> 'bookings_created'),
  '2', 'and how much history stays attributed (AC-225)');
select pg_temp.check(
  (public.anonymization_preview('00000000-0000-0000-0000-0000000fa000'::uuid) ->> 'guardian_links'),
  '2', 'and how many guardian links would be revoked');
-- The consequence an operator is most likely to miss.
select pg_temp.check(
  (select count(*)::text from jsonb_array_elements(
     public.anonymization_preview('00000000-0000-0000-0000-0000000fa000'::uuid)
     -> 'athletes_left_without_guardian')),
  '2', 'Ivan and Tomáš would be left with no active guardian (AC-225)');
select pg_temp.check(
  (select count(*)::text from jsonb_array_elements(
     public.anonymization_preview('00000000-0000-0000-0000-0000000fb000'::uuid)
     -> 'athletes_left_without_guardian')),
  '0', 'Anna would not, because she has a second guardian (AC-225, BR-002)');
select pg_temp.check(
  (public.anonymization_preview('00000000-0000-0000-0000-00000000dead'::uuid) ->> 'exists'),
  'false', 'an unknown profile previews as absent rather than erroring');

\echo ''
\echo '── What an erasure removes (AC-226) ────────────────────────────────'
-- A delivery carrying this family's address, so the scrub has something to do.
insert into public.notification_events(workspace_id, training_session_id, event_type, payload)
select w.id, '00000000-0000-0000-0000-0000000e0001', 'SESSION_CANCELLED', '{}'::jsonb
from public.workspaces w where w.name like 'Příbram%';
select public.expand_notification_event(
  (select id from public.notification_events order by created_at desc limit 1));

select pg_temp.check(
  (select count(*)::text from public.notification_deliveries
    where recipient_profile_id = '00000000-0000-0000-0000-0000000fa000' and recipient_email is not null),
  '1', 'the delivery audit holds their address to begin with');

select pg_temp.check(
  (public.anonymize_profile('00000000-0000-0000-0000-0000000fa000'::uuid, 'Žádost o výmaz') ->> 'ok'),
  'true', 'the erasure runs');
select pg_temp.check(
  (select display_name from public.app_profiles where id = '00000000-0000-0000-0000-0000000fa000'),
  null, 'the display name is gone (AC-226)');
select pg_temp.check(
  (select (anonymized_at is not null)::text from public.app_profiles
    where id = '00000000-0000-0000-0000-0000000fa000'),
  'true', 'and the profile is stamped (AC-226)');
select pg_temp.check(
  (select (auth_user_id is null)::text from public.app_profiles
    where id = '00000000-0000-0000-0000-0000000fa000'),
  'true', 'the login link is severed (AC-220, AC-226)');
select pg_temp.check(
  (select count(*)::text from auth.users where id = '00000000-0000-0000-0000-0000000fa000'),
  '0', 'and the authentication record is deleted, so they cannot sign in again');
select pg_temp.check(
  (select count(*)::text from public.notification_deliveries
    where recipient_profile_id = '00000000-0000-0000-0000-0000000fa000' and recipient_email is not null),
  '0', 'no address of theirs is left in the delivery audit (AC-222, AC-226)');
select pg_temp.check(
  (select count(*)::text from public.guardian_athlete_access
    where profile_id = '00000000-0000-0000-0000-0000000fa000' and status = 'ACTIVE'),
  '0', 'their guardian access is revoked (AC-226)');

\echo ''
\echo '── What an erasure must NOT remove (AC-227) ────────────────────────'
select pg_temp.check(
  (select count(*)::text from public.bookings
    where created_by = '00000000-0000-0000-0000-0000000fa000'),
  '2', 'the bookings they made are still there (AC-227)');
select pg_temp.check(
  (select count(*)::text from public.bookings b
    where b.created_by = '00000000-0000-0000-0000-0000000fa000' and b.status = 'CONFIRMED'),
  '2', 'and still confirmed: the children are still on the roster (AC-227)');
select pg_temp.check(
  (select count(*)::text from public.notification_deliveries
    where recipient_profile_id = '00000000-0000-0000-0000-0000000fa000'),
  '1', 'the delivery row survives its scrubbed address (AC-227, D-18)');
select pg_temp.check(
  (select count(*)::text from public.guardian_athlete_access
    where profile_id = '00000000-0000-0000-0000-0000000fa000'),
  '2', 'the guardian rows are revoked, not deleted — they explain past bookings');
select pg_temp.check(
  (select count(*)::text from public.training_sessions
    where id = '00000000-0000-0000-0000-0000000e0001'),
  '1', 'the training itself is a fact about the club, not about them (AC-227)');
select pg_temp.check(
  (select first_name || ' ' || last_name from public.athletes where id = pg_temp.ath('Ivan')),
  'Ivan Kotov', 'and a child is a different data subject, untouched by default (AC-228)');

\echo ''
\echo '── The erasure is itself audited (AC-229) ──────────────────────────'
select pg_temp.check(
  (select count(*)::text from public.audit_log where action = 'PROFILE_ANONYMIZED'),
  '1', 'one entry per workspace the person was active in (AC-229)');
select pg_temp.check(
  (select before ->> 'display_name' from public.audit_log where action = 'PROFILE_ANONYMIZED'),
  'Rodina A', 'recording who this was, while that was still knowable (AC-229)');
select pg_temp.check(
  (select metadata ->> 'reason' from public.audit_log where action = 'PROFILE_ANONYMIZED'),
  'Žádost o výmaz', 'and why');
select pg_temp.check(
  (select (metadata -> 'preview' ->> 'bookings_created') from public.audit_log
    where action = 'PROFILE_ANONYMIZED'),
  '2', 'with the blast radius as it stood (AC-229)');
select pg_temp.check(
  (select (actor_profile_id is null)::text from public.audit_log where action = 'PROFILE_ANONYMIZED'),
  'true', 'performed by an administrator outside any session, so no actor is named');
-- AC-141 still holds for the new action.
select pg_temp.check(
  (select count(*)::text from public.audit_log a
     join public.app_profiles p on p.id = a.entity_id
    where a.action = 'PROFILE_ANONYMIZED' and p.anonymized_at is not null),
  '1', 'and the entry still points at a profile that exists (AC-223, AC-229)');

\echo ''
\echo '── Running it twice ────────────────────────────────────────────────'
select pg_temp.check(
  (public.anonymize_profile('00000000-0000-0000-0000-0000000fa000'::uuid) ->> 'code'),
  'ALREADY_ANONYMIZED', 'a second erasure is refused, not repeated');
select pg_temp.check(
  (select count(*)::text from public.audit_log where action = 'PROFILE_ANONYMIZED'),
  '1', 'so no second audit entry is written');
select pg_temp.check(
  (public.anonymize_profile('00000000-0000-0000-0000-00000000dead'::uuid) ->> 'code'),
  'PROFILE_NOT_FOUND', 'an unknown profile is reported as such');

\echo ''
\echo '── Erasing a child, only when asked (AC-228) ───────────────────────'
select pg_temp.check(
  (public.anonymize_profile('00000000-0000-0000-0000-0000000fb000'::uuid, 'Žádost', true)
   -> 'data' ->> 'athletes_anonymized'),
  '0', 'Anna keeps her name: another guardian is still active (AC-228, BR-002)');
select pg_temp.check(
  (select first_name from public.athletes where id = pg_temp.ath('Anna')),
  'Anna', 'so she is untouched');
-- Her id is captured before the erasure: pg_temp.ath() looks her up by first
-- name, and after this there is no such name to find — which is the point.
create temp table t_anna as select pg_temp.ath('Anna') as id;
create or replace function pg_temp.anna() returns uuid language sql stable as
  $$ select id from t_anna $$;

-- Now the last guardian goes.
select pg_temp.check(
  (public.anonymize_profile('00000000-0000-0000-0000-0000005f4a46'::uuid, 'Žádost', true)
   -> 'data' ->> 'athletes_anonymized'),
  '1', 'with no guardian left, the child is anonymised on request (AC-228)');
select pg_temp.check(
  (select first_name || ' ' || last_name || '|' || is_active::text
     from public.athletes where id = pg_temp.anna()),
  'Anonymizováno —|false', 'their name is cleared and they are deactivated (AC-228)');
select pg_temp.check(
  (select count(*)::text from public.athletes where first_name = 'Anna'),
  '0', 'so the name is genuinely gone from the table (AC-228)');
-- The fixtures book Ivan and Tomáš, not Anna, so what survives here is the
-- rest of her record: the club membership and the hockey profile that a future
-- booking of hers would have been explained by.
select pg_temp.check(
  (select count(*)::text from public.workspace_athlete_memberships m
    where m.athlete_id = pg_temp.anna()),
  '1', 'their club membership survives the erasure (AC-227)');
select pg_temp.check(
  (select count(*)::text from public.athlete_sport_profiles asp
    where asp.athlete_id = pg_temp.anna()),
  '1', 'and so does the sport profile (AC-227)');
select pg_temp.check(
  (select count(*)::text from public.bookings b
     join public.athletes a on a.id = b.athlete_id
    where a.first_name = 'Ivan'),
  '1', 'and another family''s booking is untouched by any of it (AC-227)');
select pg_temp.check(
  (select photo_path from public.athletes where id = pg_temp.anna()),
  null, 'and the photograph reference is cleared (AC-228, D-19)');

\echo ''
\echo '── Address decay on a schedule (AC-230) ────────────────────────────'
-- A fresh delivery for the coach, who has not been erased.
insert into public.notification_events(workspace_id, training_session_id, event_type, payload)
select w.id, '00000000-0000-0000-0000-0000000e0001', 'SESSION_SCHEDULE_CHANGED', '{}'::jsonb
from public.workspaces w where w.name like 'Příbram%';
insert into public.notification_deliveries(event_id, recipient_profile_id, recipient_email, status, sent_at)
select (select id from public.notification_events order by created_at desc limit 1),
       '00000000-0000-0000-0000-00000000c0ac', 'coach@example.test', 'SENT', now();

select pg_temp.check(
  (public.scrub_notification_emails() -> 'data' ->> 'scrubbed'),
  '0', 'a message sent today keeps its address (AC-230)');
select pg_temp.check(
  (select delivery_email_retention_days::text from public.workspaces where name like 'Příbram%'),
  '90', 'the retention window is a workspace setting, not a constant (D-03, AC-230)');

update public.notification_deliveries set sent_at = now() - interval '91 days'
 where recipient_email = 'coach@example.test';
select pg_temp.check(
  (public.scrub_notification_emails() -> 'data' ->> 'scrubbed'),
  '1', 'past the window it is cleared (AC-230)');
select pg_temp.check(
  (select count(*)::text from public.notification_deliveries
    where recipient_profile_id = '00000000-0000-0000-0000-00000000c0ac'),
  '1', 'and the record that a message was sent survives (AC-227, AC-230)');

-- Shortening the window reaches further back; lengthening it protects nothing
-- already cleared, which is why the default is deliberately short.
insert into public.notification_deliveries(event_id, recipient_profile_id, recipient_email, status, sent_at)
select (select id from public.notification_events order by created_at desc limit 1),
       '00000000-0000-0000-0000-00000000c0ad', 'coach2@example.test', 'SENT', now() - interval '10 days';
select pg_temp.check(
  (public.scrub_notification_emails() -> 'data' ->> 'scrubbed'),
  '0', 'ten days is inside a ninety-day window');
update public.workspaces set delivery_email_retention_days = 7 where name like 'Příbram%';
select pg_temp.check(
  (public.scrub_notification_emails() -> 'data' ->> 'scrubbed'),
  '1', 'and outside a seven-day one (AC-230)');

-- An unsent message still needs somewhere to go.
insert into public.notification_deliveries(event_id, recipient_profile_id, recipient_email, status, created_at)
select (select id from public.notification_events order by created_at desc limit 1),
       '00000000-0000-0000-0000-00000000ad11', 'wsadmin@example.test', 'PENDING', now() - interval '400 days';
select pg_temp.check(
  (public.scrub_notification_emails() -> 'data' ->> 'scrubbed'),
  '0', 'a PENDING delivery keeps its address however old (AC-230)');
update public.notification_deliveries set status = 'SENDING'
 where recipient_email = 'wsadmin@example.test';
select pg_temp.check(
  (public.scrub_notification_emails() -> 'data' ->> 'scrubbed'),
  '0', 'and so does one being sent right now');
update public.notification_deliveries
   set status = 'FAILED', claimed_at = now() - interval '400 days'
 where recipient_email = 'wsadmin@example.test';
select pg_temp.check(
  (public.scrub_notification_emails() -> 'data' ->> 'scrubbed'),
  '1', 'a settled failure is scrubbed by its last attempt: it will never be retried (AC-230)');
-- updated_at is rewritten by the set_updated_at trigger on every write, the
-- scrub's own included, so dating retention by it would keep a failed
-- delivery's address for ever.
select pg_temp.check(
  (select (updated_at > claimed_at)::text from public.notification_deliveries
    where recipient_profile_id = '00000000-0000-0000-0000-00000000ad11'),
  'true', 'which is why updated_at is not the clock (AC-230)');

\echo ''
\echo '── Dormancy is a list, never an action (AC-231) ────────────────────'
-- Backdated, because dormancy is measured from real activity and every fixture
-- here was created seconds ago.
update public.app_profiles set created_at = now() - interval '4 years'
 where id = '00000000-0000-0000-0000-00000000c0ad';
select pg_temp.check(
  (select count(*)::text from public.dormant_profiles(1095)
    where profile_id = '00000000-0000-0000-0000-00000000c0ad'),
  '1', 'a profile with no activity for three years is listed (AC-231)');
select pg_temp.check(
  (select count(*)::text from public.dormant_profiles(1825)
    where profile_id = '00000000-0000-0000-0000-00000000c0ad'),
  '0', 'and not under a five-year policy (AC-231)');
update public.app_profiles set created_at = now() - interval '4 years'
 where id = '00000000-0000-0000-0000-0000000fa000';
select pg_temp.check(
  (select count(*)::text from public.dormant_profiles(1095)
    where profile_id = '00000000-0000-0000-0000-0000000fa000'),
  '0', 'an already-anonymised profile is never listed again (AC-231)');
select pg_temp.check(
  (select count(*)::text from public.dormant_profiles(3650)),
  '0', 'and a ten-year policy lists nobody here');
select pg_temp.check(
  (select (anonymized_at is null)::text || '|' || (auth_user_id is not null)::text
     from public.app_profiles where id = '00000000-0000-0000-0000-00000000c0ad'),
  'true|true', 'and listing a profile changed nothing about it (AC-231)');

\echo ''
\echo '── The database still holds together afterwards ────────────────────'
select pg_temp.check(
  (select count(*)::text from public.occupancy_reconciliation()),
  '0', 'the occupancy projection is unaffected by an erasure');
select pg_temp.check(
  (select count(*)::text from public.sessions_without_occupancy()),
  '0', 'and every session still has its row');
select pg_temp.check(
  (select coalesce(string_agg(table_name || '.' || column_name, ', ' order by table_name), 'none')
     from information_schema.columns
    where table_schema = 'public'
      and data_type in ('text', 'character varying', 'character')
      and (column_name ilike '%email%' or column_name ilike '%e_mail%')),
  'notification_deliveries.recipient_email',
  'and no new column started storing an address (AC-222)');

drop function pg_temp.as_user(text,text);
drop function pg_temp.check(text,text,text);
