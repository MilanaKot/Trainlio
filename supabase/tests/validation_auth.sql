-- Trainlio — auth integration validation
-- Run after the migrations, on its own freshly created database. Does not use
-- fixtures.sql: it creates its own authentication identities.
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

-- Two people sign in through OTP. Supabase writes auth.users; everything else
-- is this migration's job.
insert into auth.users(id, email) values
  ('00000000-0000-0000-0000-00000000aaaa', 'parent@example.test'),
  ('00000000-0000-0000-0000-00000000bbbb', 'other@example.test');

\set A '''00000000-0000-0000-0000-00000000aaaa'''
\set B '''00000000-0000-0000-0000-00000000bbbb'''

\echo '── Signup creates the actor record ─────────────────────────────────'
select pg_temp.check(
  (select count(*)::text from public.app_profiles where auth_user_id='00000000-0000-0000-0000-00000000aaaa'),
  '1', 'a profile is created for each new authentication identity');
select pg_temp.check(
  (select (display_name is null)::text from public.app_profiles where auth_user_id='00000000-0000-0000-0000-00000000aaaa'),
  'true', 'display_name starts null — no personal data written on signup');
select pg_temp.check(
  (select count(*)::text from public.app_profiles where display_name like '%@%'),
  '0', 'the email is never copied into a domain table');
select pg_temp.check(pg_temp.as_user(:A, $$select (public.current_profile_id() is not null)::text$$),
  'true', 'current_profile_id() resolves, so every policy can authorize');

\echo ''
\echo '── Backfill and idempotency ────────────────────────────────────────'
-- Re-running the migration's backfill must not double up.
insert into public.app_profiles (auth_user_id)
select u.id from auth.users u
where not exists (select 1 from public.app_profiles p where p.auth_user_id = u.id);
select pg_temp.check((select count(*)::text from public.app_profiles), '2', 'backfill is idempotent');
select pg_temp.check(pg_temp.as_user(:A, $$select (public.ensure_current_profile() = public.current_profile_id())::text$$),
  'true', 'ensure_current_profile() returns the existing profile, not a second one');
select pg_temp.check((select count(*)::text from public.app_profiles), '2', 'ensure_current_profile() created nothing');

\echo ''
\echo '── A client cannot forge or move an actor identity ──────────────────'
select pg_temp.check(
  pg_temp.as_user(:A, $$update public.app_profiles set display_name='Jana Kotová' where id=public.current_profile_id() returning display_name$$),
  'Jana Kotová', 'a guardian may set their own display_name');
select pg_temp.check(
  pg_temp.as_user(:A, $$update public.app_profiles set auth_user_id='00000000-0000-0000-0000-00000000bbbb' where id=public.current_profile_id() returning '1'$$),
  'DENIED', 'a guardian cannot move their profile to another login');
select pg_temp.check(
  pg_temp.as_user(:A, $$update public.app_profiles set anonymized_at=now() where id=public.current_profile_id() returning '1'$$),
  'DENIED', 'a guardian cannot stamp themselves anonymised');
select pg_temp.check(
  pg_temp.as_user(:A, $$insert into public.app_profiles(auth_user_id) values ('00000000-0000-0000-0000-00000000dddd') returning '1'$$),
  'DENIED', 'a guardian cannot create a profile');
-- Note the difference from the cases above: those are refused by privilege and
-- raise, this one is filtered by the row policy and simply matches nothing.
-- Both outcomes are correct; only the mechanism differs, and the assertion that
-- follows is the one that actually proves nothing changed.
select pg_temp.check(
  pg_temp.as_user(:A, $$update public.app_profiles set display_name='hacked' where auth_user_id='00000000-0000-0000-0000-00000000bbbb' returning '1'$$),
  null, 'a guardian update of another profile matches no row');
select pg_temp.check(
  (select coalesce(display_name,'(null)') from public.app_profiles where auth_user_id='00000000-0000-0000-0000-00000000bbbb'),
  '(null)', 'the other profile is untouched');
select pg_temp.check(pg_temp.as_user(:A, $$select count(*)::text from public.app_profiles$$),
  '1', 'a guardian sees only their own profile');
select pg_temp.check(pg_temp.as_user(:A, $$select count(*)::text from auth.users$$),
  'DENIED', 'a guardian cannot read auth.users');

\echo ''
\echo '── D-18: deleting the login leaves the actor record ─────────────────'
delete from auth.users where id='00000000-0000-0000-0000-00000000aaaa';
select pg_temp.check((select count(*)::text from public.app_profiles), '2', 'the profile survives');
select pg_temp.check(
  (select (auth_user_id is null)::text from public.app_profiles where display_name='Jana Kotová'),
  'true', 'only the login link is severed');

drop function pg_temp.as_user(text,text);
drop function pg_temp.check(text,text,text);
