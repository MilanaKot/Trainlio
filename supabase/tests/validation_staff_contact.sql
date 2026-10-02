-- Trainlio — the coach's telephone number (design handoff v3, decision 28)
-- Run after the migrations and fixtures, on its own freshly created database.
--
-- A parent cannot put back the child a coach removed (D-06), so §G6d offers the
-- one thing left: the coach's name, their number, and two buttons. That number
-- is not `app_profiles.phone` — that column is the parent's — and it is not on
-- the profile at all, because every parent in the club can read a staff
-- profile row to learn who leads a training (D-11). It lives in a table with no
-- grant and no policy, and these cases are about the three doors into it.
--
-- Its own database rather than a section of validation_contact.sql: that suite
-- forgets both families on its way through (AC-255), and a removal needs a
-- parent who can still sign in.
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
\echo '── The coach publishes a number of their own (AC-280) ───────────────'
-- Handoff v3, decision 28: a parent who cannot re-book the child the coach
-- removed (D-06) can at least ring the coach. The number is the coach's, it is
-- in its own table, and these cases are about who may write and read it.
select pg_temp.check(
  pg_temp.as_user(:COACH, $$select public.set_own_staff_phone('777 111 222')->>'ok'$$),
  'true', 'a coach writes down their own number (AC-280)');
select pg_temp.check(
  (select phone from public.staff_contacts where profile_id = :COACH),
  '777111222', 'as the digits they typed, without the spaces (AC-280)');
select pg_temp.check(
  pg_temp.as_user(:COACH, $$select public.set_own_staff_phone('12345')->>'code'$$),
  'PHONE_MALFORMED', 'something too short to dial is refused (AC-280)');
select pg_temp.check(
  pg_temp.as_user(:A, $$select public.set_own_staff_phone('777000111')->>'code'$$),
  'NOT_STAFF', 'a parent has no row in it: their number is their own profile (AC-280)');

\echo ''
\echo '── Nobody reads the table itself (AC-280) ──────────────────────────'
select pg_temp.check(
  pg_temp.as_user(:A, $$select count(*)::text from public.staff_contacts$$),
  'DENIED', 'not a parent, who may read the coach name but not the directory (AC-280)');
select pg_temp.check(
  pg_temp.as_user(:COACH, $$select count(*)::text from public.staff_contacts$$),
  'DENIED', 'not a coach, not even their own row (AC-280)');
select pg_temp.check(
  pg_temp.as_user(:ADMIN, $$select count(*)::text from public.staff_contacts$$),
  'DENIED', 'not an administrator, who has the function for it (AC-280)');
select pg_temp.check(
  (select count(*)::text from information_schema.role_table_grants
    where table_schema='public' and table_name='staff_contacts'
      and grantee in ('anon','authenticated')),
  '0', 'and no grant exists to be forgotten about (AC-280)');

\echo ''
\echo '── An administrator fills it in for a coach (AC-280) ────────────────'
select pg_temp.check(
  pg_temp.as_user(:ADMIN, format($$select public.set_member_phone(
    (select id from public.workspaces limit 1), %L, '+420777333444')->>'ok'$$, :COACH2)),
  'true', 'an administrator records a coach number (AC-280)');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select public.set_member_phone(
    (select id from public.workspaces limit 1), %L, '777999888')->>'code'$$, :COACH2)),
  'NOT_AUTHORIZED', 'a coach cannot record a colleague''s (AC-280)');
select pg_temp.check(
  (select count(*)::text from public.audit_log
    where action = 'MEMBER_CONTACT_CHANGED' and (after::text like '%420777%' or before::text like '%420777%')),
  '0', 'the audit entry says a number was set, never which one (AC-280, AC-256)');
select pg_temp.check(
  (select count(*)::text from public.audit_log where action = 'MEMBER_CONTACT_CHANGED'),
  '1', 'and it was recorded (AC-280)');

\echo ''
\echo '── The roster shows it to the people who may see it (AC-280) ────────'
select pg_temp.check(
  pg_temp.as_user(:ADMIN, $$select coalesce(string_agg(coalesce(phone,'(null)'), ',' order by phone nulls last), '-')
    from public.workspace_staff((select id from public.workspaces limit 1))$$),
  '+420777333444,777111222,(null)', 'an administrator sees the staff''s numbers (AC-280)');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select coalesce(phone, '(null)')
    from public.workspace_staff((select id from public.workspaces limit 1))
    where profile_id = %L$$, :COACH2)),
  '(null)', 'a coach gets no directory of their colleagues (AC-280)');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select coalesce(phone, '(null)')
    from public.workspace_staff((select id from public.workspaces limit 1))
    where profile_id = %L$$, :COACH)),
  '777111222', 'but reads their own, which is what K0 prefills (AC-280)');

\echo ''
\echo '── A parent reaches the coach who removed their child (AC-281) ──────'
select pg_temp.check(
  pg_temp.as_user(:A, $$select count(*)::text from public.removed_booking_coach(pg_temp.ivan_booking())$$),
  '0', 'a booking nobody removed offers no contact (AC-281)');
select pg_temp.check(
  pg_temp.as_user(:COACH, $$select public.cancel_booking_as_coach(pg_temp.ivan_booking(), 'Nemoc')->>'ok'$$),
  'true', 'the coach removes the athlete (AC-042, AC-281)');
select pg_temp.check(
  pg_temp.as_user(:A, $$select display_name || ' · ' || coalesce(phone,'(null)')
    from public.removed_booking_coach(pg_temp.ivan_booking())$$),
  'Trenér Novák · 777111222', 'and the family may now ring them (AC-281)');
select pg_temp.check(
  pg_temp.as_user(:B, $$select count(*)::text from public.removed_booking_coach(pg_temp.ivan_booking())$$),
  '0', 'another family reads nothing of it (AC-281, AC-091)');
select pg_temp.check(
  pg_temp.as_user(:STRANGER, $$select count(*)::text from public.removed_booking_coach(pg_temp.ivan_booking())$$),
  '0', 'nor does someone with no child here (AC-281)');
select pg_temp.check(
  pg_temp.as_user(:COACH2, $$select count(*)::text from public.removed_booking_coach(pg_temp.ivan_booking())$$),
  '1', 'a colleague sees it too — the roster is theirs to work from (AC-281)');

\echo ''
\echo '── And it goes when the coach does (AC-280) ─────────────────────────'
update public.app_profiles set anonymized_at = now() where id = :COACH2;
select pg_temp.check(
  (select count(*)::text from public.staff_contacts where profile_id = :COACH2),
  '0', 'the D-18 stamp takes the coach''s number too (AC-280)');
