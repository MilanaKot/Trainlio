-- Trainlio — the parent's telephone number (DESIGN_BRIEF decision 18)
-- Run after the migrations and fixtures, on its own freshly created database.
--
-- The first personal contact detail this schema stores, and the first one a
-- coach is meant to read. These cases are about the second half of that
-- sentence: who cannot read it, and what happens to it when the person leaves.
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
\set A      '''00000000-0000-0000-0000-0000000fa000'''
\set B      '''00000000-0000-0000-0000-0000000fb000'''
\set STRANGER '''00000000-0000-0000-0000-0000005f4a46'''

-- Ivan is family A's child and is booked into the fixture session.
create or replace function pg_temp.ivan_booking() returns uuid language sql stable security definer as
  $$ select b.id from public.bookings b
      where b.athlete_id = '00000000-0000-0000-0000-0000000a0001'
        and b.training_session_id = '00000000-0000-0000-0000-0000000e0001'
      limit 1 $$;

\echo ''
\echo '── A parent records their own number (AC-252) ───────────────────────'
select pg_temp.check(
  pg_temp.as_user(:A, $$update public.app_profiles set phone='+420123456789'
    where id=public.current_profile_id() returning phone$$),
  '+420123456789', 'a guardian may set their own telephone number (AC-252)');
select pg_temp.check(
  pg_temp.as_user(:A, $$update public.app_profiles set phone='  +420123456789  '
    where id=public.current_profile_id() returning phone$$),
  '+420123456789', 'which is trimmed before it is stored (AC-252)');
select pg_temp.check(
  pg_temp.as_user(:A, $$update public.app_profiles set phone='777 123 456'
    where id=public.current_profile_id() returning '1'$$),
  'DENIED', 'a number that is not E.164 is refused by the database (AC-252)');
select pg_temp.check(
  pg_temp.as_user(:A, $$update public.app_profiles set phone='+0123456789'
    where id=public.current_profile_id() returning '1'$$),
  'DENIED', 'including one with a leading zero after the plus (AC-252)');
select pg_temp.check(
  pg_temp.as_user(:A, $$update public.app_profiles set phone=''
    where id=public.current_profile_id() returning coalesce(phone,'(null)')$$),
  '(null)', 'clearing it leaves no empty string behind (AC-252)');
select pg_temp.check(
  pg_temp.as_user(:A, $$update public.app_profiles set phone='+420123456789'
    where id=public.current_profile_id() returning phone$$),
  '+420123456789', 'and it can be given again (AC-252)');

\echo ''
\echo '── Nobody reads it from the table (AC-253) ──────────────────────────'
select pg_temp.check(
  pg_temp.as_user(:COACH, $$select coalesce(count(*)::text,'0') from public.app_profiles
    where phone is not null$$),
  '0', 'a coach sees no guardian profile at all, so no number either (AC-253)');
select pg_temp.check(
  pg_temp.as_user(:B, $$select count(*)::text from public.app_profiles
    where id = '00000000-0000-0000-0000-0000000fa000'$$),
  '0', 'another family sees nothing of this profile (AC-253, AC-091)');
select pg_temp.check(
  pg_temp.as_user(:COACH, $$select public.session_roster(
    '00000000-0000-0000-0000-0000000e0001'::uuid)::text ilike '%+420%'$$),
  'false', 'and the roster itself carries no number (AC-253)');
select pg_temp.check(
  (select count(*)::text from information_schema.column_privileges
    where table_name='app_profiles' and column_name='phone'
      and privilege_type='SELECT' and grantee = 'anon'),
  '0', 'anon holds no read on the column (AC-253)');

\echo ''
\echo '── The coach reaches one family, for one booking (AC-254) ───────────'
select pg_temp.check(
  pg_temp.as_user(:COACH, $$select phone from public.booking_guardians(pg_temp.ivan_booking())$$),
  '+420123456789', 'the coach of this session reads the number (AC-254)');
select pg_temp.check(
  pg_temp.as_user(:COACH, $$select display_name from public.booking_guardians(pg_temp.ivan_booking())$$),
  'Rodina A', 'together with the name to put on the call (AC-254)');
select pg_temp.check(
  pg_temp.as_user(:ADMIN, $$select count(*)::text from public.booking_guardians(pg_temp.ivan_booking())$$),
  '1', 'so does an administrator of the same workspace (AC-254)');
select pg_temp.check(
  pg_temp.as_user(:A, $$select count(*)::text from public.booking_guardians(pg_temp.ivan_booking())$$),
  '0', 'the family gets nothing from it: this is not how they read their own data (AC-254)');
select pg_temp.check(
  pg_temp.as_user(:B, $$select count(*)::text from public.booking_guardians(pg_temp.ivan_booking())$$),
  '0', 'and another family gets nothing at all (AC-254, AC-091)');
select pg_temp.check(
  pg_temp.as_user(:STRANGER, $$select count(*)::text from public.booking_guardians(pg_temp.ivan_booking())$$),
  '0', 'nor does someone with no relationship to the club (AC-254)');
-- A coach who has left the workspace loses the number with everything else.
update public.workspace_members set is_active = false where profile_id = :COACH;
select pg_temp.check(
  pg_temp.as_user(:COACH, $$select count(*)::text from public.booking_guardians(pg_temp.ivan_booking())$$),
  '0', 'a former coach reaches no family (AC-254)');
update public.workspace_members set is_active = true where profile_id = :COACH;

\echo ''
\echo '── A second parent is not hidden (AC-254) ───────────────────────────'
insert into public.guardian_athlete_access(profile_id, athlete_id)
 values (:B, '00000000-0000-0000-0000-0000000a0001');
update public.app_profiles set phone = '+420987654321' where id = :B;
select pg_temp.check(
  pg_temp.as_user(:COACH, $$select count(*)::text from public.booking_guardians(pg_temp.ivan_booking())$$),
  '2', 'both active guardians come back, not whichever one is first (AC-254, BR-002)');
select pg_temp.check(
  pg_temp.as_user(:COACH, $$select string_agg(phone, ' ' order by phone)
    from public.booking_guardians(pg_temp.ivan_booking())$$),
  '+420123456789 +420987654321', 'each with their own number (AC-254)');
-- Revoked access is not a guardian any more.
update public.guardian_athlete_access set status = 'REVOKED'
 where profile_id = :B and athlete_id = '00000000-0000-0000-0000-0000000a0001';
select pg_temp.check(
  pg_temp.as_user(:COACH, $$select count(*)::text from public.booking_guardians(pg_temp.ivan_booking())$$),
  '1', 'a revoked guardian drops out of the list (AC-254)');

\echo ''
\echo '── It goes when the person does (AC-255) ────────────────────────────'
select public.anonymize_profile(:A, 'test');
select pg_temp.check(
  (select coalesce(phone,'(null)') from public.app_profiles where id = :A),
  '(null)', 'the D-18 stamp clears the number with the name (AC-255)');
select pg_temp.check(
  pg_temp.as_user(:COACH, $$select count(*)::text from public.booking_guardians(pg_temp.ivan_booking())$$),
  '0', 'and the coach can no longer reach them (AC-255)');
-- The stamp alone is enough: no function has to remember to do it.
update public.app_profiles set phone = '+420111222333', anonymized_at = null where id = :B;
update public.app_profiles set anonymized_at = now() where id = :B;
select pg_temp.check(
  (select coalesce(phone,'(null)') from public.app_profiles where id = :B),
  '(null)', 'any path that stamps a profile erases it, not only anonymize_profile() (AC-255)');

\echo ''
\echo '── No second copy exists anywhere (AC-256) ──────────────────────────'
select pg_temp.check(
  (select count(*)::text from public.audit_log where after::text like '%+420%' or before::text like '%+420%'),
  '0', 'no number was ever written to the audit log (AC-256)');
select pg_temp.check(
  (select count(*)::text from public.notification_deliveries where recipient_email like '%+420%'),
  '0', 'nor into the delivery record, which is for addresses under a retention window (AC-256)');
select pg_temp.check(
  (select count(*)::text from information_schema.columns
    where table_schema = 'public' and column_name = 'phone'),
  '1', 'and the column exists in exactly one table (AC-256)');
